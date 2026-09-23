import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addInFlightSessionReflection,
  beginSessionFinalization,
  completeSessionFinalization,
  completeSessionReflectionGeneration,
  createInFlightSessionReflectionIds,
  createSessionFinalizationState,
  failSessionReflectionGeneration,
  finalizeSessionBeforeReflection,
  hasInFlightSessionReflection,
  isCurrentSessionReflectionRequest,
  isSessionReflectionGenerating,
  removeInFlightSessionReflection,
  resetFailedSessionFinalization,
  retrySessionReflectionGeneration,
  runExclusiveAsync,
  sessionHidesAppChrome,
  shouldFinishSessionOnLeave,
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
    assert.equal(isSessionReflectionGenerating(finalized), true);

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
    assert.equal(isSessionReflectionGenerating(succeeded), false);
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

  test('only a completed summary can finish implicitly on in-app leave', () => {
    assert.equal(shouldFinishSessionOnLeave({
      sessionStarted: true,
      sessionPhase: 'completed',
      finalizationKind: 'unfinalized',
    }), true);
    assert.equal(shouldFinishSessionOnLeave({
      sessionStarted: true,
      sessionPhase: 'completed',
      finalizationKind: 'finalizing',
    }), true);
    assert.equal(shouldFinishSessionOnLeave({
      sessionStarted: true,
      sessionPhase: 'completed',
      finalizationKind: 'finalized',
    }), false);
    assert.equal(shouldFinishSessionOnLeave({
      sessionStarted: true,
      sessionPhase: 'active',
      finalizationKind: 'unfinalized',
    }), false);
    assert.equal(shouldFinishSessionOnLeave({
      sessionStarted: true,
      sessionPhase: 'draining',
      finalizationKind: 'unfinalized',
    }), false);
    assert.equal(shouldFinishSessionOnLeave({
      sessionStarted: false,
      sessionPhase: 'completed',
      finalizationKind: 'unfinalized',
    }), false);
  });

  test('hides app chrome only while a live session has not reached the summary', () => {
    assert.equal(sessionHidesAppChrome({ sessionStarted: true, sessionPhase: 'active' }), true);
    assert.equal(sessionHidesAppChrome({ sessionStarted: true, sessionPhase: 'draining' }), true);
    assert.equal(sessionHidesAppChrome({ sessionStarted: true, sessionPhase: 'completed' }), false);
    assert.equal(sessionHidesAppChrome({ sessionStarted: false, sessionPhase: null }), false);
  });

  test('overlapping finish callers share one in-flight run', async () => {
    const slot: { current: Promise<void> | null } = { current: null };
    let starts = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = runExclusiveAsync(slot, async () => {
      starts += 1;
      await gate;
    });
    const second = runExclusiveAsync(slot, async () => {
      starts += 1;
    });
    release();
    await Promise.all([first, second]);
    assert.equal(starts, 1);

    await runExclusiveAsync(slot, async () => {
      starts += 1;
    });
    assert.equal(starts, 2);
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

  test('keeps in-flight generation after the summary is closed', () => {
    const generating = completeSessionFinalization({
      state: beginSessionFinalization(createSessionFinalizationState()),
      hasReflectionEvidence: true,
    });
    let inFlight = addInFlightSessionReflection(
      createInFlightSessionReflectionIds(),
      'session-1',
    );

    assert.equal(isSessionReflectionGenerating(generating), true);
    assert.equal(hasInFlightSessionReflection(inFlight), true);

    const closedSummary = createSessionFinalizationState();
    assert.equal(isSessionReflectionGenerating(closedSummary), false);
    assert.equal(hasInFlightSessionReflection(inFlight), true);
    assert.equal(isCurrentSessionReflectionRequest({
      activeSessionId: null,
      requestSessionId: 'session-1',
    }), false);

    inFlight = addInFlightSessionReflection(inFlight, 'session-2');
    inFlight = removeInFlightSessionReflection(inFlight, 'session-1');
    assert.equal(hasInFlightSessionReflection(inFlight), true);

    inFlight = removeInFlightSessionReflection(inFlight, 'session-2');
    assert.equal(hasInFlightSessionReflection(inFlight), false);
  });
});
