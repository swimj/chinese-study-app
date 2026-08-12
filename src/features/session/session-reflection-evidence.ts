import type {
  SessionReflectionEvidenceSupplementV2,
  ProductionMistakeEvidenceSupplementV1,
  SessionReflectionEvidenceSupplementV1,
} from '../../domain/reflection-evidence';
export type {
  ProductionMistakeEvidenceSupplementV1,
  SessionReflectionEvidenceSupplementV1,
} from '../../domain/reflection-evidence';
import type { SessionStudyItem, StudyAttemptEvent } from '../../domain/study-actions';

export type SessionReflectionEvidenceAccumulator = SessionReflectionEvidenceSupplementV1;
export type LearnerRequestedReflectionAccumulator = SessionReflectionEvidenceSupplementV2;

export function createLearnerRequestedReflectionAccumulator(): LearnerRequestedReflectionAccumulator {
  return { schemaVersion: 'session_reflection_evidence_supplement.v2', items: [] };
}

export function createSessionReflectionEvidenceAccumulator(): SessionReflectionEvidenceAccumulator {
  return {
    schemaVersion: 'session_reflection_evidence_supplement.v1',
    items: [],
  };
}

/**
 * Captures the first qualifying failed production recall for an action.
 *
 * The cue is frozen from the ordered meanings rendered by the production card.
 * Attempt ids are added only after the corresponding attempt batch has been
 * accepted durably.
 */
export function recordProductionMistakeEvidence(
  accumulator: SessionReflectionEvidenceAccumulator,
  {
    item,
    incorrectAttempt,
    promptDisplayedMeanings,
  }: {
    item: SessionStudyItem;
    incorrectAttempt: StudyAttemptEvent;
    promptDisplayedMeanings: readonly string[];
  },
): SessionReflectionEvidenceAccumulator {
  if (
    item.word.status !== 'review' ||
    item.actionKind !== 'production' ||
    incorrectAttempt.actionKind !== 'production' ||
    incorrectAttempt.outcome !== 'incorrect' ||
    !isQualifyingProductionFailure(incorrectAttempt)
  ) {
    return accumulator;
  }

  assertAttemptMatchesItem(item, incorrectAttempt);

  if (accumulator.items.some((evidence) => evidence.sessionActionId === item.sessionActionId)) {
    return accumulator;
  }

  const displayedMeanings = item.production ? [] : [...promptDisplayedMeanings];
  const cue = item.production;
  const evidence: ProductionMistakeEvidenceSupplementV1 = {
    itemId: `production-mistake:${item.sessionActionId}`,
    sessionActionId: item.sessionActionId,
    targetWordId: item.targetWordId,
    cuesAsShown: [{
      cueId: cue?.cueId ?? null,
      cueType: cue?.cueType ?? 'definition_gloss',
      displayOrder: 0,
      text: cue?.text ?? displayedMeanings.join('; '),
      displayedMeanings,
    }],
    rawResponse: incorrectAttempt.response,
    responseKind: productionAttemptResponseKind(incorrectAttempt),
    attemptIds: [],
  };

  return { ...accumulator, items: [...accumulator.items, evidence] };
}

export function toggleLearnerRequestedReview(
  accumulator: LearnerRequestedReflectionAccumulator,
  item: Pick<SessionStudyItem, 'sessionActionId' | 'targetWordId' | 'actionKind' | 'production'> & {
    word: Pick<SessionStudyItem['word'], 'status'>;
  },
  promptDisplayedMeanings: readonly string[],
): LearnerRequestedReflectionAccumulator {
  if (item.word.status !== 'review' || item.actionKind !== 'production') return accumulator;
  const index = accumulator.items.findIndex((entry) => entry.sessionActionId === item.sessionActionId);
  if (index >= 0) {
    const items = [...accumulator.items];
    items.splice(index, 1);
    return { ...accumulator, items };
  }
  const cue = item.production;
  return {
    ...accumulator,
    items: [...accumulator.items, {
      itemId: `learner-request:${item.sessionActionId}`,
      sessionActionId: item.sessionActionId,
      targetWordId: item.targetWordId,
      cuesAsShown: [{
        cueId: cue?.cueId ?? null,
        cueType: cue?.cueType ?? 'definition_gloss',
        displayOrder: 0,
        text: cue?.text ?? promptDisplayedMeanings.join('; '),
        displayedMeanings: cue ? [] : [...promptDisplayedMeanings],
      }],
      rawResponse: null,
      responseKind: 'no_clue',
      attemptIds: [],
      learnerRequestedReview: true,
    }],
  };
}

