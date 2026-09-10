import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  doesDietIntakeBlockSessionStart,
  INITIAL_DIET_INTAKE_SUBMISSION_STATE,
  retryDietIntakeRefresh,
  submitDietIntakePlacement,
  type DietIntakeSubmissionState,
} from '../src/features/diet/diet-intake-submission.ts';
import { buildDietIntakeAnswers } from '../src/features/diet/DietIntakePanel.tsx';

describe('diet intake placement submission', () => {
  test('blocks start through assessment and ordered post-save refresh', async () => {
    const events: string[] = [];
    const states: DietIntakeSubmissionState[] = [];

    await submitDietIntakePlacement({
      submitPlacement: async () => { events.push('submit'); },
      invalidateSessionPrefetch: () => { events.push('invalidate'); },
      reloadDashboard: async () => { events.push('dashboard'); },
      refreshSessionPrefetch: async () => { events.push('prefetch'); },
      onStateChange: (state) => { states.push(state); },
    });

    assert.deepEqual(events, ['submit', 'invalidate', 'dashboard', 'prefetch']);
    assert.deepEqual(states.map((state) => state.phase), ['assessing', 'refreshing', 'idle']);
    assert.equal(doesDietIntakeBlockSessionStart(states[0]!), true);
    assert.equal(doesDietIntakeBlockSessionStart(states[1]!), true);
    assert.equal(doesDietIntakeBlockSessionStart(states[2]!), false);
  });

  test('retains the distinction between an assessment failure and a saved placement refresh failure', async () => {
    const assessmentStates: DietIntakeSubmissionState[] = [];
    await submitDietIntakePlacement({
      submitPlacement: async () => { throw new Error('Provider unavailable'); },
      invalidateSessionPrefetch: () => { throw new Error('must not invalidate'); },
      reloadDashboard: async () => { throw new Error('must not reload'); },
      refreshSessionPrefetch: async () => { throw new Error('must not prefetch'); },
      onStateChange: (state) => { assessmentStates.push(state); },
    });
    assert.deepEqual(assessmentStates.map((state) => state.phase), ['assessing', 'assessment-error']);
    assert.equal(doesDietIntakeBlockSessionStart(assessmentStates[1]!), false);

    const refreshStates: DietIntakeSubmissionState[] = [];
    await submitDietIntakePlacement({
      submitPlacement: async () => undefined,
      invalidateSessionPrefetch: () => undefined,
      reloadDashboard: async () => undefined,
      refreshSessionPrefetch: async () => { throw new Error('Session refresh failed'); },
      onStateChange: (state) => { refreshStates.push(state); },
    });
    assert.deepEqual(refreshStates.map((state) => state.phase), ['assessing', 'refreshing', 'refresh-error']);
    assert.match(
      refreshStates[2]!.error ?? '',
      /Your starting point was saved, but the next session could not be refreshed\. Session refresh failed/,
    );
    assert.equal(doesDietIntakeBlockSessionStart(refreshStates[2]!), true);
  });

  test('retries only the saved placement refresh', async () => {
    const events: string[] = [];
    const states: DietIntakeSubmissionState[] = [];
    await retryDietIntakeRefresh({
      invalidateSessionPrefetch: () => { events.push('invalidate'); },
      reloadDashboard: async () => { events.push('dashboard'); },
      refreshSessionPrefetch: async () => { events.push('prefetch'); },
      onStateChange: (state) => { states.push(state); },
    });
    assert.deepEqual(events, ['invalidate', 'dashboard', 'prefetch']);
    assert.deepEqual(states, [
      { phase: 'refreshing', error: null },
      INITIAL_DIET_INTAKE_SUBMISSION_STATE,
    ]);
  });

  test('preserves typed answers for manual placement while skip remains empty', () => {
    assert.deepEqual(buildDietIntakeAnswers({
      background: '  I took classes years ago.  ',
      goals: '',
    }), [{
      prompt: 'What is your background with Chinese?',
      answer: 'I took classes years ago.',
    }]);
  });
});
