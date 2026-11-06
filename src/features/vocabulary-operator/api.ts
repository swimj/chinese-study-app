import type { VocabularyReassessmentEditorialInput } from '../../domain/vocabulary-reflection';
import type { VocabularyDefaultSelectionAttention } from '../../domain/vocabulary-sense-coverage';
import type { VocabularyAttentionPage, VocabularyAttentionQuery } from '../../domain/vocabulary-attention';
import type { VocabularyDefaultSelectionFinding,VocabularySenseCoverageWorkspace } from '../../domain/vocabulary-sense-coverage';
import { apiRequest } from '../../services/api';
import type { VocabularyCaseQueueItem,VocabularyCaseQueuePage,VocabularyCaseQueueQuery } from '../../domain/vocabulary-case-queue';
import type { VocabularyContent,VocabularyContentDraft } from '../../domain/vocabulary-content';
import type { VocabularyRepairTargetWorkspace, VocabularyAssessmentReview, VocabularyApprovalRequest, VocabularySecondOpinion, VocabularyContentProposal, VocabularyProposalDraft, VocabularyProposalApplication, VocabularySenseLabel, VocabularyProposalOperation, VocabularyReflectionCase, VocabularyImprovementAdmission, VocabularyPureCueReferral, VocabularyPureCuePromotion } from '../../domain/vocabulary-reflection';

export type VocabularyReassessmentModel = 'openai:gpt-6-luna-high' | 'zai:glm-5.3-flash-high' | 'openai:gpt-6-sol-high';
export type VocabularyReassessmentSource={contentId:string;assessedVersion:number;currentVersion:number};
export type VocabularyCaseWorkspace={assessment?:VocabularyAssessmentReview;reassessmentUnavailableReason?:string|null;senseLabels?:VocabularySenseLabel[];defaultSelectionFinding?:VocabularyDefaultSelectionFinding|null;case:VocabularyReflectionCase;sources:VocabularyContent[];diagnosis?:import('../../domain/vocabulary-content').VocabularyJson;admission?:VocabularyImprovementAdmission;pureCueReferral?:VocabularyPureCueReferral|null;pureCuePromotion?:VocabularyPureCuePromotion;
  pureCueIdentityOptions?:{form:string;choices:{wordId:string;hanzi:string;traditional:string|null;pinyin:string;meaning:string}[]}[];
  reassessmentSource?:VocabularyReassessmentSource|null;
  reassessment?:{caseId:string;jobId:string;status:string;error:string|null}|null;
  jobs:{jobId:string;caseSequence?:number;kind:string;status:string;attemptNumber:number;error:string|null;secondOpinion:boolean;result:VocabularySecondOpinion['result']}[];proposals:VocabularyContentProposal[]};
