import type { ReviewItem, ReviewRating, Word } from '../types';

export type StudySkillId = 'recognition' | 'production' | 'contextual_selection';

export type StudyActionKind =
  | 'recognition'
  | 'production'
  | 'contrast_selection';

export type StudyContentRef =
  | { type: 'contrast_prompt'; id: string }
  | { type: 'example_sentence'; id: string };

export type StudyAction = {
  sessionActionId: string;
  kind: StudyActionKind;
  targetWordId: string;
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  legacyReviewItemId?: string;
};

export type WordStudyAdmissionState = {
  wordId: string;
  earliestNextStudyAt: string | null;
};

export type WordSkillState = {
  wordId: string;
  skillId: StudySkillId;
  enabled: boolean;
  intervalHours: number;
  lastStudiedAt: string;
  nextDueAt: string | null;
  easeFactor: number;
};

export type StudyAttemptOutcome = 'correct' | 'incorrect';

export type StudyAttemptEvent = {
  id: string;
  occurredAt: string;
  sessionId: string;
  sessionActionId: string;
  sessionEventSequence: number;
  actionAttemptSequence: number;
  actionKind: StudyActionKind;
  targetWordId: string;
  sampledSkillIds: StudySkillId[];
  response: string | null;
  outcome: StudyAttemptOutcome;
  rating: ReviewRating | null;
  contentRef: StudyContentRef | null;
  metadata: Record<string, unknown>;
};

export type ReviewCommitFields = {
  failureCount: number;
  terminalRating: Exclude<ReviewRating, 'forgot'> | null;
};

export type StudyReflectionEvent = {
  id: string;
  occurredAt: string;
  sessionId: string;
  sessionActionId: string;
  actionKind: 'contrast_selection';
  targetWordId: string;
  reflection: 'clear_now' | 'still_shaky' | 'want_more_practice';
};

export type StudySessionRecord = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  processingState: 'open' | 'ready_to_process' | 'processed';
  processedAt: string | null;
};

export function mapReviewDirectionToStudySkill(direction: ReviewItem['direction']): StudySkillId {
  switch (direction) {
    case 'forward':
      return 'recognition';
    case 'reverse':
      return 'production';
    default:
      return assertUnreachableReviewDirection(direction);
  }
}

export function mapStudySkillToDefaultActionKind(skillId: StudySkillId): StudyActionKind {
  switch (skillId) {
    case 'recognition':
      return 'recognition';
    case 'production':
      return 'production';
    case 'contextual_selection':
      return 'contrast_selection';
    default:
      return assertUnreachableStudySkill(skillId);
  }
}

export function buildLegacyReviewStudyAction({
  sessionActionId,
  reviewItem,
  word,
  contentRef = null,
}: {
  sessionActionId: string;
  reviewItem: ReviewItem;
  word: Word;
  contentRef?: StudyContentRef | null;
}): StudyAction {
  if (reviewItem.wordId !== word.id) {
    throw new Error(
      `Study action invariant violated: review item word "${reviewItem.wordId}" must match word "${word.id}".`,
    );
  }

  const skillId = mapReviewDirectionToStudySkill(reviewItem.direction);

  return {
    sessionActionId,
    kind: mapStudySkillToDefaultActionKind(skillId),
    targetWordId: word.id,
    sampledSkillIds: [skillId],
    contentRef,
    legacyReviewItemId: reviewItem.id,
  };
}

