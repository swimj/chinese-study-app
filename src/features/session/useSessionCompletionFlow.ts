import { completionDeadline } from './completion-deadline';
export { completionDeadline } from './completion-deadline';
import { useEffect, useRef, useState } from 'react';
import type { SessionCompletion, StageSessionCompletionRequest } from '../../domain/session-completion';
import { closeSessionCompletion, fetchSessionCompletion,
  stageSessionCompletion, undoSessionCompletion } from '../../services/api';



/** The browser displays the deadline; only the server can cancel or close it. */
export function useSessionCompletionFlow(options: {
  sessionId: string | null;
  surfaceVisible: boolean;
  buildRequest: (revisionId: string) => StageSessionCompletionRequest;
  onCancelled: () => void;
  onReturnHome: () => Promise<void>;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [completion, setCompletion] = useState<SessionCompletion | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keepOpen, setKeepOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const state = useRef<SessionCompletion | null>(null);
  const revision = useRef<string | null>(null);
  const deadline = useRef<number | null>(null);
  const stageRun = useRef<Promise<SessionCompletion | null> | null>(null);
  const mutation = useRef(false);
  const attemptedSession = useRef<string | null>(null);
  const mounted = useRef(true);

  function receive(result: SessionCompletion) {
    const newlyCancelled = result.status === 'cancelled' && state.current?.status !== 'cancelled';
    state.current = result;
    deadline.current = completionDeadline(result);
    if (mounted.current) {
      setCompletion(result);
      setRemainingSeconds(result.status === 'pending' ? Math.ceil(Math.max(0, deadline.current - Date.now()) / 1000) : 0);
      if (newlyCancelled) latest.current.onCancelled();
    }
  }

  async function stage(): Promise<SessionCompletion | null> {
    if (stageRun.current) return stageRun.current;
    const sessionId = latest.current.sessionId;
    if (!sessionId) return null;
    if (state.current?.sessionId === sessionId && state.current.status !== 'cancelled') return state.current;
    revision.current ??= crypto.randomUUID();
    const revisionId = revision.current;
    attemptedSession.current = sessionId;
    setSaving(true);
    setError(null);
    const run = (async () => {
      try {
        const result = await stageSessionCompletion(sessionId, latest.current.buildRequest(revisionId));
        if (latest.current.sessionId !== sessionId || !mounted.current) return null;
        receive(result);
        return result;
      } catch (reason) {
        if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save session completion');
        return null;
      } finally {
        if (mounted.current) setSaving(false);
        stageRun.current = null;
      }
    })();
    stageRun.current = run;
    return run;
  }

  async function close(returnHome: boolean): Promise<boolean> {
    if (mutation.current) return false;
    mutation.current = true;
    setBusy(true);
    setError(null);
    try {
      const current = state.current ?? await stage();
      if (!current) return false;
      const result = current.status === 'closed' ? current
        : await closeSessionCompletion(current.sessionId, current.revisionId);
      if (!mounted.current || latest.current.sessionId !== result.sessionId) return false;
      receive(result);
      if (result.status !== 'closed') {
        setError(result.error ?? 'Could not close session. Please try again.');
        return false;
      }
      if (returnHome) await latest.current.onReturnHome();
      return true;
    } catch (reason) {
      // A lost close response or another tab's Undo needs an authoritative read.
      const current = state.current;
      if (current) {
        try {
          const result = await fetchSessionCompletion(current.sessionId);
          if (mounted.current && latest.current.sessionId === current.sessionId
            && state.current?.revisionId === current.revisionId && result.revisionId === current.revisionId) {
            receive(result);
            if (result.status === 'closed') {
              if (returnHome) await latest.current.onReturnHome();
              return true;
            }
            if (result.status === 'cancelled') return false;
          }
        } catch { /* Retain the original failure if reconciliation is unavailable. */ }
      }
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not close session');
      return false;
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function undo() {
    const current = state.current;
    if (mutation.current || !current || current.status !== 'pending' || !current.canUndo
      || deadline.current === null || Date.now() >= deadline.current) return;
    mutation.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await undoSessionCompletion(current.sessionId, current.revisionId);
      if (!mounted.current || latest.current.sessionId !== result.sessionId) return;
      receive(result);
      if (result.status !== 'cancelled') setError('The Undo window has closed. Your session is saved.');
    } catch (reason) {
      // Undo may have succeeded despite a lost response, or closure may have won.
      try {
        const result = await fetchSessionCompletion(current.sessionId);
        if (mounted.current && latest.current.sessionId === current.sessionId
          && result.revisionId === current.revisionId) {
          receive(result);
          if (result.status === 'cancelled') return;
        }
      } catch { /* Keep the original failure actionable when the read also fails. */ }
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not undo the last answer');
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!options.sessionId) {
      if (state.current !== null || attemptedSession.current !== null) {
        state.current = null;
        revision.current = null;
        deadline.current = null;
        attemptedSession.current = null;
        setCompletion(null);
        setError(null);
        setKeepOpen(false);
        setRemainingSeconds(null);
      }
      return;
    }
    if (attemptedSession.current !== options.sessionId) void stage();
  }, [options.sessionId]);

  useEffect(() => {
    if (!options.sessionId) return;
    let nextReadAt = 0;
    const tick = () => {
      const current = state.current;
      if (!current || current.sessionId !== latest.current.sessionId || mutation.current) return;
      if (current.status === 'closed') {
        if (!keepOpen && latest.current.surfaceVisible) void close(true);
        return;
      }
      if (current.status !== 'pending' || deadline.current === null) return;
      const left = Math.max(0, deadline.current - Date.now());
      setRemainingSeconds(Math.ceil(left / 1000));
      if (left === 0 && Date.now() >= nextReadAt) {
        nextReadAt = Date.now() + 2000;
        void close(!keepOpen && latest.current.surfaceVisible);
      }
    };
    const reconcile = () => {
      if (document.visibilityState !== 'visible') return;
      const current = state.current;
      if (!current || mutation.current) return;
      void fetchSessionCompletion(current.sessionId).then((result) => {
        if (mounted.current && latest.current.sessionId === result.sessionId && !mutation.current
          && state.current?.revisionId === current.revisionId && result.revisionId === current.revisionId) receive(result);
      }).catch(() => undefined);
    };
    const timer = window.setInterval(tick, 200);
    document.addEventListener('visibilitychange', reconcile);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', reconcile); };
  }, [options.sessionId, keepOpen]);

  return { completion, saving, busy, error, keepOpen, remainingSeconds,
    undo, finish: () => close(true), keepSummaryOpen: () => setKeepOpen(true),
    retry: async () => { if (!state.current) await stage(); else await close(false); } };
}
