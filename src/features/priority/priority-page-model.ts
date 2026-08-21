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

export function sortStashManageWords<T extends PriorityWord>(words: T[]): T[] {
  return [...words].sort((left, right) => {
    const forceTopDelta = Number(right.forceTop) - Number(left.forceTop);
    if (forceTopDelta !== 0) {
      return forceTopDelta;
    }

    const leftUpdatedAt = requireOverlayUpdatedAt(left);
    const rightUpdatedAt = requireOverlayUpdatedAt(right);
    const updatedAtDelta = rightUpdatedAt.localeCompare(leftUpdatedAt);
    if (updatedAtDelta !== 0) {
      return updatedAtDelta;
    }

    return left.word.id.localeCompare(right.word.id);
  });
}

function requireOverlayUpdatedAt(word: PriorityWord): string {
  if (typeof word.overlayUpdatedAt !== 'string' || word.overlayUpdatedAt.trim().length === 0) {
    throw new Error(`Stash manage sort requires overlayUpdatedAt for word "${word.word.id}".`);
  }

  return word.overlayUpdatedAt;
}