export type VocabularyReviewSnapshot={currentSources?:VocabularyContent[];assessment?:VocabularyAssessmentReview|null;coverageChanged?:boolean;senseLabels?:VocabularySenseLabel[];defaultSelectionFinding?:VocabularyDefaultSelectionFinding|null;proposal:VocabularyContentProposal;case:VocabularyReflectionCase|null;reassessment:{eligible:boolean;unavailableReason?:string|null;source:VocabularyReassessmentSource|null;latest:{caseId:string;jobId:string;status:string;error:string|null}|null}|null;previews:{operationKey:string;source:VocabularyContent|null;result:VocabularyContentDraft}[]};
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
  attentionQueue:(query:VocabularyAttentionQuery={})=>{
    const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined)params.set(key,String(value));
    return apiRequest<VocabularyAttentionPage>(`${root}/attention-queue?${params}`);
  },
  caseQueue:(query:VocabularyCaseQueueQuery={})=>{
    const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined)params.set(key,String(value));
    return apiRequest<VocabularyCaseQueuePage>(`${root}/case-queue?${params}`);
  },
  caseCard:(caseId:string,proposalId?:string)=>apiRequest<VocabularyCaseQueueItem>(`${root}/case-queue/${id(caseId)}${proposalId?`?proposalId=${id(proposalId)}`:''}`),
  setCaseDeferred:(caseId:string,expectedVersion:number,deferred:boolean)=>write<VocabularyCaseQueueItem>(`/case-queue/${id(caseId)}/deferred`,{expectedVersion,deferred}),
  resolveCaseReview:(caseId:string,expectedVersion:number,reason='')=>write<VocabularyCaseQueueItem>(`/case-queue/${id(caseId)}/resolve`,{expectedVersion,reason}),
  addCaseNote:(caseId:string,expectedVersion:number,requestId:string,text:string)=>write<VocabularyCaseQueueItem>(`/case-queue/${id(caseId)}/notes`,{expectedVersion,requestId,text}),
  reassessCaseReview:(caseId:string,expectedVersion:number,modelChoice:VocabularyReassessmentModel,expectedContentVersion:number,originProposal?:{proposalId:string;expectedVersion:number},editorial?:VocabularyReassessmentEditorialInput)=>write<{caseId:string;jobId:string;item:VocabularyCaseQueueItem}>(`/case-queue/${id(caseId)}/reassess`,{expectedVersion,modelChoice,expectedContentVersion,originProposal,editorial}),
  saveDefaultUsefulSenses:(wordId:string,expectedVersion:number,includedSenseIds:string[])=>write<VocabularySenseCoverageWorkspace>(`/words/${id(wordId)}/sense-coverage`,{expectedVersion,includedSenseIds},'PUT'),
  wordSenseCoverage:(wordId:string)=>apiRequest<VocabularySenseCoverageWorkspace>(`${root}/words/${id(wordId)}/sense-coverage`),
  repairTarget:(caseId:string)=>apiRequest<VocabularyRepairTargetWorkspace>(`${root}/cases/${id(caseId)}/repair-target`),
  saveRepairTarget:(caseId:string,expectedVersion:number,senseId:string|null)=>write<VocabularyRepairTargetWorkspace>(`/cases/${id(caseId)}/repair-target`,{expectedVersion,senseId},'PUT'),
  saveRepertoireWordDefaultsAndReassess:(proposalId:string,input:{expectedVersion:number;expectedWordVersion:number;expectedCaseVersion:number;expectedContentVersion:number;includedSenseIds:string[];modelChoice:VocabularyReassessmentModel})=>write<{coverage:VocabularySenseCoverageWorkspace;caseId:string;jobId:string;item:VocabularyCaseQueueItem}>(`/proposals/${id(proposalId)}/word-defaults-reassessment`,input),
  saveRepertoireWordDefaults:(proposalId:string,expectedVersion:number,expectedWordVersion:number,includedSenseIds:string[])=>write<{proposal:VocabularyContentProposal;coverage:VocabularySenseCoverageWorkspace}>(`/proposals/${id(proposalId)}/word-defaults-revision`,{expectedVersion,expectedWordVersion,includedSenseIds}),
  saveWordSenseCoverage:(wordId:string,expectedVersion:number,excludedSenseIds:string[])=>write<VocabularySenseCoverageWorkspace>(`/words/${id(wordId)}/sense-coverage`,{expectedVersion,excludedSenseIds},'PUT'),
  cases:(kind:VocabularyReflectionCase['kind'])=>apiRequest<{items:VocabularyReflectionCase[]}>(`${root}/cases?kind=${kind}`),
  noProposalCases:(status:'completed'|'closed'='completed')=>apiRequest<{items:VocabularyReflectionCase[]}>(`${root}/no-proposal-cases?status=${status}`),
  resolvePureCueIdentities:(caseId:string,modelChoice:VocabularyReassessmentModel,expectedContentVersion:number,selections:{form:string;wordId:string}[])=>write<{caseId:string;jobId:string}>(`/cases/${id(caseId)}/pure-cue-resolutions`,{modelChoice,expectedContentVersion,selections}),
  reassessCase:(caseId:string,modelChoice:VocabularyReassessmentModel,expectedContentVersion:number,originProposal?:{proposalId:string;expectedVersion:number})=>write<{caseId:string;jobId:string}>(`/cases/${id(caseId)}/reassessments`,{modelChoice,expectedContentVersion,originProposal}),
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
  preparationFailures:()=>apiRequest<{items:VocabularyFailedPreparation[];defaultSelectionFindings?:VocabularyDefaultSelectionAttention[]}>(`${root}/practice-preparation/failures`),
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
