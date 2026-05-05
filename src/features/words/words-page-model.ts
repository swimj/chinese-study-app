import type { ReviewItem, Word } from '../../types';

export type InspectableRow = {
  id: string;
  word: Word;
  status: 'learning' | 'review';
  nextScheduledAt: string | null;
  direction: ReviewItem['direction'] | null;
  intervalHours: number | null;
  reviewItem: ReviewItem | null;
  reviewItems: ReviewItem[];
};

export function buildInspectableRows({
  words,
  reviewItems,
}: {
  words: Word[];
  reviewItems: ReviewItem[];
}) {
  const reviewItemsByWordId = groupReviewItemsByWordId(reviewItems);
  const rows: InspectableRow[] = [];

  for (const word of words) {
    if (word.status !== 'learning' && word.status !== 'review') {
      continue;
    }

    const items = reviewItemsByWordId.get(word.id) ?? [];

    if (word.status === 'learning') {
      rows.push({
        id: `word-${word.id}`,
        word,
        status: 'learning',
        nextScheduledAt: word.lastLearningCoveredOn ? `${word.lastLearningCoveredOn}T00:00:00` : null,
        direction: null,
        intervalHours: null,
        reviewItem: null,
        reviewItems: items,
      });
      continue;
    }

    for (const item of items) {
      rows.push({
        id: item.id,
        word,
        status: 'review',
        nextScheduledAt: item.nextDueAt,
        direction: item.direction,
        intervalHours: item.intervalHours,
        reviewItem: item,
        reviewItems: items,
      });
    }
  }

  return rows.sort(compareInspectableRows);
}

function groupReviewItemsByWordId(reviewItems: ReviewItem[]) {
  const grouped = new Map<string, ReviewItem[]>();

  for (const item of reviewItems) {
    const existing = grouped.get(item.wordId) ?? [];
    existing.push(item);
    grouped.set(item.wordId, existing);
  }

  for (const items of grouped.values()) {
    items.sort((left, right) => left.direction.localeCompare(right.direction));
  }

  return grouped;
}

function compareInspectableRows(left: InspectableRow, right: InspectableRow) {
  const statusDelta = getStatusSortOrder(left.status) - getStatusSortOrder(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const leftScheduled = left.nextScheduledAt ?? '';
  const rightScheduled = right.nextScheduledAt ?? '';
  if (leftScheduled !== rightScheduled) {
    return leftScheduled.localeCompare(rightScheduled);
  }

  if (right.word.priority !== left.word.priority) {
    return right.word.priority - left.word.priority;
  }

  return left.word.createdAt.localeCompare(right.word.createdAt);
}

function getStatusSortOrder(status: InspectableRow['status']) {
  return status === 'learning' ? 0 : 1;
}
