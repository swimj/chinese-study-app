import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  hasUnseenFailedReflectionRuns,
  isFailedReflectionRunUnseen,
  nextFailedReflectionRunsSeenThroughAt,
  reflectionNavBadge,
} from '../src/features/attention/reflection-attention.ts';

describe('reflection attention badges', () => {
  test('hides the nav count while the Reflections tab is current', () => {
    assert.deepEqual(
      reflectionNavBadge({
        tabActive: true,
        unseenCount: 3,
        hasUnseenFailure: false,
        isGenerating: false,
      }),
      { kind: 'none' },
    );
  });

  test('shows the unseen Help count only while Reflections is not current', () => {
    assert.deepEqual(
      reflectionNavBadge({
        tabActive: false,
        unseenCount: 3,
        hasUnseenFailure: false,
        isGenerating: false,
      }),
      { kind: 'count', count: 3 },
    );
    assert.deepEqual(
      reflectionNavBadge({
        tabActive: false,
        unseenCount: 0,
        hasUnseenFailure: false,
        isGenerating: false,
      }),
      { kind: 'none' },
    );
  });

  test('gives a failed run priority over the Help count and hides both while the tab is current', () => {
    assert.deepEqual(
      reflectionNavBadge({
        tabActive: false,
        unseenCount: 2,
        hasUnseenFailure: true,
        isGenerating: false,
      }),
      { kind: 'failure' },
    );
    assert.deepEqual(
      reflectionNavBadge({
        tabActive: true,
        unseenCount: 2,
        hasUnseenFailure: true,
        isGenerating: false,
      }),
      { kind: 'none' },
    );
  });

  test('shows a generating spinner over the Help count, behind an unseen failure, and hides it on the current tab', () => {
    assert.deepEqual(
      reflectionNavBadge({
        tabActive: false,
        unseenCount: 3,
        hasUnseenFailure: false,
        isGenerating: true,
      }),
      { kind: 'generating' },
    );
    assert.deepEqual(
      reflectionNavBadge({
        tabActive: false,
        unseenCount: 3,
        hasUnseenFailure: true,
        isGenerating: true,
      }),
      { kind: 'failure' },
    );
    assert.deepEqual(
      reflectionNavBadge({
        tabActive: true,
        unseenCount: 3,
        hasUnseenFailure: false,
        isGenerating: true,
      }),
      { kind: 'none' },
    );
  });

  test('treats failed runs at or before the seen-through cursor as acknowledged across reload', () => {
    const seenThrough = '2026-08-18T08:05:00.000Z';
    assert.equal(isFailedReflectionRunUnseen('2026-08-18T08:05:00.000Z', null), true);
    assert.equal(isFailedReflectionRunUnseen('2026-08-18T08:05:00.000Z', seenThrough), false);
    assert.equal(isFailedReflectionRunUnseen('2026-08-18T09:00:00.000Z', seenThrough), true);
    assert.equal(
      hasUnseenFailedReflectionRuns(['2026-08-18T08:05:00.000Z'], seenThrough),
      false,
    );
    assert.equal(
      hasUnseenFailedReflectionRuns(
        ['2026-08-18T08:05:00.000Z', '2026-08-18T09:00:00.000Z'],
        seenThrough,
      ),
      true,
    );
    assert.equal(
      nextFailedReflectionRunsSeenThroughAt(seenThrough, '2026-08-18T08:00:00.000Z'),
      seenThrough,
    );
    assert.equal(
      nextFailedReflectionRunsSeenThroughAt(seenThrough, '2026-08-18T09:00:00.000Z'),
      '2026-08-18T09:00:00.000Z',
    );
  });
});
