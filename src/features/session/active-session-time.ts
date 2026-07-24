export type ActiveSessionClock = {
  accumulatedMs: number;
  activeIntervalStartedAtMs: number | null;
  usesVisibilityApi: boolean;
};

export function createActiveSessionClock({
  nowMs,
  visibilityState,
  supportsVisibilityApi,
}: {
  nowMs: number;
  visibilityState: DocumentVisibilityState | undefined;
  supportsVisibilityApi: boolean;
}): ActiveSessionClock {
  return {
    accumulatedMs: 0,
    activeIntervalStartedAtMs: !supportsVisibilityApi || visibilityState === 'visible' ? nowMs : null,
    usesVisibilityApi: supportsVisibilityApi,
  };
}

export function updateActiveSessionClockForVisibility({
  clock,
  nowMs,
  visibilityState,
}: {
  clock: ActiveSessionClock;
  nowMs: number;
  visibilityState: DocumentVisibilityState;
}): ActiveSessionClock {
  if (!clock.usesVisibilityApi) {
    return clock;
  }

  const accumulatedMs = getActiveSessionDurationMs(clock, nowMs);
  return {
    ...clock,
    accumulatedMs,
    activeIntervalStartedAtMs: visibilityState === 'visible' ? nowMs : null,
  };
}

export function getActiveSessionDurationMs(clock: ActiveSessionClock, nowMs: number): number {
  const activeIntervalMs =
    clock.activeIntervalStartedAtMs === null ? 0 : Math.max(0, nowMs - clock.activeIntervalStartedAtMs);
  return Math.max(0, clock.accumulatedMs + activeIntervalMs);
}

export function finishActiveSessionClock(clock: ActiveSessionClock, nowMs: number): ActiveSessionClock {
  return {
    ...clock,
    accumulatedMs: getActiveSessionDurationMs(clock, nowMs),
    activeIntervalStartedAtMs: null,
  };
}
