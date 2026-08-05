import type {
  ProductionAnswerWord,
  ProductionExerciseSnapshot,
  ProductionResponseResolution,
} from './study-actions';

export function resolveSessionProductionResponse({
  submittedText,
  anchorWordId,
  production,
  answerWords,
}: {
  submittedText: string;
  anchorWordId: string;
  production: ProductionExerciseSnapshot | null;
  answerWords: readonly ProductionAnswerWord[];
}): ProductionResponseResolution {
  if (production === null) {
    throw new Error('Review production response resolution requires a frozen production snapshot.');
  }

  return resolveProductionResponse({
    submittedText,
    anchorWordId,
    acceptedWordIds: production.acceptedWordIds,
    answerWords,
  });
}

export function resolveProductionResponse({
  submittedText,
  anchorWordId,
  acceptedWordIds,
  answerWords,
}: {
  submittedText: string;
  anchorWordId: string;
  acceptedWordIds: readonly string[];
  answerWords: readonly ProductionAnswerWord[];
}): ProductionResponseResolution {
  const normalizedResponse = normalizeHanziAnswer(submittedText);
  const matchingWordIds = answerWords
    .filter((word) => [word.hanzi, word.traditional].some(
      (form) => form !== null && normalizeHanziAnswer(form) === normalizedResponse,
    ))
    .map((word) => word.wordId);
  const uniqueMatchingWordIds = [...new Set(matchingWordIds)];
  const matchingWordIdSet = new Set(uniqueMatchingWordIds);
  const acceptedWordIdSet = new Set(acceptedWordIds);

  if (matchingWordIdSet.has(anchorWordId) && acceptedWordIdSet.has(anchorWordId)) {
    return { submittedText, submittedWordId: anchorWordId, result: 'accepted_anchor' };
  }

  const acceptedNonAnchorId = acceptedWordIds.find((wordId) => matchingWordIdSet.has(wordId));
  if (acceptedNonAnchorId !== undefined) {
    return { submittedText, submittedWordId: acceptedNonAnchorId, result: 'accepted_non_anchor' };
  }

  return {
    submittedText,
    submittedWordId: uniqueMatchingWordIds.length === 1 ? uniqueMatchingWordIds[0]! : null,
    result: 'rejected',
  };
}

function normalizeHanziAnswer(value: string): string {
  return value.trim().replace(/\s+/g, '');
}
