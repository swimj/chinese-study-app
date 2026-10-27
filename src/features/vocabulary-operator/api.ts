import { apiRequest } from '../../services/api';
import type { VocabularyContent } from '../../domain/vocabulary-content';
import type { VocabularySecondOpinion, VocabularyContentProposal, VocabularyProposalDraft, VocabularyProposalApplication, VocabularyProposalOperation, VocabularyReflectionCase, VocabularyImprovementAdmission, VocabularyPureCueReferral, VocabularyPureCuePromotion } from '../../domain/vocabulary-reflection';

export type VocabularyCaseWorkspace={case:VocabularyReflectionCase;sources:VocabularyContent[];admission?:VocabularyImprovementAdmission;pureCueReferral?:VocabularyPureCueReferral|null;pureCuePromotion?:VocabularyPureCuePromotion;
  jobs:{jobId:string;kind:string;status:string;attemptNumber:number;error:string|null}[];proposals:VocabularyContentProposal[]};
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
  workspace:(caseId:string)=>apiRequest<VocabularyCaseWorkspace>(`${root}/cases/${id(caseId)}`),
  proposals:()=>apiRequest<{items:VocabularyContentProposal[]}>(`${root}/proposals`),
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
