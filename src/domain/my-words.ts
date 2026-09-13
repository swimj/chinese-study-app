import type { Word } from '../types';

export type MyWordsView = 'recent' | 'personal' | 'deck';

export type MyWord = {
  word: Word;
  lastStudiedAt: string | null;
  personalUpdatedAt: string | null;
};

export type MyWordsResponse = {
  words: MyWord[];
  hasMore: boolean;
  currentDeck: { label: string } | null;
};

export const WORD_STAGE_LABELS: Record<Word['status'], string> = {
  unstudied: 'Not yet studied',
  learning: 'Learning',
  review: 'In review',
};

export function formatStudyDate(value: string | null): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
}
