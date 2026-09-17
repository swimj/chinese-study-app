/** Keyboard digit → 0-based match index. Digits 1–9 map to indices 0–8; 0 maps to 9. */
export function digitKeyToMatchIndex(key: string): number | null {
  if (key === '0') {
    return 9;
  }

  if (key.length === 1 && key >= '1' && key <= '9') {
    return Number(key) - 1;
  }

  return null;
}

export function matchIndexShortcutLabel(index: number): string | null {
  if (index < 0 || index > 9) {
    return null;
  }

  return index === 9 ? '0' : String(index + 1);
}

export function toggleSelectedMatchId(selectedIds: string[], wordId: string): string[] {
  if (selectedIds.includes(wordId)) {
    return selectedIds.filter((id) => id !== wordId);
  }

  return [...selectedIds, wordId];
}
