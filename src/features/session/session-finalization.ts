export type SessionReflectionGenerationState =
  | { kind: 'skipped' }
  | { kind: 'generating' }
  | {
      kind: 'succeeded';
      artifactId: string;
      proposalCount: number;
      status: 'created' | 'existing';
    }
  | {
      kind: 'failed';
      error: string;
      retryable: boolean;
    };

export type SessionFinalizationState =
  | { kind: 'unfinalized' }
  | { kind: 'finalizing' }
  | {
      kind: 'finalized';
      reflection: SessionReflectionGenerationState;
    };

export function createSessionFinalizationState(): SessionFinalizationState {
  return { kind: 'unfinalized' };
}

export function beginSessionFinalization(
  state: SessionFinalizationState,
): SessionFinalizationState {
  if (state.kind !== 'unfinalized') {
    throw new Error(`Session finalization invariant violated: cannot finish from "${state.kind}".`);
  }
  return { kind: 'finalizing' };
}

export function completeSessionFinalization({
  state,
  hasReflectionEvidence,
}: {
  state: SessionFinalizationState;
  hasReflectionEvidence: boolean;
}): SessionFinalizationState {
  if (state.kind !== 'finalizing') {
    throw new Error(`Session finalization invariant violated: cannot finalize from "${state.kind}".`);
  }
  return {
    kind: 'finalized',
    reflection: hasReflectionEvidence
      ? { kind: 'generating' }
      : { kind: 'skipped' },
  };
}

export function resetFailedSessionFinalization(
  state: SessionFinalizationState,
): SessionFinalizationState {
  if (state.kind !== 'finalizing') {
    throw new Error(`Session finalization invariant violated: cannot reset from "${state.kind}".`);
  }
  return { kind: 'unfinalized' };
}

export function completeSessionReflectionGeneration(
  state: SessionFinalizationState,
  result: {
    artifactId: string;
    proposalCount: number;
    status: 'created' | 'existing';
  },
): SessionFinalizationState {
  assertReflectionState(state, 'generating');
  return {
    kind: 'finalized',
    reflection: {
      kind: 'succeeded',
      ...result,
    },
  };
}

export function failSessionReflectionGeneration(
  state: SessionFinalizationState,
  error: string,
  { retryable = true }: { retryable?: boolean } = {},
): SessionFinalizationState {
  assertReflectionState(state, 'generating');
  return {
    kind: 'finalized',
    reflection: {
      kind: 'failed',
      error,
      retryable,
    },
  };
}

export function retrySessionReflectionGeneration(
  state: SessionFinalizationState,
): SessionFinalizationState {
  assertReflectionState(state, 'failed');
  if (!state.reflection.retryable) {
    throw new Error('Session finalization invariant violated: reflection failure is not retryable.');
  }
  return {
    kind: 'finalized',
    reflection: { kind: 'generating' },
  };
}

export async function finalizeSessionBeforeReflection<T>({
  flushPendingCommit,
  recordSummary,
}: {
  flushPendingCommit: () => Promise<T>;
  recordSummary: () => Promise<void>;
}): Promise<T> {
  const result = await flushPendingCommit();
  await recordSummary();
  return result;
}

export function isCurrentSessionReflectionRequest({
  activeSessionId,
  requestSessionId,
}: {
  activeSessionId: string | null;
  requestSessionId: string;
}): boolean {
  return activeSessionId === requestSessionId;
}

function assertReflectionState<TKind extends SessionReflectionGenerationState['kind']>(
  state: SessionFinalizationState,
  expectedKind: TKind,
): asserts state is {
  kind: 'finalized';
  reflection: Extract<SessionReflectionGenerationState, { kind: TKind }>;
} {
  if (state.kind !== 'finalized' || state.reflection.kind !== expectedKind) {
    const actualKind = state.kind === 'finalized'
      ? `finalized/${state.reflection.kind}`
      : state.kind;
    throw new Error(
      `Session finalization invariant violated: expected finalized/${expectedKind}, received "${actualKind}".`,
    );
  }
}
