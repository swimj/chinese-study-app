const TEXT_LABELS: Record<string, string> = {
  cueText: 'Cue', stimulus: 'Prompt', prompt_text: 'Prompt', instruction: 'Instruction',
  text: 'Text', axisNote: 'Distinction', teachingNote: 'Teaching note', explanation: 'Explanation',
  english_frame: 'Frame', example_sentence: 'Example', example_translation: 'Translation',
  hanzi: 'Answer', traditional: 'Traditional form', pinyin: 'Pronunciation', meaning: 'Meaning',
};
const GROUP_LABELS: Record<string, string> = {
  beats: 'Teaching beat', parts: 'Part', rehearsals: 'Rehearsal', acceptedAnswers: 'Accepted answer',
  acceptedWords: 'Accepted word', stimulus: 'Prompt',
};

/** Readable material only: exact source pointers and contracts remain in the JSON inspector. */
export function contentQualityTextBlocks(content: unknown): { label: string; text: string }[] {
  const blocks: { label: string; text: string }[] = [];
  function visit(value: unknown, path: string[]) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && child.trim() && TEXT_LABELS[key]) {
        blocks.push({ label: [...path, TEXT_LABELS[key]].join(' · '), text: child });
      } else if (GROUP_LABELS[key]) {
        if (Array.isArray(child)) child.forEach((item, index) => visit(item, [...path, `${GROUP_LABELS[key]} ${index + 1}`]));
        else visit(child, [...path, GROUP_LABELS[key]]);
      }
    }
  }
  visit(content, []);
  return blocks;
}
