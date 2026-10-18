import type { VocabularyContentDraft, VocabularyJson } from './vocabulary-content.ts';
import type { VocabularyEncounterEvidence } from './vocabulary-session.ts';

export type VocabularyReflectionSubject = { kind: 'word'; wordId: string } | { kind: 'pureCue'; contentId: string };
export type VocabularyReflectionCase = {
  caseId: string; completionId: string; learnerId: string;
  kind: 'learner_feedback' | 'exercise_improvement' | 'teaching_review';
  wordId: string | null; contentId: string | null; status: 'open' | 'completed' | 'closed';
  evidence: VocabularyEncounterEvidence[]; createdAt: string;
};
export type VocabularyReflectionJob = {
  jobId: string; caseId: string; learnerId: string;
  kind: 'learner_feedback' | 'exercise_improvement';
  attemptNumber: number; leaseToken: string; leaseExpiresAt: string;
  evidence: VocabularyReflectionCase;
};
export type VocabularyFeedbackJudgmentInput = {
  diagnosis: VocabularyJson; message: VocabularyJson | null;
  /** Refers to actual encounters; only effective rejected responses can compensate scheduling. */
  unfairEncounterIds: string[]; invocationId?: string;
};
export type VocabularyImprovementResultInput = {
  diagnosis: VocabularyJson; proposal: Omit<VocabularyProposalDraft,'caseId'> | null; invocationId?: string;
};
export type VocabularyReflectionResult = { kind: 'learner_feedback'; judgment: VocabularyFeedbackJudgmentInput }
  | { kind: 'exercise_improvement'; result: VocabularyImprovementResultInput };
export type VocabularyProposalScope = { kind: 'shared' } | { kind: 'learner'; learnerId: string };
export type VocabularyProposalOperation = {
  operationKey: string; scope: VocabularyProposalScope; rationale: string;
} & ({ strategy: 'create'; content: VocabularyContentDraft }
  | { strategy: 'update_existing' | 'replace'; sourceContentId: string; expectedVersion: number; content: VocabularyContentDraft });
export type VocabularyProposalDraft = {
  caseId?: string; operations: VocabularyProposalOperation[]; rationale: string;
  invocationId?: string; bases?: { contentId: string; expectedVersion: number }[];
};
export type VocabularyContentProposal = {
  proposalId: string; caseId: string | null; version: number;
  status: 'draft' | 'awaiting_review' | 'approved' | 'applied' | 'closed';
  operations: VocabularyProposalOperation[]; rationale: string;
  bases: { contentId: string; expectedVersion: number }[];
  invocationId: string | null; authorKind: 'operator' | 'service'; authorId: string;
};
export type VocabularyProposalApplication = {
  applicationId: string; proposalId: string; proposalVersion: number; reviewId: string;
  changes: { operationKey: string; strategy: VocabularyProposalOperation['strategy'];
    sourceContentId: string | null; sourceVersion: number | null; resultContentId: string; resultVersion: number }[];
};
export const VOCABULARY_COMPENSATION_POLICY = {
  version: 'vocabulary-unfair-feedback.v1',
  /** Relax the current due time by one day only when every effective rejection was unfair. Never replay an old schedule. */
  maximumDelayMs: 24 * 60 * 60 * 1000,
} as const;
