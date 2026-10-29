import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterArchiveItems, resolveReviewNavigation, reviewItemKey, type ReviewItem } from '../src/features/vocabulary-operator/review-navigation.ts';

const context = { index: 1, count: 3, busy: false, nativeTarget: false };
test('operator review arrows traverse the current queue without wrapping or invoking mutations', () => {
  assert.equal(resolveReviewNavigation({ key: 'ArrowLeft' }, context), 0);
  assert.equal(resolveReviewNavigation({ key: 'ArrowRight' }, context), 2);
  assert.equal(resolveReviewNavigation({ key: 'ArrowLeft' }, { ...context, index: 0 }), null);
  assert.equal(resolveReviewNavigation({ key: 'ArrowRight' }, { ...context, index: 2 }), null);
  assert.equal(resolveReviewNavigation({ key: 'ArrowRight' }, { ...context, count: 0 }), null);
  for (const key of ['Enter', ' ', 'a', 'd']) assert.equal(resolveReviewNavigation({ key }, context), null);
});
test('operator navigation preserves native controls, editing, composition and modified keys', () => {
  assert.equal(resolveReviewNavigation({ key: 'ArrowRight' }, { ...context, nativeTarget: true }), null);
  assert.equal(resolveReviewNavigation({ key: 'ArrowRight' }, { ...context, busy: true }), null);
  for (const blocked of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { repeat: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    assert.equal(resolveReviewNavigation({ key: 'ArrowRight', ...blocked }, context), null);
  }
});

const now = Date.parse('2026-10-28T16:00:00.000Z');
function archivedProposal(id: string, status: 'applied' | 'closed', resolvedAt: string | null): ReviewItem {
  return { kind: 'proposal', value: { proposalId: id, caseId: null, version: 1, status, resolvedAt,
    operations: [], rationale: id, bases: [], invocationId: null, authorKind: 'operator', authorId: 'editor' } };
}
const closedCase: ReviewItem = { kind: 'case', value: { caseId: 'no-change', completionId: 'completion',
  learnerId: 'learner', kind: 'exercise_improvement', wordId: 'word', contentId: 'content', status: 'closed',
  evidence: [], createdAt: '2026-10-01T00:00:00.000Z', resolvedAt: '2026-10-28T14:00:00.000Z' } };
test('Archive includes every resolution type in its exact 12-hour window and sorts by resolution time', () => {
  const items = [archivedProposal('old', 'applied', '2026-10-28T03:59:59.999Z'),
    archivedProposal('edge', 'closed', '2026-10-28T04:00:00.000Z'), closedCase,
    archivedProposal('applied', 'applied', '2026-10-28T15:00:00.000Z'),
    archivedProposal('future', 'closed', '2026-10-28T16:00:00.001Z'),
    archivedProposal('unknown', 'closed', null), archivedProposal('invalid', 'closed', 'invalid')];
  assert.deepEqual(filterArchiveItems(items, '', now).map(reviewItemKey), ['proposal:applied', 'case:no-change', 'proposal:edge']);
  assert.deepEqual(filterArchiveItems(items, '  OLD  ', now).map(reviewItemKey), ['proposal:old']);
  assert.deepEqual(filterArchiveItems(items, 'unknown', now).map(reviewItemKey), ['proposal:unknown']);
  assert.deepEqual(filterArchiveItems(items, 'missing', now), []);
  assert.deepEqual(filterArchiveItems([closedCase], '', now + 12 * 60 * 60 * 1000), []);
});
