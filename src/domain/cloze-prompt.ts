// Match explicit blank shapes, never arbitrary non-Hanzi text. Keep horizontal
// spacing inside a marker, but do not combine blanks across separate lines.
const blankMarker = /\([\p{Zs}\t_＿]*\)|（[\p{Zs}\t_＿]*）|\[[\p{Zs}\t_＿]*\]|［[\p{Zs}\t_＿]*］|【[\p{Zs}\t_＿]*】|[_＿]+(?:[\p{Zs}\t]+[_＿]+)*/gu;

function isNonHanziWordCharacter(character: string): boolean {
  return /[\p{L}\p{M}\p{N}]/u.test(character) && !/\p{Script=Han}/u.test(character);
}

export function clozePromptParts(text: string): string[] {
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

