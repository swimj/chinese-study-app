import type { Word } from '../types';

export type MyWordsView = 'recent' | 'personal' | 'deck';
export type MyWordsStatus = Word['status'];

export type MyWord = {
  word: Word;
  lastStudiedAt: string | null;
  personalUpdatedAt: string | null;
};

export type MyWordsResponse = {
  words: MyWord[];
  hasMore: boolean;
  total: number;
  currentDeck: { label: string } | null;
};

export const WORD_STAGE_LABELS: Record<MyWordsStatus, string> = {
  unstudied: 'Not yet studied',
  learning: 'Practice',
  review: 'In review',
};

export const MY_WORDS_STAGE_CHIPS: ReadonlyArray<{ status: MyWordsStatus; label: string }> = [
  { status: 'unstudied', label: WORD_STAGE_LABELS.unstudied },
  { status: 'learning', label: WORD_STAGE_LABELS.learning },
  { status: 'review', label: WORD_STAGE_LABELS.review },
];

export const MY_WORDS_RECENT_LAPSE_DAYS = 3;

export function myWordsRecentLapseSinceDay(todayUtcDay: string): string {
  const date = new Date(`${todayUtcDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (MY_WORDS_RECENT_LAPSE_DAYS - 1));
  return date.toISOString().slice(0, 10);
}

export function shouldShowMyWordsCount(view: MyWordsView, recentLapses: boolean): boolean {
  return view !== 'recent' || recentLapses;
}

export function compareWordBrowserEntries<Stage extends string>(left: WordBrowserEntry<Stage>, right: WordBrowserEntry<Stage>, ranks: Readonly<Record<Stage, number>>): number {
  const stage = ranks[left.word.status] - ranks[right.word.status];
  if (stage !== 0) return stage;
  if (left.word.status === 'unstudied') {
    const a = left.word.pinyin.toLowerCase();
    const b = right.word.pinyin.toLowerCase();
    return (a < b ? -1 : a > b ? 1 : 0) || left.word.id.localeCompare(right.word.id);
  }
  if (left.lastStudiedAt === null && right.lastStudiedAt !== null) return 1;
  if (left.lastStudiedAt !== null && right.lastStudiedAt === null) return -1;
  if (left.lastStudiedAt !== null && right.lastStudiedAt !== null && left.lastStudiedAt !== right.lastStudiedAt) {
    return left.lastStudiedAt < right.lastStudiedAt ? 1 : -1;
  }
  return left.word.id.localeCompare(right.word.id);
}

export function formatStudyDate(value: string | null): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
}

export type WordBrowserEntry<Stage extends string = MyWordsStatus> = {
  word: Pick<MyWord['word'], 'id' | 'hanzi' | 'traditional' | 'pinyin' | 'meaning' | 'meanings' | 'personalNotes'> & {status: Stage};
  lastStudiedAt: string | null; personalUpdatedAt: string | null;
};
