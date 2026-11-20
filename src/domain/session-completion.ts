

export const SESSION_COMPLETION_UNDO_MS = 15_000;

export type SessionCompletionWord = { id: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string };
export type SessionCompletionReport = {
  newWords: SessionCompletionWord[];
  graduatedWords: SessionCompletionWord[];
};
