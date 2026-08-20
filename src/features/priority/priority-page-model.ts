import type { PriorityWord } from '../../types';

export function sortPriorityWords<T extends PriorityWord>(words: T[]): T[] {
  return [...words].sort((left, right) => {
    const forceTopDelta = Number(right.forceTop) - Number(left.forceTop);
    if (forceTopDelta !== 0) {
      return forceTopDelta;
    }

    if (right.effectivePriority !== left.effectivePriority) {
      return right.effectivePriority - left.effectivePriority;
    }

    if (right.word.priority !== left.word.priority) {
      return right.word.priority - left.word.priority;
    }

    return left.word.createdAt.localeCompare(right.word.createdAt);
  });
}
