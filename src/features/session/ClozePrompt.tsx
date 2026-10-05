// Match explicit blank shapes, never arbitrary non-Hanzi text. Keep horizontal
// spacing inside a marker, but do not combine blanks across separate lines.
const blankMarker = /\([\p{Zs}\t_＿]*\)|（[\p{Zs}\t_＿]*）|\[[\p{Zs}\t_＿]*\]|［[\p{Zs}\t_＿]*］|【[\p{Zs}\t_＿]*】|[_＿]+(?:[\p{Zs}\t]+[_＿]+)*/gu;

function isNonHanziWordCharacter(character: string): boolean {
  return /[\p{L}\p{M}\p{N}]/u.test(character) && !/\p{Script=Han}/u.test(character);
}

function promptParts(text: string): string[] {
  const parts: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(blankMarker)) {
    const start = match.index;
    const end = start + match[0].length;
    // Underscores in Latin words, identifiers, or numbers are not clear blanks.
    if (/^[_＿]/u.test(match[0]) && (
      isNonHanziWordCharacter(Array.from(text.slice(0, start)).at(-1) ?? '')
      || isNonHanziWordCharacter(Array.from(text.slice(end))[0] ?? '')
    )) continue;
    parts.push(text.slice(cursor, start));
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts;
}

export function ClozePrompt({ text, answer }: { text: string; answer: string | null }) {
  const parts = promptParts(text);
  if (!answer || parts.length === 1) return <>{parts.join('____')}</>;
  return <>{parts.map((part, index) => <span key={index}>
    {index > 0 ? <mark className="desk-cloze-answer">{answer}</mark> : null}{part}
  </span>)}</>;
}
