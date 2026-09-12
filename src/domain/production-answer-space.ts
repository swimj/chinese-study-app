import type { ProductionAnswerWord, ProductionExerciseSnapshot } from './study-actions';

export function isSharedAnswerSpaceAcceptedSet(acceptedWordIds: readonly string[]): boolean {
  return new Set(acceptedWordIds).size > 1;
}

export function sharedAnswerSpaceKey(acceptedWordIds: readonly string[]): string {
  return [...new Set(acceptedWordIds)].sort().join('/');
}

export function isSharedAnswerSpaceProduction(
  production: Pick<ProductionExerciseSnapshot, 'acceptedAnswers'> | null | undefined,
): boolean {
  return production != null && isSharedAnswerSpaceAcceptedSet(
    production.acceptedAnswers.map((word) => word.wordId),
  );
}

export function listAcceptedProductionAnswerLabels(
  acceptedAnswers: readonly ProductionAnswerWord[],
): string[] {
  return acceptedAnswers.map((word) => word.hanzi);
}

export function formatExpectedProductionAnswerCopy({
  acceptedAnswers,
  anchorHanzi,
}: {
  acceptedAnswers: readonly ProductionAnswerWord[] | undefined;
  anchorHanzi: string;
}): string {
  const labels = acceptedAnswers === undefined
    ? []
    : listAcceptedProductionAnswerLabels(acceptedAnswers);
  if (labels.length <= 1) {
    return `"${labels[0] ?? anchorHanzi}"`;
  }

  return `one of ${labels.map((label) => `"${label}"`).join(', ')}`;
}
