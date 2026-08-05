import {
  fetchSessionPayload,
  type SessionPayload,
} from '../../services/api';

export type SessionPrefetchStatus = 'idle' | 'pending' | 'ready' | 'error';

export type SessionPrefetchState = {
  status: SessionPrefetchStatus;
  payload: SessionPayload | null;
  fetchedAt: string | null;
  error: string | null;
};

let sessionPrefetchPromise: Promise<SessionPayload> | null = null;
let sessionPrefetchGeneration = 0;
let sessionPrefetchStateCache: SessionPrefetchState = {
  status: 'idle',
  payload: null,
  fetchedAt: null,
  error: null,
};

export function getSessionPrefetchSnapshot(): SessionPrefetchState {
  return {
    ...sessionPrefetchStateCache,
  };
}

export function resetSessionPrefetchCache() {
  sessionPrefetchGeneration += 1;
  sessionPrefetchPromise = null;
  sessionPrefetchStateCache = {
    status: 'idle',
    payload: null,
    fetchedAt: null,
    error: null,
  };
}

export function beginSessionPrefetch(): Promise<SessionPayload> {
  if (sessionPrefetchStateCache.status === 'ready' && sessionPrefetchStateCache.payload) {
    return Promise.resolve(sessionPrefetchStateCache.payload);
  }

  if (sessionPrefetchStateCache.status === 'pending' && sessionPrefetchPromise) {
    return sessionPrefetchPromise;
  }

  sessionPrefetchStateCache = {
    status: 'pending',
    payload: null,
    fetchedAt: null,
    error: null,
  };

  const generation = sessionPrefetchGeneration;
  sessionPrefetchPromise = fetchSessionPayload()
    .then((payload) => {
      if (generation !== sessionPrefetchGeneration) return payload;
      sessionPrefetchStateCache = {
        status: 'ready',
        payload,
        fetchedAt: new Date().toISOString(),
        error: null,
      };
      sessionPrefetchPromise = null;
      return payload;
    })
    .catch((error) => {
      if (generation !== sessionPrefetchGeneration) throw error;
      sessionPrefetchStateCache = {
        status: 'error',
        payload: null,
        fetchedAt: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      sessionPrefetchPromise = null;
      throw error;
    });

  return sessionPrefetchPromise;
}

export async function ensureSessionPrefetch(onStateChange: () => void): Promise<SessionPayload> {
  onStateChange();

  try {
    const payload = await beginSessionPrefetch();
    onStateChange();
    return payload;
  } catch (error) {
    onStateChange();
    throw error;
  }
}

export function formatSessionPrefetchStatus(sessionPrefetch: SessionPrefetchState) {
  switch (sessionPrefetch.status) {
    case 'idle':
      return 'idle';
    case 'pending':
      return 'prefetching session data';
    case 'ready':
      return `ready (${getSessionPayloadItemCount(sessionPrefetch.payload) ?? 0} items)`;
    case 'error':
      return sessionPrefetch.error ? `error: ${sessionPrefetch.error}` : 'error';
    default:
      return 'unknown';
  }
}

export function getSessionPayloadItemCount(payload: SessionPayload | null): number | null {
  if (!payload) {
    return null;
  }

  return (
    payload.buckets.review.length +
    payload.buckets.learning.length +
    payload.buckets.unstudied.length
  );
}
