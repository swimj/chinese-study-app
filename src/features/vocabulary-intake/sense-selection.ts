import type { VocabularyIntakeCard, VocabularyIntakeSelection } from '../../domain/vocabulary-intake';

export function defaultIntakeSelection(card: VocabularyIntakeCard): VocabularyIntakeSelection {
  return {
    senseIds: card.senses.filter(sense => sense.isDefault).map(sense => sense.senseId),
    includeProposedSense: false,
    targetSenseId: null,
  };
}

export function intakeSelectionFitsCard(card: VocabularyIntakeCard, selection: VocabularyIntakeSelection): boolean {
  return selection.senseIds.every(id => card.senses.some(sense => sense.senseId === id))
    && (!selection.includeProposedSense || Boolean(card.proposedSense))
    && (selection.senseIds.length > 0 || selection.includeProposedSense
      || (card.state === 'proposed' && !card.defaultsEstablished && !card.senses.length && !card.proposedSense));
}

export function toggleIntakeSense(
  selection: VocabularyIntakeSelection,
  senseId: string | null,
  checked: boolean,
): VocabularyIntakeSelection {
  if (senseId === null) return { ...selection, includeProposedSense: checked };
  return {
    ...selection,
    senseIds: checked ? [...selection.senseIds, senseId] : selection.senseIds.filter(id => id !== senseId),
    targetSenseId: !checked && selection.targetSenseId === senseId ? null : selection.targetSenseId,
  };
}
