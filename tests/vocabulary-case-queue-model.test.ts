import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvalOutcomeUncertain, canInstallCaseRefresh, caseReviewLocked, caseCanReview, canRetryLatestCaseJob, queueWindowItems, removeCaseFromWindow, replaceCaseProjection, selectionAfterCaseRemoval, type CaseQueueWindow, type CaseRefreshContext } from '../src/features/vocabulary-operator/case-queue-model.ts';
import { caseReviewFixture } from './fixtures/case-review-data.ts';

test('queue projections replace equal-version shared-source metadata without moving stable case identity', () => {
  const original = caseReviewFixture(), other = caseReviewFixture(2);
  const pages: CaseQueueWindow = [{ cursor: null, page: { items: [original, other], nextCursor: null } }];
  const changed = { ...original, stale: true, sources: original.sources.map(source => ({ ...source, version: 2 })) };
  const updated = queueWindowItems(replaceCaseProjection(pages, changed));
  assert.deepEqual(updated.map(item => item.caseId), [original.caseId, other.caseId]);
  assert.equal(updated[0].stale, true); assert.equal(updated[0].sources[0].version, 2);
  assert.equal(updated[0].version, original.version);
  const newer = { ...changed, version: 3 };
  assert.equal(queueWindowItems(replaceCaseProjection(replaceCaseProjection(pages, newer), original))[0].version, 3);
});

test('overlapping refreshed pages deduplicate a case and retain the newest projection', () => {
  const first = caseReviewFixture(), second = caseReviewFixture(2), third = caseReviewFixture(3);
  const entries: CaseQueueWindow = [{ cursor: null, page: { items: [first, second], nextCursor: 'next' } }, { cursor: 'next', page: { items: [{ ...second, version: 2 }, third], nextCursor: null } }];
  const items = queueWindowItems(entries);
  assert.deepEqual(items.map(item => item.caseId), [first.caseId, second.caseId, third.caseId]);
  assert.equal(items[1].version, 2);
  assert.deepEqual(queueWindowItems(removeCaseFromWindow(entries, second.caseId)).map(item => item.caseId), [first.caseId, third.caseId]);
});

test('resolution preserves the cursor for first, middle, last and only case', () => {
  const cases = [caseReviewFixture(), caseReviewFixture(2), caseReviewFixture(3)];
  assert.equal(selectionAfterCaseRemoval(cases, cases[0].caseId), cases[1].caseId);
  assert.equal(selectionAfterCaseRemoval(cases, cases[1].caseId), cases[2].caseId);
  assert.equal(selectionAfterCaseRemoval(cases, cases[2].caseId), cases[1].caseId);
  assert.equal(selectionAfterCaseRemoval([cases[0]], cases[0].caseId), null);
  assert.throws(() => selectionAfterCaseRemoval(cases, 'missing'), /not in the loaded queue/);
});

test('pending and attention approvals leave review while reassessment keeps its case visible', () => {
  const item = caseReviewFixture();
  assert.equal(caseCanReview(item), true);
  assert.equal(caseCanReview({ ...item, frozen: true }), true);
  assert.equal(caseCanReview({ ...item, approvalState: 'pending' }), false);
  assert.equal(caseCanReview({ ...item, approvalState: 'attention' }), false);
  assert.equal(caseCanReview({ ...item, state: 'resolved' }), false);
});

test('latest failed assessment permits explicit retry except stale source and concurrent work', () => {
  const item = caseReviewFixture(); item.latestJob = { jobId: 'retry', sequence: 2, status: 'failed', error: 'provider_failed', advisory: false };
  assert.equal(canRetryLatestCaseJob(item), true);
  assert.equal(canRetryLatestCaseJob({ ...item, latestJob: { ...item.latestJob, error: 'source_conflict' } }), false);
  assert.equal(canRetryLatestCaseJob({ ...item, approvalState: 'pending' }), false);
  assert.equal(canRetryLatestCaseJob({ ...item, activeJob: { jobId: 'running', sequence: 3, status: 'running' } }), false);
  assert.equal(canRetryLatestCaseJob({ ...item, state: 'resolved' }), false);
});

test('a refresh response cannot replace a workspace entered or edited while its request was in flight',()=>{
  const started:CaseRefreshContext={view:'review',query:'',selectedId:'case-1',detailKey:null,busy:false,dirty:false,approvalUnconfirmed:false};
  assert.equal(canInstallCaseRefresh(started,{...started}),true);
  assert.equal(canInstallCaseRefresh(started,{...started,selectedId:'case-2'}),false);
  assert.equal(canInstallCaseRefresh(started,{...started,detailKey:'case-1:proposal-1'}),false);
  const detail={...started,detailKey:'case-1:proposal-1'};
  assert.equal(canInstallCaseRefresh(detail,{...detail,dirty:true}),false);
  assert.equal(canInstallCaseRefresh(detail,{...detail,busy:true}),false);
  assert.equal(canInstallCaseRefresh(detail,{...detail,approvalUnconfirmed:true}),false);
  assert.equal(canInstallCaseRefresh(detail,{...detail,detailKey:'case-1:proposal-2'}),false);
  assert.equal(canInstallCaseRefresh(started,{...started,view:'history'}),false);
});

test('only uncertain approval outcomes retain their request identity',()=>{
  assert.equal(approvalOutcomeUncertain(409),false);
  assert.equal(approvalOutcomeUncertain(403),false);
  assert.equal(approvalOutcomeUncertain(422),false);
  assert.equal(approvalOutcomeUncertain(500),true);
  assert.equal(approvalOutcomeUncertain(undefined),true);
});

test('matching fresh case projection clears frozen and pending flags from a pinned editor snapshot',()=>{
  const current=caseReviewFixture();
  assert.equal(caseReviewLocked(current.caseId,current,{frozen:true,approvalState:'pending'}),false);
  assert.equal(caseReviewLocked(current.caseId,{...current,frozen:true},{frozen:false,approvalState:null}),true);
  assert.equal(caseReviewLocked(current.caseId,{...current,approvalState:'pending'},{frozen:false,approvalState:null}),true);
  assert.equal(caseReviewLocked(current.caseId,null,{frozen:true,approvalState:null}),true);
  assert.equal(caseReviewLocked(undefined,undefined,{frozen:true,approvalState:null}),true);
  assert.equal(caseReviewLocked('other-case',current,{frozen:true,approvalState:null}),true);
});
