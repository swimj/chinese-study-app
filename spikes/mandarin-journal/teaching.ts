// Teaching an expression the learner has chosen but never studied: an ordered
// sequence of beats the learner advances one at a time, on a lesson card that asks
// nothing. The word's first recall comes on a later card in the same session.

export type BeatPart =
  | { kind: 'text'; text: string }
  | { kind: 'chinese'; text: string; pinyin?: string }
  | { kind: 'translation'; text: string }
  | { kind: 'note'; text: string };
export type Beat = { id: string; parts: BeatPart[] };

/**
 * What the journal knows about the expression. `encounter` is where the learner met
 * it, in their own context: the passage around a word saved while reading, or what
 * they wrote about it when saving it. A word saved through intake also has the
 * example sentence and translation prepared then (`savedExample`).
 */
export type TeachTarget = {
  form: string;
  pinyin: string | null;
  gloss: string | null;
  encounter?: string;
  savedExample?: { text: string; translation: string };
};
export type TeachRequest = TeachTarget;
