import { useEffect, useRef, useState } from 'react';
import { fetchLatestSessionDebrief, fetchSessionDebrief, retrySessionDebrief } from '../../services/api';
import { createSessionDebriefLoader, INITIAL_DEBRIEF_LOAD_STATE } from './session-debrief-loader';

export function useSessionDebrief(sessionId?: string, enabled = true) {
  const [state, setState] = useState(INITIAL_DEBRIEF_LOAD_STATE);
  const loader = useRef<ReturnType<typeof createSessionDebriefLoader> | null>(null);
  useEffect(() => {
    setState(INITIAL_DEBRIEF_LOAD_STATE);
    if (!enabled) return;
    const current = createSessionDebriefLoader({ sessionId, onChange: setState,
      api: { latest: fetchLatestSessionDebrief, get: fetchSessionDebrief, retry: retrySessionDebrief } });
    loader.current = current;
    void current.reload();
    return () => { current.dispose(); if (loader.current === current) loader.current = null; };
  }, [sessionId, enabled]);
  return { ...state, reload: () => void loader.current?.reload(), retry: () => void loader.current?.retry() };
}
