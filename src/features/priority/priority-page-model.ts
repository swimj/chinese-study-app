import type { PriorityWord } from '../../types';

export type PriorityBankSection = 'top' | 'stash';
export type PriorityChipSelectionMode = 'replace' | 'toggle' | 'range';
export type PriorityWordPatch = {
  bumpDelta?: number;
  forceTop?: boolean;
  reset?: boolean;
  requiredForNextSession?: boolean;
};

export function sortPriorityWords<T extends PriorityWord>(words: T[]): T[] {
  return [...words].sort((left, right) => {
    const forceTopDelta = Number(right.forceTop) - Number(left.forceTop);
    if (forceTopDelta !== 0) {
      return forceTopDelta;
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

export function partitionPriorityBank<T extends PriorityWord>(words: T[]): {
  top: T[];
  stash: T[];
} {
  const sorted = sortStashManageWords(words);
  return {
    top: sorted.filter((entry) => entry.forceTop),
    stash: sorted.filter((entry) => !entry.forceTop),
  };
}

export function applyPriorityPatch<T extends PriorityWord>(
  entry: T,
  patch: PriorityWordPatch,
  overlayUpdatedAt: string,
): T {
  return {
    ...entry,
    bumpCount: patch.reset
      ? 0
      : patch.bumpDelta === undefined
        ? entry.bumpCount
        : patch.bumpDelta > 0
          ? Math.max(entry.bumpCount, 1)
          : 0,
    forceTop: patch.reset ? false : patch.forceTop ?? entry.forceTop,
    requiredForNextSession: patch.reset
      ? false
      : patch.requiredForNextSession ?? entry.requiredForNextSession,
    overlayUpdatedAt,
  };
}

export function nextChipSelection(input: {
  selectedIds: readonly string[];
  orderedIds: readonly string[];
  targetId: string;
  mode: PriorityChipSelectionMode;
  rangeAnchorId: string | null;
}): { selectedIds: string[]; rangeAnchorId: string } {
  if (!input.orderedIds.includes(input.targetId)) {
    throw new Error(`Invariant violated: chip "${input.targetId}" is not in the current section order.`);
  }

  if (input.mode === 'replace') {
    return { selectedIds: [input.targetId], rangeAnchorId: input.targetId };
  }

  if (input.mode === 'toggle') {
    const selectedIds = input.selectedIds.includes(input.targetId)
      ? input.selectedIds.filter((wordId) => wordId !== input.targetId)
      : [...input.selectedIds, input.targetId];
    return { selectedIds, rangeAnchorId: input.targetId };
  }

  const anchorId = input.rangeAnchorId && input.orderedIds.includes(input.rangeAnchorId)
    ? input.rangeAnchorId
    : input.targetId;
  const start = input.orderedIds.indexOf(anchorId);
  const end = input.orderedIds.indexOf(input.targetId);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return {
    selectedIds: input.orderedIds.slice(from, to + 1),
    rangeAnchorId: anchorId,
  };
}

function requireOverlayUpdatedAt(word: PriorityWord): string {
  if (typeof word.overlayUpdatedAt !== 'string' || word.overlayUpdatedAt.trim().length === 0) {
    throw new Error(`Stash manage sort requires overlayUpdatedAt for word "${word.word.id}".`);
  }

  return word.overlayUpdatedAt;
}
