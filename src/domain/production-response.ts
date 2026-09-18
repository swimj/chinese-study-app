import { normalizeProductionAnswerForProfile, type StudyProfileId } from '../study-profile';
import type {
  ProductionAnswerWord,
  ProductionAttemptResult,
  ProductionExerciseSnapshot,
  ProductionResponseResolution,
} from './study-actions';
import { assertStrictTargetOnlyProductionSnapshot } from './study-actions';

/**
 * Catalog lookup used only to identify a rejected response for reflection
 * promotion. It is not an accepted-answer or grading mechanism.
 */
export type ProductionAnswerLookup = ReadonlyMap<string, readonly string[]>;

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
  assertStrictTargetOnlyProductionSnapshot({ acceptedAnswers: [...acceptedAnswers] }, anchorWordId);
  const anchorAnswer = acceptedAnswers[0]!;
  const normalizedResponse = normalizeHanziAnswer(submittedText, profileId);
  const matchesAnchor = productionAnswerForms(anchorAnswer).some(
    (form) => normalizeHanziAnswer(form, profileId) === normalizedResponse,
  );

  if (matchesAnchor) {
    return { submittedText, result: 'accepted_anchor' };
  }

  return { submittedText, result: 'rejected' };
}

export function buildProductionAnswerLookup(
  answerWords: readonly ProductionAnswerWord[],
  profileId: StudyProfileId = 'mandarin',
): ProductionAnswerLookup {
  const lookup = new Map<string, string[]>();
  for (const word of answerWords) {
    for (const form of productionAnswerForms(word)) {
      const normalizedForm = normalizeHanziAnswer(form, profileId);
      const matchingWordIds = lookup.get(normalizedForm) ?? [];
      if (!matchingWordIds.includes(word.wordId)) {
        matchingWordIds.push(word.wordId);
        lookup.set(normalizedForm, matchingWordIds);
      }
    }
  }
  return lookup;
}

/**
 * Returns a catalog identity only for a rejected response that has one
 * unambiguous out-of-set match. This never changes production grading.
 */
export function resolveUniqueOutOfSetWordId({
  submittedText,
  answerLookup,
  acceptedWordIds,
  profileId = 'mandarin',
}: {
  submittedText: string;
  answerLookup: ProductionAnswerLookup;
  acceptedWordIds: readonly string[];
  profileId?: StudyProfileId;
}): string | null {
  const acceptedWordIdSet = new Set(acceptedWordIds);
  const normalizedResponse = normalizeHanziAnswer(submittedText, profileId);
  const matchingOutOfSetIds = (answerLookup.get(normalizedResponse) ?? [])
    .filter((wordId) => !acceptedWordIdSet.has(wordId));
  return matchingOutOfSetIds.length === 1 ? matchingOutOfSetIds[0]! : null;
}

/**
 * Validates the frozen target-only answer space before attaching its stable
 * target identity to durable evidence. Rejected responses retain no owner
 * answer identity; a known wrong-word lookup is handled separately.
 */
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
  const resolution = resolveAcceptedProductionResponse({
    submittedText,
    anchorWordId,
    acceptedAnswers,
    profileId,
  });
  if (resolution.result !== result) {
    throw new Error('Production attempt result does not match the frozen target-only answer form.');
  }
  return result === 'accepted_anchor' ? anchorWordId : null;
}

function productionAnswerForms(word: ProductionAnswerWord): string[] {
  return [word.hanzi, word.traditional].filter((form): form is string => form !== null);
}

function normalizeHanziAnswer(value: string, profileId: StudyProfileId): string {
  return normalizeProductionAnswerForProfile(value, profileId);
}
