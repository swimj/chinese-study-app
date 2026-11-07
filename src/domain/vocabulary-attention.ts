import type { SenseContentReconciliationProgress } from './sense-content-reconciliation.ts';
import type { VocabularyReflectionCase } from './vocabulary-reflection.ts';
import type { VocabularyDefaultSelectionFinding } from './vocabulary-sense-coverage.ts';

export type VocabularyReconciliationAttentionChild = {id:string;kind:'source'|'preparation';sourceId:string;sourceContentId:string|null;reconciliationId?:string|null;caseId:null;reason:string;createdAt:string};
type AttentionBase = {id:string;title:string;reason:string;createdAt:string;caseId:string|null};
export type VocabularyAttentionItem = AttentionBase & (
  | {kind:'reconciliation';wordId:string;sourceContentId:string|null;resolutionId:string|null;status:'unresolved'|'draft'|'resolved'|'applied';progress:SenseContentReconciliationProgress;children:VocabularyReconciliationAttentionChild[]}
  | {kind:'defaults';wordId:string;finding:VocabularyDefaultSelectionFinding}
  | {kind:'approval';requestId:string;proposalId:string;expectedVersion:number;attempts:number;retryable:boolean}
  | {kind:'preparation';workId:string;wordId:string;sourceContentId:string|null;reconciliationId?:string|null;attemptCount:number;invocationId:string|null;retryable:boolean}
  | {kind:'dispatch';dispatchId:string;sessionId:string;learnerId:string}
  | {kind:'case';caseId:string;caseKind:VocabularyReflectionCase['kind'];jobId:string|null;retryable:boolean;sourceSuperseded:boolean;dismissible:boolean}
);
export type VocabularyAttentionKind = VocabularyAttentionItem['kind'];
export type VocabularyAttentionQuery = {offset?:number;limit?:number;kind?:VocabularyAttentionKind;anchorId?:string};
export type VocabularyAttentionPage = {items:VocabularyAttentionItem[];total:number;offset:number};
