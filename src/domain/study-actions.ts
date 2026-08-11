import type { ReviewRating, Word } from '../types';

export type StudySkillId = 'recognition' | 'production' | 'contextual_selection';

export type StudyActionKind =
  | 'recognition'
  | 'production'
  | 'contrast_selection';

export type StudyContentRef =
  | { type: 'contrast_prompt'; id: string }
  | { type: 'example_sentence'; id: string }
  | { type: 'production_cue'; taskId: string; cueId: string };

export type ProductionCueType = 'definition_gloss' | 'minimal_context' | 'circumstance';

export type ProductionAttemptResult =
  | 'accepted_anchor'
  | 'accepted_non_anchor'
  | 'rejected';

export type ProductionExerciseSnapshot = {
  taskId: string;
  cueId: string | null;
  cueType: ProductionCueType;
  text: string;
  acceptedWordIds: string[];
  recheckDemandId: string | null;
};

export type ProductionAnswerWord = {
  wordId: string;
  hanzi: string;
  traditional: string | null;
};

export type ProductionResponseResolution =
  | {
      responseKind?: 'typed';
      submittedText: string;
      submittedWordId: string | null;
      result: ProductionAttemptResult;
    }
  | {
      responseKind: 'no_clue';
      submittedText: null;
      submittedWordId: null;
      result: 'rejected';
    };

export type ContrastCluster = {
  id: string;
  title: string;
  note: string;
};

export type ContrastClusterMember = {
  clusterId: string;
  wordId: string;
  nuanceNote: string;
  displayOrder: number | null;
};

export type ContrastPrompt = {
  id: string;
  clusterId: string;
  targetWordId: string;
  promptText: string;
  explanation: string;
};

export type ContrastSelectionChoice = {
  word: Word;
  nuanceNote: string;
};

export type ContrastSelectionContent = {
  clusterId: string;
  clusterTitle: string;
  clusterNote: string;
  scheduledWordId: string;
  promptTargetWordId: string;
  prompt: ContrastPrompt;
  choices: ContrastSelectionChoice[];
};

export type StudyAction = {
  sessionActionId: string;
  kind: StudyActionKind;
  targetWordId: string;
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
};

export type SessionStudyItemSource = 'unstudied' | 'learning' | 'review';
export type WordLifecycleSessionStudyItemSource = Exclude<SessionStudyItemSource, 'review'>;

export type SessionStudyItem = {
  sessionActionId: string;
  actionKind: StudyActionKind;
  targetWordId: string;
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  intervalHours: number;
  word: Word;
  contrastSelection: ContrastSelectionContent | null;
  production: ProductionExerciseSnapshot | null;
};

export type SessionStudyItemBuckets = {
  review: SessionStudyItem[];
  learning: Word[];
  unstudied: Word[];
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

export type StudyEventType =
  | 'skill_relevance_changed'
  | 'contrast_candidate_requested'
  | 'skill_relevance_changed_with_contrast_candidate'
  | 'bad_prompt_reported';

// 'deprioritized' unused currently, saved for future enrichment
export type WordSkillRelevanceState = 'normal' | 'deprioritized' | 'suppressed';

export type StudyManagementActionKind =
  | 'suppress_skill'
  | 'bad_prompt';

export type StudyEvent = {
  id: string;
  occurredAt: string;
  sessionId: string | null;
  sessionActionId: string | null;
  sessionEventSequence: number | null;
  eventType: StudyEventType;
  targetWordId: string | null;
  actionKind: StudyActionKind | null;
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  payload: Record<string, unknown>;
  projectedAt: string | null;
};

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

export type ContrastSelectionCommitIntent = {
  type: 'commit-contrast-selection-action-session';
  sessionActionId: string;
  targetWordId: string;
  actionKind: 'contrast_selection';
  sampledSkillIds: ['contextual_selection'];
  selectedWordId: string;
  promptTargetWordId: string;
  choiceWordIds: string[];
  rating: ReviewRating;
  practiceMore: boolean;
};

export type StudySessionRecord = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  processingState: 'open' | 'ready_to_process' | 'processed';
  processedAt: string | null;
};

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

export function studyManagementActionRemovesCurrentReviewAction(action: StudyManagementActionKind): boolean {
  switch (action) {
    case 'suppress_skill':
    case 'bad_prompt':
      return true;
    default:
      return assertUnreachableStudyManagementAction(action);
  }
}

export function buildReviewSessionStudyItem({
  wordSkillState,
  word,
  sessionActionId = buildSessionActionId('review', word.id, wordSkillState.skillId),
  contentRef = null,
  contrastSelection = null,
  production = null,
}: {
  wordSkillState: WordSkillState;
  word: Word;
  sessionActionId?: string;
  contentRef?: StudyContentRef | null;
  contrastSelection?: ContrastSelectionContent | null;
  production?: ProductionExerciseSnapshot | null;
}): SessionStudyItem {
  if (wordSkillState.wordId !== word.id) {
    throw new Error(
      `Session study item invariant violated: word skill state word "${wordSkillState.wordId}" must match word "${word.id}".`,
    );
  }

  if (word.status !== 'review') {
    throw new Error(
      `Session study item invariant violated: review session item word "${word.id}" must have review status.`,
    );
  }

  return {
    sessionActionId,
    actionKind: mapStudySkillToDefaultActionKind(wordSkillState.skillId),
    targetWordId: word.id,
    sampledSkillIds: [wordSkillState.skillId],
    contentRef,
    intervalHours: wordSkillState.intervalHours,
    word,
    contrastSelection,
    production,
  };
}

export function buildWordLifecycleSessionStudyItems({
  source,
  word,
}: {
  source: WordLifecycleSessionStudyItemSource;
  word: Word;
}): SessionStudyItem[] {
  if (word.status !== source) {
    throw new Error(
      `Session study item invariant violated: ${source} session item word "${word.id}" must have ${source} status.`,
    );
  }

  return [
    buildWordLifecycleSessionStudyItem({ source, word, skillId: 'recognition' }),
    buildWordLifecycleSessionStudyItem({ source, word, skillId: 'production' }),
  ];
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

function buildWordLifecycleSessionStudyItem({
  source,
  word,
  skillId,
}: {
  source: WordLifecycleSessionStudyItemSource;
  word: Word;
  skillId: Extract<StudySkillId, 'recognition' | 'production'>;
}): SessionStudyItem {
  return {
    sessionActionId: buildSessionActionId(source, word.id, skillId),
    actionKind: mapStudySkillToDefaultActionKind(skillId),
    targetWordId: word.id,
    sampledSkillIds: [skillId],
    contentRef: null,
    intervalHours: 0,
    word,
    contrastSelection: null,
    production: null,
  };
}

function buildSessionActionId(source: SessionStudyItemSource, wordId: string, skillId: StudySkillId) {
  return `${source}/${wordId}/${skillId}`;
}

function assertAttemptEventsPresent(): never {
  throw new Error('Cannot derive review commit fields from an empty attempt event batch.');
}

function assertUnreachableStudySkill(skillId: never): never {
  throw new Error(`Unsupported study skill "${String(skillId)}".`);
}

function assertUnreachableStudyManagementAction(action: never): never {
  throw new Error(`Unsupported study management action "${String(action)}".`);
}
