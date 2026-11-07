import type { VocabularyCaseReview, VocabularyContentProposal, VocabularyProposalOperation, VocabularySecondOpinionVerdict } from './vocabulary-reflection';

/** Display-only data. These projections are never accepted as authored content or saved drafts. */
export type VocabularyServedReview = {
  encounterId:string; presentedAt:string|null; contentId:string|null; contentVersion:number|null; kind:string|null; role:string|null;
  pureCue?:{axisNote:string|null;teachingNote:string|null};
  prompt:string|null; choices:{id:string;text:string}[]; acceptedAnswers:string[];
  responses:{actionId:string;text:string|null;outcome:string;undone:boolean}[];
  reactions:{actionId:string;feedback:string;comment:string|null;undone:boolean}[];
  skipped:boolean; presentationUndone:boolean;
};
export type VocabularyOperationReview = {
  operationKey:string; strategy:VocabularyProposalOperation['strategy']; learningRole?:VocabularyProposalOperation['learningRole'];
  scopeLabel:string; groupLabel:string; prompt:string|null; acceptedAnswers:string[]; rationale:string;
  sourceContentId:string|null; expectedVersion:number|null; otherChanges:string[];
  pureCue?:{axisNote:string|null;teachingNote:string|null};
};
export type VocabularyAssessmentSummary = {
  jobId:string; sequence:number; origin:'automatic'|'reassessment'|'identity_resolution';
  models:{invocationId:string;stage:string;provider:string;model:string;resolvedModel:string|null}[];
  outcome:string|null; scopeLabel:string|null; diagnosis:string;
};
export type VocabularyAdvisorySummary = {
  requestId:string; jobId:string; sequence:number; status:'queued'|'running'|'succeeded'|'failed';
  attemptNumber:number; error:string|null; result:VocabularySecondOpinionVerdict|null;
};
export type VocabularyCaseQueueItem = {
  caseId:string; version:number; state:VocabularyCaseReview['state']; createdAt:string; resolvedAt:string|null;
  kind:'exercise_improvement'|'teaching_review'; learnerId:string; wordId:string|null; wordLabel:string|null; contentId:string|null;
  approvalState:VocabularyCaseReview['approvalState']; approvalRequestId:string|null;
  currentProposalId:string|null; currentAssessment:{jobId:string;sequence:number}|null;
  frozen:boolean; activeJob:VocabularyCaseReview['activeJob'];
  latestJob:{jobId:string;sequence:number;status:'queued'|'running'|'succeeded'|'failed';error:string|null;advisory:boolean}|null;
  /** Assessment attached to the displayed proposal, or the current judgment for a no-proposal card. */
  assessment:VocabularyAssessmentSummary|null;
  /** Existing shared practice selected by this assessment; never an editable proposal operation. */
  reusedSharedCue?:{axisNote?:string|null;contentId:string;prompt:string|null;acceptedAnswers:string[];teachingNote:string|null;rationale:string;version:number|null;expectedVersion:number|null;availability:string|null};
  notes?:{noteId:string;text:string;createdAt:string;actorId:string}[];
  /** Most recent 20 action commentaries, distinct from standalone case notes. */
  activity?:{activityId:string;action:'done'|'dismiss'|'approve'|'reassess'|'second_opinion';text:string;createdAt:string;actorId:string;secondOpinionRequestId?:string}[];
  activityHasMore?:boolean;
  served:VocabularyServedReview[];
  proposal:{proposalId:string;version:number;status:VocabularyContentProposal['status'];authorKind:'operator'|'service';
    isCurrent:boolean;rationale:string;operations:VocabularyOperationReview[]}|null;
  alternatives:{proposalId:string;version:number;status:VocabularyContentProposal['status'];rationale:string}[];
  alternativeCount:number;
  sources:{contentId:string;version:number|null;expectedVersion:number;prompt:string|null;acceptedAnswers:string[];availability:string|null}[];
  advisoryOpinion:VocabularyAdvisorySummary|null;
  stale:boolean;
  /** Rare content without a faithful compact rendering must be reviewed in the full workspace before approval. */
  requiresDetails:boolean;
  needsDecision:boolean;
  finding:{kind:'unmappable'|'inventory_gap'|'needs_coverage'|'needs_operator';message:string}|null;
  reassessment:{eligible:boolean;reason:string|null;source:{contentId:string;assessedVersion:number;currentVersion:number}|null};
};
export type VocabularyCaseQueuePage = {items:VocabularyCaseQueueItem[];nextCursor:string|null;previousCursor:string|null;anchorCursor:string|null;total:number;startIndex:number};
export type VocabularyCaseQueueQuery = {view?:'review'|'history';limit?:number;cursor?:string;search?:string;direction?:'next'|'previous';edge?:'first'|'last'};
