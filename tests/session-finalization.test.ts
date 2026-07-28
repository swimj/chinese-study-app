import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  beginSessionFinalization,
  completeSessionFinalization,
  completeSessionReflectionGeneration,
  createSessionFinalizationState,
  failSessionReflectionGeneration,
  finalizeSessionBeforeReflection,
  isCurrentSessionReflectionRequest,
  resetFailedSessionFinalization,
  retrySessionReflectionGeneration,
} from '../src/features/session/session-finalization.ts';

describe('completed-session finalization', () => {
  test('keeps finalization and best-effort reflection as separate state boundaries', () => {
    const finalizing = beginSessionFinalization(createSessionFinalizationState());
    const finalized = completeSessionFinalization({
      state: finalizing,
      hasReflectionEvidence: true,
    });
    assert.deepEqual(finalized, {
      kind: 'finalized',
      reflection: { kind: 'generating' },
    });

    const failed = failSessionReflectionGeneration(finalized, 'Provider unavailable');
    assert.deepEqual(failed, {
      kind: 'finalized',
      reflection: {
        kind: 'failed',
        error: 'Provider unavailable',
        retryable: true,
      },
    });

    const retrying = retrySessionReflectionGeneration(failed);
    const succeeded = completeSessionReflectionGeneration(retrying, {
      artifactId: 'artifact-1',
      proposalCount: 2,
      status: 'created',
    });
    assert.deepEqual(succeeded, {
      kind: 'finalized',
      reflection: {
        kind: 'succeeded',
        artifactId: 'artifact-1',
        proposalCount: 2,
        status: 'created',
      },
    });
  });

  test('marks a finalized session with no qualifying evidence as skipped', () => {
    const state = completeSessionFinalization({
      state: beginSessionFinalization(createSessionFinalizationState()),
      hasReflectionEvidence: false,
    });
    assert.deepEqual(state, {
      kind: 'finalized',
      reflection: { kind: 'skipped' },
    });
  });

  test('flushes the pending commit before recording the summary', async () => {
    const calls: string[] = [];
    const result = await finalizeSessionBeforeReflection({
      flushPendingCommit: async () => {
        calls.push('commit');
        return 'durable evidence';
      },
      recordSummary: async () => {
        calls.push('summary');
      },
    });

    assert.equal(result, 'durable evidence');
    assert.deepEqual(calls, ['commit', 'summary']);
  });

  test('does not record the summary or begin reflection when the final commit fails', async () => {
    let summaryRecorded = false;
    await assert.rejects(
      finalizeSessionBeforeReflection({
        flushPendingCommit: async () => {
          throw new Error('commit failed');
        },
        recordSummary: async () => {
          summaryRecorded = true;
        },
      }),
      /commit failed/,
    );
    assert.equal(summaryRecorded, false);

    const finalizing = beginSessionFinalization(createSessionFinalizationState());
    assert.deepEqual(resetFailedSessionFinalization(finalizing), { kind: 'unfinalized' });
  });

  test('rejects invalid finalization transitions', () => {
    assert.throws(
      () => beginSessionFinalization({ kind: 'finalizing' }),
      /cannot finish/,
    );
    assert.throws(
      () => retrySessionReflectionGeneration({
        kind: 'finalized',
        reflection: { kind: 'skipped' },
      }),
      /expected finalized\/failed/,
    );
    assert.throws(
      () => retrySessionReflectionGeneration({
        kind: 'finalized',
        reflection: {
          kind: 'failed',
          error: 'Evidence could not be assembled',
          retryable: false,
        },
      }),
      /not retryable/,
    );
  });

  test('ignores a reflection response after close or after another session starts', () => {
    assert.equal(isCurrentSessionReflectionRequest({
      activeSessionId: null,
      requestSessionId: 'session-1',
    }), false);
    assert.equal(isCurrentSessionReflectionRequest({
      activeSessionId: 'session-2',
      requestSessionId: 'session-1',
    }), false);
    assert.equal(isCurrentSessionReflectionRequest({
      activeSessionId: 'session-1',
      requestSessionId: 'session-1',
    }), true);
  });
});
