import type { VocabularyContent, VocabularyContentDraft, VocabularyJson } from './vocabulary-content.ts';
import type { VocabularyEncounterEvidence } from './vocabulary-session.ts';

export type VocabularyReflectionSubject = { kind: 'word'; wordId: string } | { kind: 'pureCue'; contentId: string };
export type VocabularyReflectionCase = {
  caseId: string; completionId: string; learnerId: string;
  kind: 'learner_feedback' | 'exercise_improvement' | 'teaching_review';
  wordId: string | null; contentId: string | null; status: 'open' | 'completed' | 'closed';
  evidence: VocabularyEncounterEvidence[]; createdAt: string;
  reassessmentSource?: {contentId:string;version:number};
  /** Authoritative resolution time; absent in older clients and null when unresolved or unavailable. */
  resolvedAt?: string | null;
};
export type VocabularyReflectionJob = {
  jobId: string; caseId: string; learnerId: string;
  kind: 'learner_feedback' | 'exercise_improvement';
  attemptNumber: number; leaseToken: string; leaseExpiresAt: string;
  evidence: VocabularyReflectionCase;
  reassessmentSourceJobId?: string;
  /** Current authored version explicitly selected by the operator; encounters remain historical. */
  reassessmentSource?: VocabularyContent;
  secondOpinion?: { requestId: string; proposal: VocabularyContentProposal | null; notes: string; diagnosis?: VocabularyJson };
};
export type VocabularyFeedbackJudgmentInput = {
  diagnosis: VocabularyJson; message: VocabularyJson | null;
  /** Refers to actual encounters; only effective rejected responses can compensate scheduling. */
  unfairEncounterIds: string[]; invocationId?: string;
};
export type VocabularyImprovementAdmission = {
  outcome: 'single_sense' | 'laundry_list' | 'unmappable' | 'inventory_gap';
  rationale: string; wordId: string; sourceContentId: string; sourceContentVersion: number;
  catalogVersion: number; senseIds: string[]; invocationId?: string;
  sourceMapping: { senseId: string | null; establishedAt: string | null };
};
export type VocabularyPureCueReferral = { candidateWords: string[]; sharedPurpose: string; rationale: string };
export type VocabularyPureCuePromotion = {
  outcome: 'reject' | 'reuse' | 'extend' | 'create' | 'needs_operator';
  rationale: string; candidateWordIds: string[]; existingContentId: string | null;
  invocationId?: string;
};
export type VocabularyImprovementResultInput = {
  diagnosis: VocabularyJson; proposal: Omit<VocabularyProposalDraft,'caseId'> | null; invocationId?: string;
  secondOpinion?: VocabularySecondOpinionVerdict;
  admission?: VocabularyImprovementAdmission;
  pureCueReferral?: VocabularyPureCueReferral | null;
  pureCuePromotion?: VocabularyPureCuePromotion;
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
  /** Authoritative application or dismissal time; never the draft creation/update time. */
  resolvedAt?: string | null;
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

export type VocabularySecondOpinionVerdict = { verdict: 'support' | 'revise' | 'reject'; rationale: string };
export type VocabularySecondOpinion = {
  requestId: string; proposalId: string; proposalVersion: number; jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed'; attemptNumber: number;
  error: string | null; requestedAt: string; result: VocabularySecondOpinionVerdict | null;
};
