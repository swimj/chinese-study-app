import { normalizeProductionAnswerForProfile, type StudyProfileId } from '../study-profile';
import type {
  ProductionAnswerWord,
  ProductionAttemptResult,
  ProductionExerciseSnapshot,
  ProductionResponseResolution,
} from './study-actions';

export function resolveSessionProductionResponse({
  submittedText,
  anchorWordId,
  production,
  profileId,
}: {
  submittedText: string;
  anchorWordId: string;
  production: ProductionExerciseSnapshot | null;
  profileId?: StudyProfileId;
}): ProductionResponseResolution {
  if (production === null) {
    throw new Error('Review production response resolution requires a frozen production snapshot.');
  }

  return resolveAcceptedProductionResponse({
    submittedText,
    anchorWordId,
    acceptedAnswers: production.acceptedAnswers,
    profileId,
  });
}

export function resolveAcceptedProductionResponse({
  submittedText,
  anchorWordId,
  acceptedAnswers,
  profileId = 'mandarin',
}: {
  submittedText: string;
  anchorWordId: string;
  acceptedAnswers: readonly ProductionAnswerWord[];
  profileId?: StudyProfileId;
}): ProductionResponseResolution {
  const matchingWordIdSet = new Set(
    listMatchingProductionWordIds(submittedText, acceptedAnswers, profileId),
  );
  const acceptedWordIds = acceptedAnswers.map((word) => word.wordId);

  if (matchingWordIdSet.has(anchorWordId) && acceptedWordIds.includes(anchorWordId)) {
    return { submittedText, result: 'accepted_anchor' };
  }

  const acceptedNonAnchorId = acceptedWordIds.find(
    (wordId) => wordId !== anchorWordId && matchingWordIdSet.has(wordId),
  );
  if (acceptedNonAnchorId !== undefined) {
    return { submittedText, result: 'accepted_non_anchor' };
  }

  return { submittedText, result: 'rejected' };
}

export function listMatchingProductionWordIds(
  submittedText: string,
  answerWords: readonly ProductionAnswerWord[],
  profileId: StudyProfileId = 'mandarin',
): string[] {
  const normalizedResponse = normalizeHanziAnswer(submittedText, profileId);
  return [...new Set(
    answerWords
      .filter((word) => productionAnswerForms(word).some(
        (form) => normalizeHanziAnswer(form, profileId) === normalizedResponse,
      ))
      .map((word) => word.wordId),
  )];
}

export function resolveUniqueOutOfSetWordId({
  submittedText,
  catalogWords,
  acceptedWordIds,
  profileId = 'mandarin',
}: {
  submittedText: string;
  catalogWords: readonly ProductionAnswerWord[];
  acceptedWordIds: readonly string[];
  profileId?: StudyProfileId;
}): string | null {
  const acceptedWordIdSet = new Set(acceptedWordIds);
  const matchingOutOfSetIds = listMatchingProductionWordIds(
    submittedText,
    catalogWords,
    profileId,
  ).filter((wordId) => !acceptedWordIdSet.has(wordId));
  return matchingOutOfSetIds.length === 1 ? matchingOutOfSetIds[0]! : null;
}

export function deriveAcceptedSubmittedWordId({
  result,
  submittedText,
  anchorWordId,
  acceptedAnswers,
  profileId = 'mandarin',
}: {
  result: ProductionAttemptResult;
  submittedText: string;
  anchorWordId: string;
  acceptedAnswers: readonly ProductionAnswerWord[];
  profileId?: StudyProfileId;
}): string | null {
  const matchingWordIdSet = new Set(
    listMatchingProductionWordIds(submittedText, acceptedAnswers, profileId),
  );
  const acceptedWordIds = acceptedAnswers.map((word) => word.wordId);

  switch (result) {
    case 'accepted_anchor':
      if (!matchingWordIdSet.has(anchorWordId) || !acceptedWordIds.includes(anchorWordId)) {
        throw new Error('Production attempt result does not match the frozen accepted-answer forms.');
      }
      return anchorWordId;
    case 'accepted_non_anchor': {
      const acceptedNonAnchorId = acceptedWordIds.find(
        (wordId) => wordId !== anchorWordId && matchingWordIdSet.has(wordId),
      );
      if (acceptedNonAnchorId === undefined) {
        throw new Error('Production attempt result does not match the frozen accepted-answer forms.');
      }
      return acceptedNonAnchorId;
    }
    case 'rejected':
      if (acceptedWordIds.some((wordId) => matchingWordIdSet.has(wordId))) {
        throw new Error('Production attempt result does not match the frozen accepted-answer forms.');
      }
      return null;
  }
}

function productionAnswerForms(word: ProductionAnswerWord): string[] {
  return [word.hanzi, word.traditional].filter((form): form is string => form !== null);
}

function normalizeHanziAnswer(value: string, profileId: StudyProfileId): string {
  return normalizeProductionAnswerForProfile(value, profileId);
}
