import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createActiveSessionClock,
  finishActiveSessionClock,
  getActiveSessionDurationMs,
  updateActiveSessionClockForVisibility,
} from '../src/features/session/active-session-time.ts';

describe('active session time', () => {
  test('counts only visible intervals when the Visibility API is available', () => {
    let clock = createActiveSessionClock({
      nowMs: 1_000,
      visibilityState: 'visible',
      supportsVisibilityApi: true,
    });
    assert.equal(getActiveSessionDurationMs(clock, 4_000), 3_000);

    clock = updateActiveSessionClockForVisibility({ clock, nowMs: 4_000, visibilityState: 'hidden' });
    assert.equal(getActiveSessionDurationMs(clock, 10_000), 3_000);

    clock = updateActiveSessionClockForVisibility({ clock, nowMs: 10_000, visibilityState: 'visible' });
    assert.equal(getActiveSessionDurationMs(clock, 12_500), 5_500);

    clock = finishActiveSessionClock(clock, 12_500);
    assert.equal(getActiveSessionDurationMs(clock, 20_000), 5_500);
  });

  test('uses wall-clock time when the Visibility API is unavailable', () => {
    const clock = createActiveSessionClock({
      nowMs: 1_000,
      visibilityState: undefined,
      supportsVisibilityApi: false,
    });
    const unchanged = updateActiveSessionClockForVisibility({ clock, nowMs: 4_000, visibilityState: 'hidden' });

    assert.equal(getActiveSessionDurationMs(unchanged, 7_000), 6_000);
  });
});
