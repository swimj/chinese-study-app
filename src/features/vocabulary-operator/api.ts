import { apiRequest } from '../../services/api';
import type { VocabularyContent,VocabularyContentDraft } from '../../domain/vocabulary-content';
import type { VocabularySecondOpinion, VocabularyContentProposal, VocabularyProposalDraft, VocabularyProposalApplication, VocabularyProposalOperation, VocabularyReflectionCase, VocabularyImprovementAdmission, VocabularyPureCueReferral, VocabularyPureCuePromotion } from '../../domain/vocabulary-reflection';

export type VocabularyReassessmentModel = 'openai:gpt-5.6-luna-high' | 'zai:glm-5.3-flash-high' | 'openai:gpt-6-sol-high';
export type VocabularyCaseWorkspace={case:VocabularyReflectionCase;sources:VocabularyContent[];diagnosis?:import('../../domain/vocabulary-content').VocabularyJson;admission?:VocabularyImprovementAdmission;pureCueReferral?:VocabularyPureCueReferral|null;pureCuePromotion?:VocabularyPureCuePromotion;
  reassessment?:{caseId:string;jobId:string;status:string;error:string|null}|null;
  jobs:{jobId:string;kind:string;status:string;attemptNumber:number;error:string|null;secondOpinion:boolean;result:VocabularySecondOpinion['result']}[];proposals:VocabularyContentProposal[]};
export type VocabularyReviewSnapshot={proposal:VocabularyContentProposal;case:VocabularyReflectionCase|null;reassessment:{eligible:boolean;latest:{caseId:string;jobId:string;status:string;error:string|null}|null}|null;previews:{operationKey:string;source:VocabularyContent|null;result:VocabularyContentDraft}[]};
export type VocabularyProposalPreview={proposal:VocabularyContentProposal;
  previews:{operationKey:string;source:VocabularyContent|null;result:VocabularyContent}[];
  operations:{operationKey:string;strategy:VocabularyProposalOperation['strategy'];scope:VocabularyProposalOperation['scope'];
    schedulesRemainOnSource:number;deactivationsRemainOnSource:number;teachingBindingsRemainOnSource:number;
    sourceSenseMappings:number;sourceCurations:number;sourceIntroductionExercises:number;transfersRelationships:false}[]};
export type VocabularyFailedDispatch={dispatchId:string;learnerId:string;sessionId:string;error:string};
export type VocabularyFailedPreparation={workId:string;wordId:string;sourceContentId:string;attemptCount:number;invocationId:string|null;lastError:string|null;retryable:boolean};
const root='/api/operator/vocabulary';
const id=(value:string)=>encodeURIComponent(value);
const write=<T>(path:string,body:unknown,method='POST')=>apiRequest<T>(`${root}${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export const vocabularyOperatorApi={
  cases:(kind:VocabularyReflectionCase['kind'])=>apiRequest<{items:VocabularyReflectionCase[]}>(`${root}/cases?kind=${kind}`),
  noProposalCases:(status:'completed'|'closed'='completed')=>apiRequest<{items:VocabularyReflectionCase[]}>(`${root}/no-proposal-cases?status=${status}`),
  reassessCase:(caseId:string,modelChoice:VocabularyReassessmentModel)=>write<{caseId:string;jobId:string}>(`/cases/${id(caseId)}/reassessments`,{modelChoice}),
  requestCaseSecondOpinion:(caseId:string,notes:string)=>write<{ok:true}>(`/cases/${id(caseId)}/second-opinions`,{notes}),
  workspace:(caseId:string)=>apiRequest<VocabularyCaseWorkspace>(`${root}/cases/${id(caseId)}`),
  proposals:()=>apiRequest<{items:VocabularyContentProposal[]}>(`${root}/proposals`),
  reviewBatch:(startProposalId:string,limit=20)=>apiRequest<{items:VocabularyReviewSnapshot[];nextProposalId:string|null}>(`${root}/proposals/review-batch?limit=${limit}&startProposalId=${id(startProposalId)}`),
  proposal:(proposalId:string)=>apiRequest<VocabularyContentProposal>(`${root}/proposals/${id(proposalId)}`),
  secondOpinions:(proposalId:string)=>apiRequest<{items:VocabularySecondOpinion[]}>(`${root}/proposals/${id(proposalId)}/second-opinions`),
  requestSecondOpinion:(proposalId:string,expectedVersion:number,notes='')=>write<VocabularySecondOpinion>(`/proposals/${id(proposalId)}/second-opinions`,{expectedVersion,notes}),
  dispatches:()=>apiRequest<{items:VocabularyFailedDispatch[]}>(`${root}/dispatches`),
  preparationFailures:()=>apiRequest<{items:VocabularyFailedPreparation[]}>(`${root}/practice-preparation/failures`),
  retryPreparation:(workId:string)=>write<{ok:true}>(`/practice-preparation/${id(workId)}/retry`,{}),
  retryJob:(jobId:string)=>write<{ok:true}>(`/jobs/${id(jobId)}/retry`,{}),
  retryDispatch:(dispatchId:string)=>write<{ok:true}>(`/dispatches/${id(dispatchId)}/retry`,{}),
  closeCase:(caseId:string,reason:string)=>write<{ok:true}>(`/cases/${id(caseId)}/close`,{reason}),
  create:(draft:VocabularyProposalDraft)=>write<VocabularyContentProposal>('/proposals',draft),
  save:(proposalId:string,expectedVersion:number,draft:VocabularyProposalDraft)=>write<VocabularyContentProposal>(`/proposals/${id(proposalId)}`,{expectedVersion,draft},'PUT'),
  preview:(proposalId:string,expectedVersion:number)=>write<VocabularyProposalPreview>(`/proposals/${id(proposalId)}/preview`,{expectedVersion}),
  approve:(proposalId:string,expectedVersion:number,notes:string)=>write<{reviewId:string}>(`/proposals/${id(proposalId)}/approve`,{expectedVersion,notes}),
  apply:(proposalId:string,expectedVersion:number,reviewId:string,idempotencyKey:string)=>write<VocabularyProposalApplication>(`/proposals/${id(proposalId)}/apply`,{expectedVersion,reviewId,idempotencyKey}),
  close:(proposalId:string,expectedVersion:number,reason:string)=>write<{ok:true}>(`/proposals/${id(proposalId)}/close`,{expectedVersion,reason}),
};
export type VocabularyOperatorApi=typeof vocabularyOperatorApi;
