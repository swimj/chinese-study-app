import type { ReviewRating } from '../types';
import type { StudyAttemptEvent, StudySkillId } from '../domain/study-actions';
import type { PureCueAssessmentEvent } from '../domain/pure-cues';

type ReviewStudySkillId = Extract<StudySkillId, 'recognition' | 'production'>;
type ContrastSelectionRating = ReviewRating;

export type BucketSessionCommitIntent =
  | { type: 'none' }
  | {
      type: 'commit-review-action-session';
      reinforcementSkipped?: boolean;
      sessionId: string;
      sessionActionId: string;
      targetWordId: string;
      actionKind: Extract<StudyAttemptEvent['actionKind'], 'recognition' | 'production'>;
      sampledSkillIds: ReviewStudySkillId[];
      failureCount: number;
      terminalRating: 'hard' | 'good' | 'easy' | null;
      events: StudyAttemptEvent[];
    }
  | {
      type: 'commit-contrast-selection-action-session';
      sessionId: string;
      sessionActionId: string;
      targetWordId: string;
      actionKind: 'contrast_selection';
      sampledSkillIds: ['contextual_selection'];
      selectedWordId: string;
      promptTargetWordId: string;
      choiceWordIds: string[];
      rating: ContrastSelectionRating;
      practiceMore: boolean;
      event: StudyAttemptEvent;
    }
  | {
      type: 'commit-pure-cue-production-session';
      reinforcementSkipped?: boolean;
      sessionId: string;
      sessionActionId: string;
      attemptId: string;
      snapshotId: string;
      events: PureCueAssessmentEvent[];
    }
  | { type: 'commit-learning-word-session'; wordId: string; success: boolean }
  | { type: 'commit-unstudied-word-session'; wordId: string };
