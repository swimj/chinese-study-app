import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VocabularyApprovalRequest } from '../src/domain/vocabulary-reflection.ts';
import { approvalNeedsAttention, mergeApprovalRequests, proposalHasApprovalRequest } from '../src/features/vocabulary-operator/approval-state.ts';

function request(patch: Partial<VocabularyApprovalRequest> = {}): VocabularyApprovalRequest {
  return { requestId: 'request', proposalId: 'proposal', expectedVersion: 2, actorId: 'operator',
    notes: '', status: 'queued', attempts: 0, createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z', error: null, application: null, ...patch };
}
test('persisted approvals leave review at their exact revision, including attention and completed requests', () => {
  for (const status of ['queued', 'running', 'attention', 'succeeded'] as const) {
    assert.equal(proposalHasApprovalRequest({ proposalId: 'proposal', version: 2 }, [request({ status })]), true);
    assert.equal(proposalHasApprovalRequest({ proposalId: 'proposal', version: 3 }, [request({ status })]), false);
    assert.equal(proposalHasApprovalRequest({ proposalId: 'other', version: 2 }, [request({ status })]), false);
  }
});
test('queue refresh preserves acknowledged requests missing from an older response and never reverts a newer outcome', () => {
  const acknowledged = request();
  assert.deepEqual(mergeApprovalRequests([acknowledged], []), [acknowledged]);
  const failed = request({ status: 'attention', attempts: 1, error: 'source changed', updatedAt: '2026-10-28T12:00:01.000Z' });
  assert.deepEqual(mergeApprovalRequests([failed], [acknowledged]), [failed]);
  const retried = request({ updatedAt: '2026-10-28T12:00:02.000Z' });
  assert.deepEqual(mergeApprovalRequests([failed], [retried]), [retried]);
  assert.deepEqual(mergeApprovalRequests([retried], [failed]), [retried]);
  assert.equal(mergeApprovalRequests([retried], [request({ requestId: 'second', proposalId: 'other' })]).length, 2);
});

test('attention clears when the failed revision is superseded or its proposal is resolved', () => {
  const failed = request({ status: 'attention', error: 'validation failed' });
  const proposal = { proposalId: 'proposal', version: 2, status: 'awaiting_review' as const };
  assert.equal(approvalNeedsAttention(failed, [proposal]), true);
  assert.equal(approvalNeedsAttention(failed, []), true);
  assert.equal(approvalNeedsAttention(failed, [{ ...proposal, version: 3 }]), false);
  assert.equal(approvalNeedsAttention(failed, [{ ...proposal, status: 'closed' }]), false);
  assert.equal(approvalNeedsAttention(failed, [{ ...proposal, status: 'applied' }]), false);
  assert.equal(approvalNeedsAttention(request(), [proposal]), false);
});
