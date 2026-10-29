import type { SessionDebrief } from '../../domain/session-debrief';

export type SessionDebriefLoadState = {
  debrief: SessionDebrief | null;
  loading: boolean;
  retrying: boolean;
  error: string | null;
};
export const INITIAL_DEBRIEF_LOAD_STATE: SessionDebriefLoadState = {
  debrief: null, loading: true, retrying: false, error: null,
};

/** One mounted surface owns its requests. Latest is resolved once, then pinned. */
export function createSessionDebriefLoader({ sessionId, api, onChange, schedule = setTimeout, cancel = clearTimeout }: {
  sessionId?: string;
  api: {
    latest: (signal: AbortSignal) => Promise<SessionDebrief | null>;
    get: (sessionId: string, signal: AbortSignal) => Promise<SessionDebrief | null>;
    retry: (sessionId: string, signal: AbortSignal) => Promise<SessionDebrief>;
  };
  onChange: (state: SessionDebriefLoadState) => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let state = INITIAL_DEBRIEF_LOAD_STATE;
  let targetId = sessionId;
  let epoch = 0;
  let disposed = false;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function publish(next: SessionDebriefLoadState) {
    if (disposed) return;
    state = next;
    onChange(next);
  }
  function begin() {
    epoch += 1;
    request?.abort();
    if (timer !== null) cancel(timer);
    timer = null;
    request = new AbortController();
    return { token: epoch, signal: request.signal };
  }
  function isCurrent(token: number) { return !disposed && token === epoch; }
  function accept(debrief: SessionDebrief | null) {
    if (debrief && targetId && debrief.sessionId !== targetId) {
      throw new Error('Session summary response did not match the requested session.');
    }
    targetId ??= debrief?.sessionId;
    publish({ debrief, loading: false, retrying: false, error: null });
    if (debrief?.status === 'queued' || debrief?.status === 'running') {
      timer = schedule(() => { timer = null; void reload(); }, 1500);
    }
  }
  async function reload() {
    if (disposed) return;
    const { token, signal } = begin();
    publish({ ...state, loading: state.debrief === null, retrying: false, error: null });
    try {
      const debrief = targetId ? await api.get(targetId, signal) : await api.latest(signal);
      if (isCurrent(token)) accept(debrief);
    } catch (error) {
      if (isCurrent(token)) publish({ ...state, loading: false, retrying: false,
        error: error instanceof Error ? error.message : 'Could not load session summary.' });
    }
  }
  async function retry() {
    if (disposed || state.retrying || state.debrief?.status !== 'failed' || !targetId) return;
    const { token, signal } = begin();
    publish({ ...state, retrying: true, error: null });
    try {
      const debrief = await api.retry(targetId, signal);
      if (isCurrent(token)) accept(debrief);
    } catch (error) {
      if (!isCurrent(token)) return;
      // A lost POST response may already have enqueued the job. Read before
      // presenting another retry so we never replay an unknown outcome.
      try {
        const debrief = await api.get(targetId, signal);
        if (!isCurrent(token)) return;
        if (debrief && debrief.status !== 'failed') { accept(debrief); return; }
      } catch { /* Preserve the explicit retry error if recovery is unavailable. */ }
      if (isCurrent(token)) publish({ ...state, retrying: false,
        error: error instanceof Error ? error.message : 'Could not retry session summary.' });
    }
  }
  return { reload, retry, dispose() {
    disposed = true;
    epoch += 1;
    request?.abort();
    if (timer !== null) cancel(timer);
  } };
}
