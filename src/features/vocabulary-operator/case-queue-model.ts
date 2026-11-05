import type { VocabularyCaseQueueItem, VocabularyCaseQueuePage } from '../../domain/vocabulary-case-queue';

export const CASE_QUEUE_BATCH_SIZE = 20;
export const CASE_QUEUE_WINDOW_PAGES = 3;
export type CaseQueueWindow = { cursor: string | null; page: VocabularyCaseQueuePage }[];

export type CaseRefreshContext = {
  view:string;query:string;selectedId:string|null;detailKey:string|null;
  busy:boolean;dirty:boolean;approvalUnconfirmed:boolean;
};
/** A request started before navigation or editing cannot replace the new review workspace. */
export function canInstallCaseRefresh(started:CaseRefreshContext,current:CaseRefreshContext):boolean {
  return started.view===current.view&&started.query===current.query&&started.selectedId===current.selectedId
    &&started.detailKey===current.detailKey&&!current.busy&&!current.dirty&&!current.approvalUnconfirmed;
}
export function approvalOutcomeUncertain(status:number|undefined):boolean {
  return status===undefined||status<400||status>=500;
}
/** Live case metadata is authoritative even when it clears an older snapshot's lock. */
export function caseReviewLocked(caseId:string|undefined,live:Pick<VocabularyCaseQueueItem,'caseId'|'frozen'|'approvalState'>|null|undefined,snapshot:{frozen:boolean;approvalState:VocabularyCaseQueueItem['approvalState']}|null|undefined):boolean {
  const review=live&&live.caseId===caseId?live:snapshot;
  return !!review&&(review.frozen||review.approvalState==='pending');
}

export function queueWindowItems(pages: CaseQueueWindow): VocabularyCaseQueueItem[] {
  const items = new Map<string, VocabularyCaseQueueItem>();
  for (const { page } of pages) for (const item of page.items) {
    const previous = items.get(item.caseId);
    // Equal case versions may carry fresher shared-source state. Never discard that projection.
    if (!previous || item.version >= previous.version) items.set(item.caseId, item);
  }
  return [...items.values()];
}

export function replaceCaseProjection(pages: CaseQueueWindow, item: VocabularyCaseQueueItem): CaseQueueWindow {
  return pages.map(entry => ({ ...entry, page: { ...entry.page, items: entry.page.items.map(previous => previous.caseId === item.caseId && item.version >= previous.version ? item : previous) } }));
}

export function removeCaseFromWindow(pages: CaseQueueWindow, caseId: string): CaseQueueWindow {
  return pages.map(entry => ({ ...entry, page: { ...entry.page, items: entry.page.items.filter(item => item.caseId !== caseId) } }));
}

/** The next case stays in the resolved case's slot, including last/only-case boundaries. */
export function selectionAfterCaseRemoval(items: readonly Pick<VocabularyCaseQueueItem, 'caseId'>[], caseId: string): string | null {
  const index = items.findIndex(item => item.caseId === caseId);
  if (index < 0) throw new Error('Resolved case is not in the loaded queue');
  const remaining = items.filter(item => item.caseId !== caseId);
  return remaining[Math.min(index, remaining.length - 1)]?.caseId ?? null;
}

export function caseCanReview(item: VocabularyCaseQueueItem): boolean {
  return item.state === 'open' && item.approvalState !== 'pending' && item.approvalState !== 'attention';
}

export function canRetryLatestCaseJob(item: VocabularyCaseQueueItem): boolean {
  return item.state === 'open' && !item.activeJob && item.approvalState !== 'pending'
    && item.latestJob?.status === 'failed' && item.latestJob.error !== 'source_conflict';
}