export function deriveReviewCommitFieldsFromAttemptEvents(events: StudyAttemptEvent[]): ReviewCommitFields {
  if (events.length === 0) {
    throw new Error('Cannot derive review commit fields from an empty attempt event batch.');
  }

  const orderedEvents = [...events].sort((left, right) => left.actionAttemptSequence - right.actionAttemptSequence);
  const firstEvent = orderedEvents[0] ?? assertAttemptEventsPresent();

  assertReviewAttemptEvent(firstEvent);

  let expectedActionAttemptSequence = 1;
  let previousSessionEventSequence = 0;
  let failureCount = 0;
  let reinforcementStreak = 0;
  let commitFields: ReviewCommitFields | null = null;

  for (const event of orderedEvents) {
    assertSameReviewActionEvent(firstEvent, event);

    if (commitFields !== null) {
      throw new Error('Review attempt event batch includes events after the review action was covered.');
    }

    if (event.actionAttemptSequence !== expectedActionAttemptSequence) {
      throw new Error(
        `Review attempt event invariant violated: expected actionAttemptSequence ${expectedActionAttemptSequence}, got ${event.actionAttemptSequence}.`,
      );
    }
    expectedActionAttemptSequence += 1;

    if (event.sessionEventSequence <= previousSessionEventSequence) {
      throw new Error(
        `Review attempt event invariant violated: sessionEventSequence must increase with actionAttemptSequence.`,
      );
    }
    previousSessionEventSequence = event.sessionEventSequence;

    const rating = event.rating ?? assertReviewAttemptRating(event);
    assertReviewAttemptOutcomeMatchesRating(event, rating);

    if (failureCount === 0 && rating !== 'forgot') {
      commitFields = {
        failureCount: 0,
        terminalRating: rating,
      };
      continue;
    }

    if (rating === 'forgot') {
      failureCount += 1;
      reinforcementStreak = 0;
    } else {
      reinforcementStreak += 1;
    }

    if (reinforcementStreak >= 3) {
      commitFields = {
        failureCount,
        terminalRating: null,
      };
    }
  }

  if (commitFields === null) {
    throw new Error('Review attempt events do not represent a covered review action.');
  }

  return commitFields;
}

function assertReviewAttemptEvent(event: StudyAttemptEvent) {
  if (event.actionKind !== 'recognition' && event.actionKind !== 'production') {
    throw new Error(`Expected recognition or production review attempt event, got "${event.actionKind}".`);
  }

  const requiredSkill = event.actionKind === 'recognition' ? 'recognition' : 'production';
  if (!event.sampledSkillIds.includes(requiredSkill)) {
    throw new Error(
      `Review attempt event invariant violated: ${event.actionKind} action must sample ${requiredSkill}.`,
    );
  }
}

function assertSameReviewActionEvent(firstEvent: StudyAttemptEvent, event: StudyAttemptEvent) {
  assertReviewAttemptEvent(event);

  if (event.sessionId !== firstEvent.sessionId) {
    throw new Error('Review attempt event batch must belong to one session.');
  }

  if (event.sessionActionId !== firstEvent.sessionActionId) {
    throw new Error('Review attempt event batch must belong to one session action.');
  }

  if (event.actionKind !== firstEvent.actionKind) {
    throw new Error('Review attempt event batch must use one action kind.');
  }

  if (event.targetWordId !== firstEvent.targetWordId) {
    throw new Error('Review attempt event batch must target one word.');
  }
}

function assertReviewAttemptRating(event: StudyAttemptEvent): never {
  throw new Error(`Review attempt event "${event.id}" must include a rating.`);
}

function assertReviewAttemptOutcomeMatchesRating(event: StudyAttemptEvent, rating: ReviewRating) {
  const expectedOutcome = rating === 'forgot' ? 'incorrect' : 'correct';
  if (event.outcome !== expectedOutcome) {
    throw new Error(
      `Review attempt event "${event.id}" has outcome "${event.outcome}" inconsistent with rating "${rating}".`,
    );
  }
}

function assertAttemptEventsPresent(): never {
  throw new Error('Cannot derive review commit fields from an empty attempt event batch.');
}

function assertUnreachableReviewDirection(direction: never): never {
  throw new Error(`Unsupported review direction "${String(direction)}".`);
}

function assertUnreachableStudySkill(skillId: never): never {
  throw new Error(`Unsupported study skill "${String(skillId)}".`);
}