export function appendAcceptedLearnerRequestedAttemptIds(
  accumulator: LearnerRequestedReflectionAccumulator,
  input: Parameters<typeof appendAcceptedProductionAttemptIds>[1],
): LearnerRequestedReflectionAccumulator {
  const base = appendAcceptedProductionAttemptIds({
    schemaVersion: 'session_reflection_evidence_supplement.v1',
    items: accumulator.items.map(({ learnerRequestedReview: _marker, ...item }) => item),
  }, input);
  return {
    schemaVersion: accumulator.schemaVersion,
    items: base.items.map((item) => ({ ...item, learnerRequestedReview: true })),
  };
}

export function dropLearnerRequestedReflectionForAction(
  accumulator: LearnerRequestedReflectionAccumulator,
  sessionActionId: string,
): LearnerRequestedReflectionAccumulator {
  return { ...accumulator, items: accumulator.items.filter((item) => item.sessionActionId !== sessionActionId) };
}

/**
 * A V3 supplement keeps the ordinary failure evidence plus an optional marker
 * for the same action. That preserves one provider item per action while
 * letting a correct marked response be eligible.
 */
export function buildLearnerRequestedReflectionSupplement(
  failures: SessionReflectionEvidenceAccumulator,
  requests: LearnerRequestedReflectionAccumulator,
): SessionReflectionEvidenceSupplementV2 {
  const requestByAction = new Map(requests.items.map((item) => [item.sessionActionId, item]));
  const items = failures.items.map((failure) => {
    const request = requestByAction.get(failure.sessionActionId);
    requestByAction.delete(failure.sessionActionId);
    return request ? { ...failure, learnerRequestedReview: true as const } : failure;
  });
  for (const request of requestByAction.values()) items.push(request);
  return { schemaVersion: 'session_reflection_evidence_supplement.v2', items };
}

function isQualifyingProductionFailure(attempt: StudyAttemptEvent): boolean {
  if (attempt.response !== null) return attempt.response.trim().length > 0;
  return productionAttemptResponseKind(attempt) === 'no_clue';
}

function productionAttemptResponseKind(attempt: StudyAttemptEvent): 'typed' | 'no_clue' {
  const production = attempt.metadata.production;
  if (
    typeof production === 'object'
    && production !== null
    && !Array.isArray(production)
    && 'responseKind' in production
    && production.responseKind === 'no_clue'
  ) {
    return 'no_clue';
  }
  return 'typed';
}

/**
 * Links an evidence item to the action's ordered attempt ids after the batch
 * has been accepted. Passing an unrelated action is an intentional no-op so
 * callers may use this at the shared deferred-commit boundary.
 */
