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
  learning: 'Learning',
  review: 'In review',
};

export const MY_WORDS_STAGE_CHIPS: ReadonlyArray<{ status: MyWordsStatus; label: string }> = [
  { status: 'unstudied', label: WORD_STAGE_LABELS.unstudied },
  { status: 'learning', label: WORD_STAGE_LABELS.learning },
  { status: 'review', label: WORD_STAGE_LABELS.review },
];

export const ALL_MY_WORDS_STATUSES: readonly MyWordsStatus[] = MY_WORDS_STAGE_CHIPS.map(
  (chip) => chip.status,
);

const STAGE_SORT_RANK: Record<MyWordsStatus, number> = {
  learning: 0,
  unstudied: 1,
  review: 2,
};

export function isMyWordsStatus(value: string): value is MyWordsStatus {
  return value === 'unstudied' || value === 'learning' || value === 'review';
}

export function isMyWordsStageSelectionAll(
  statuses: readonly MyWordsStatus[],
): boolean {
  // Empty means all implicitly; an explicit full set is the same filter.
  return statuses.length === 0
    || (
      statuses.length === ALL_MY_WORDS_STATUSES.length
      && ALL_MY_WORDS_STATUSES.every((status) => statuses.includes(status))
    );
}

export function toggleMyWordsStatus(
  current: readonly MyWordsStatus[],
  status: MyWordsStatus,
): MyWordsStatus[] {
  // From the implicit/explicit all state, one click isolates that stage.
  if (isMyWordsStageSelectionAll(current)) return [status];
  const selected = new Set(current);
  if (selected.has(status)) selected.delete(status);
  else selected.add(status);
  // Empty selection means all again (no chips pressed).
  return ALL_MY_WORDS_STATUSES.filter((stage) => selected.has(stage));
}

export function normalizeMyWordsStatuses(
  view: MyWordsView,
  statuses: readonly MyWordsStatus[] | undefined,
): MyWordsStatus[] {
  const selected = statuses && statuses.length > 0
    ? ALL_MY_WORDS_STATUSES.filter((status) => statuses.includes(status))
    : [...ALL_MY_WORDS_STATUSES];
  const available = view === 'recent'
    ? selected.filter((status) => status !== 'unstudied')
    : selected;
  if (available.length === 0) {
    return view === 'recent' ? ['learning', 'review'] : [...ALL_MY_WORDS_STATUSES];
  }
  return available;
}

export function isMyWordsStageFilterNarrowed(
  view: MyWordsView,
  statuses: readonly MyWordsStatus[] | undefined,
): boolean {
  const effective = normalizeMyWordsStatuses(view, statuses);
  const full = normalizeMyWordsStatuses(view, ALL_MY_WORDS_STATUSES);
  return effective.length !== full.length || full.some((status) => !effective.includes(status));
}

export const MY_WORDS_RECENT_LAPSE_DAYS = 3;

export function myWordsRecentLapseSinceDay(todayUtcDay: string): string {
  const date = new Date(`${todayUtcDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (MY_WORDS_RECENT_LAPSE_DAYS - 1));
  return date.toISOString().slice(0, 10);
}

export function shouldShowMyWordsCount(view: MyWordsView, recentLapses: boolean): boolean {
  return view !== 'recent' || recentLapses;
}

export function compareMyWords(left: MyWord, right: MyWord): number {
  const stage = STAGE_SORT_RANK[left.word.status] - STAGE_SORT_RANK[right.word.status];
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
