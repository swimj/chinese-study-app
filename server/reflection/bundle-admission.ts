type ReflectionItemWordReferences = {
  targetWord: { wordId: string };
  submittedWord: { wordId: string } | null;
};

/**
 * Greedily admits items whose target and submitted words have not appeared in
 * an earlier admitted item. Supplied order is the stable priority order.
 */
export function selectNonOverlappingReflectionItems<T extends ReflectionItemWordReferences>(
  items: readonly T[],
): { items: T[]; overlapOmittedItemCount: number } {
  const reservedWordIds = new Set<string>();
  const selectedItems: T[] = [];
  let overlapOmittedItemCount = 0;

  for (const item of items) {
    const itemWordIds = new Set([
      item.targetWord.wordId,
      ...(item.submittedWord === null ? [] : [item.submittedWord.wordId]),
    ]);
    if ([...itemWordIds].some((wordId) => reservedWordIds.has(wordId))) {
      overlapOmittedItemCount += 1;
      continue;
    }

    selectedItems.push(item);
    for (const wordId of itemWordIds) reservedWordIds.add(wordId);
  }

  return { items: selectedItems, overlapOmittedItemCount };
}