export function appendAcceptedProductionAttemptIds(
  accumulator: SessionReflectionEvidenceAccumulator,
  {
    sessionActionId,
    acceptedAttempts,
  }: {
    sessionActionId: string;
    acceptedAttempts: readonly StudyAttemptEvent[];
  },
): SessionReflectionEvidenceAccumulator {
  const evidenceIndex = accumulator.items.findIndex(
    (evidence) => evidence.sessionActionId === sessionActionId,
  );
  if (evidenceIndex < 0) {
    return accumulator;
  }

  const evidence = accumulator.items[evidenceIndex];
  if (!evidence) {
    throw new Error('Session reflection evidence invariant violated: expected evidence at the located index.');
  }
  if (evidence.attemptIds.length > 0) {
    throw new Error(
      `Session reflection evidence invariant violated: "${evidence.itemId}" is already linked to an accepted attempt batch.`,
    );
  }
  if (acceptedAttempts.length === 0) {
    throw new Error(
      `Session reflection evidence invariant violated: "${evidence.itemId}" cannot link an empty accepted attempt batch.`,
    );
  }

  const orderedAttempts = [...acceptedAttempts].sort(
    (left, right) => left.actionAttemptSequence - right.actionAttemptSequence,
  );
  for (const attempt of orderedAttempts) {
    if (attempt.actionKind !== 'production') {
      throw new Error(
        `Session reflection evidence invariant violated: accepted attempt "${attempt.id}" is not production.`,
      );
    }
    if (attempt.sessionActionId !== sessionActionId) {
      throw new Error(
        `Session reflection evidence invariant violated: accepted attempt "${attempt.id}" belongs to another action.`,
      );
    }
    if (attempt.targetWordId !== evidence.targetWordId) {
      throw new Error(
        `Session reflection evidence invariant violated: accepted attempt "${attempt.id}" targets another word.`,
      );
    }
  }

  const items = [...accumulator.items];
  items[evidenceIndex] = {
    ...evidence,
    attemptIds: orderedAttempts.map((attempt) => attempt.id),
  };
  return {
    ...accumulator,
    items,
  };
}

export function dropSessionReflectionEvidenceForAction(
  accumulator: SessionReflectionEvidenceAccumulator,
  sessionActionId: string,
): SessionReflectionEvidenceAccumulator {
  const items = accumulator.items.filter((evidence) => evidence.sessionActionId !== sessionActionId);
  return items.length === accumulator.items.length
    ? accumulator
    : {
        ...accumulator,
        items,
      };
}

export function snapshotSessionReflectionEvidence(
  accumulator: SessionReflectionEvidenceAccumulator,
): SessionReflectionEvidenceAccumulator {
  return cloneSessionReflectionEvidence(accumulator);
}

export function restoreSessionReflectionEvidence(
  snapshot: SessionReflectionEvidenceAccumulator,
): SessionReflectionEvidenceAccumulator {
  return cloneSessionReflectionEvidence(snapshot);
}

export function buildSessionReflectionEvidenceSupplement(
  accumulator: SessionReflectionEvidenceAccumulator,
): SessionReflectionEvidenceSupplementV1 {
  for (const evidence of accumulator.items) {
    if (evidence.attemptIds.length === 0) {
      throw new Error(
        `Session reflection evidence invariant violated: "${evidence.itemId}" has no accepted attempt ids.`,
      );
    }
  }

  return cloneSessionReflectionEvidence(accumulator);
}

function cloneSessionReflectionEvidence(
  evidence: SessionReflectionEvidenceAccumulator,
): SessionReflectionEvidenceAccumulator {
  return {
    schemaVersion: evidence.schemaVersion,
    items: evidence.items.map((item) => ({
      ...item,
      cuesAsShown: item.cuesAsShown.map((cue) => ({
        ...cue,
        displayedMeanings: [...cue.displayedMeanings],
      })),
      attemptIds: [...item.attemptIds],
    })),
  };
}

function assertAttemptMatchesItem(item: SessionStudyItem, attempt: StudyAttemptEvent) {
  if (attempt.sessionActionId !== item.sessionActionId) {
    throw new Error(
      `Session reflection evidence invariant violated: attempt "${attempt.id}" belongs to another action.`,
    );
  }
  if (attempt.targetWordId !== item.targetWordId) {
    throw new Error(
      `Session reflection evidence invariant violated: attempt "${attempt.id}" targets another word.`,
    );
  }
}
