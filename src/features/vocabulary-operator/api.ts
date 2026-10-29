import type { VocabularyDefaultSelectionFinding,VocabularySenseCoverageWorkspace } from '../../domain/vocabulary-sense-coverage';
import { apiRequest } from '../../services/api';
import type { VocabularyContent,VocabularyContentDraft } from '../../domain/vocabulary-content';
import type { VocabularyApprovalRequest, VocabularySecondOpinion, VocabularyContentProposal, VocabularyProposalDraft, VocabularyProposalApplication, VocabularyProposalOperation, VocabularyReflectionCase, VocabularyImprovementAdmission, VocabularyPureCueReferral, VocabularyPureCuePromotion } from '../../domain/vocabulary-reflection';

export type VocabularyReassessmentModel = 'openai:gpt-5.6-luna-high' | 'zai:glm-5.3-flash-high' | 'openai:gpt-6-sol-high';
export type VocabularyReassessmentSource={contentId:string;assessedVersion:number;currentVersion:number};
export type VocabularyCaseWorkspace={defaultSelectionFinding?:VocabularyDefaultSelectionFinding|null;case:VocabularyReflectionCase;sources:VocabularyContent[];diagnosis?:import('../../domain/vocabulary-content').VocabularyJson;admission?:VocabularyImprovementAdmission;pureCueReferral?:VocabularyPureCueReferral|null;pureCuePromotion?:VocabularyPureCuePromotion;
  reassessmentSource?:VocabularyReassessmentSource|null;
  reassessment?:{caseId:string;jobId:string;status:string;error:string|null}|null;
  jobs:{jobId:string;kind:string;status:string;attemptNumber:number;error:string|null;secondOpinion:boolean;result:VocabularySecondOpinion['result']}[];proposals:VocabularyContentProposal[]};
export type VocabularyReviewSnapshot={defaultSelectionFinding?:VocabularyDefaultSelectionFinding|null;proposal:VocabularyContentProposal;case:VocabularyReflectionCase|null;reassessment:{eligible:boolean;source:VocabularyReassessmentSource|null;latest:{caseId:string;jobId:string;status:string;error:string|null}|null}|null;previews:{operationKey:string;source:VocabularyContent|null;result:VocabularyContentDraft}[]};
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
  saveDefaultUsefulSenses:(wordId:string,expectedVersion:number,includedSenseIds:string[])=>write<VocabularySenseCoverageWorkspace>(`/words/${id(wordId)}/sense-coverage`,{expectedVersion,includedSenseIds},'PUT'),
  wordSenseCoverage:(wordId:string)=>apiRequest<VocabularySenseCoverageWorkspace>(`${root}/words/${id(wordId)}/sense-coverage`),
  caseSenseCoverage:(caseId:string)=>apiRequest<VocabularySenseCoverageWorkspace>(`${root}/cases/${id(caseId)}/sense-coverage`),
  saveWordSenseCoverage:(wordId:string,expectedVersion:number,excludedSenseIds:string[])=>write<VocabularySenseCoverageWorkspace>(`/words/${id(wordId)}/sense-coverage`,{expectedVersion,excludedSenseIds},'PUT'),
  saveCaseSenseCoverage:(caseId:string,expectedVersion:number,includedSenseIds:string[]|null)=>write<VocabularySenseCoverageWorkspace>(`/cases/${id(caseId)}/sense-coverage`,{expectedVersion,includedSenseIds},'PUT'),
  cases:(kind:VocabularyReflectionCase['kind'])=>apiRequest<{items:VocabularyReflectionCase[]}>(`${root}/cases?kind=${kind}`),
  noProposalCases:(status:'completed'|'closed'='completed')=>apiRequest<{items:VocabularyReflectionCase[]}>(`${root}/no-proposal-cases?status=${status}`),
  reassessCase:(caseId:string,modelChoice:VocabularyReassessmentModel,expectedContentVersion:number)=>write<{caseId:string;jobId:string}>(`/cases/${id(caseId)}/reassessments`,{modelChoice,expectedContentVersion}),
  requestCaseSecondOpinion:(caseId:string,notes:string)=>write<{ok:true}>(`/cases/${id(caseId)}/second-opinions`,{notes}),
  workspace:(caseId:string)=>apiRequest<VocabularyCaseWorkspace>(`${root}/cases/${id(caseId)}`),
  approvalRequests:()=>apiRequest<{items:VocabularyApprovalRequest[]}>(`${root}/approval-requests`),
  requestApproval:(proposalId:string,expectedVersion:number,requestId:string,notes:string)=>write<VocabularyApprovalRequest>(`/proposals/${id(proposalId)}/approval-requests`,{expectedVersion,requestId,notes}),
  retryApproval:(requestId:string)=>write<VocabularyApprovalRequest>(`/approval-requests/${id(requestId)}/retry`,{}),
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
