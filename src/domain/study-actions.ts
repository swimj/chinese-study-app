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
  attemptSequence: number;
  actionKind: StudyActionKind;
  targetWordId: string;
  sampledSkillIds: StudySkillId[];
  response: string | null;
  outcome: StudyAttemptOutcome;
  rating: ReviewRating | null;
  contentRef: StudyContentRef | null;
  metadata: Record<string, unknown>;
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

function assertUnreachableReviewDirection(direction: never): never {
  throw new Error(`Unsupported review direction "${String(direction)}".`);
}

function assertUnreachableStudySkill(skillId: never): never {
  throw new Error(`Unsupported study skill "${String(skillId)}".`);
}
