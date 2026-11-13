import { useCallback, useEffect, useRef, useState } from 'react';
import { reactionSubjectKey, type ContentReactionState, type ReactionSubject, type ReactionSurface } from '../../domain/content-reactions';
import { fetchContentReactions, saveContentReaction } from '../../services/api';
import type { ReactionChoice } from './reaction-state';

export type ContentReactionsApi = { fetch: typeof fetchContentReactions; save: typeof saveContentReaction };
const defaultApi: ContentReactionsApi = { fetch: fetchContentReactions, save: saveContentReaction };

/**
 * The learner's reactions with optimistic updates. Writes for one subject run in
 * order, so the last choice wins; a failed write restores the server's state.
 */
export function useContentReactions(surface: ReactionSurface, api: ContentReactionsApi = defaultApi) {
  const [states, setStates] = useState<ReadonlyMap<string, ContentReactionState>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef(new Map<string, ContentReactionState | null>());
  const chains = useRef(new Map<string, Promise<void>>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void api.fetch(controller.signal).then((list) => {
      if (!mounted.current) return;
      const map = new Map(list.map((state) => [reactionSubjectKey(state.subject), state]));
      for (const [key, state] of map) confirmed.current.set(key, state);
      // Keep any choice made while loading.
      setStates((current) => new Map([...map, ...current]));
      setLoaded(true);
    }).catch((cause: unknown) => {
      if (mounted.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load saved items.');
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [api]);

  const change = useCallback((subject: ReactionSubject, choice: ReactionChoice) => {
    const key = reactionSubjectKey(subject);
    const optimistic: ContentReactionState | null = choice.reaction === null ? null
      : { subject, reaction: choice.reaction, reasons: choice.reasons, note: choice.note, updatedAt: new Date().toISOString() };
    const put = (value: ContentReactionState | null) => setStates((current) => {
      const next = new Map(current);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    });
    put(optimistic);
    setError(null);
    const previous = chains.current.get(key) ?? Promise.resolve();
    const run = previous.then(async () => {
      try {
        const saved = await api.save({ subject, surface, ...choice });
        confirmed.current.set(key, saved);
        if (mounted.current && chains.current.get(key) === run) put(saved);
      } catch (cause) {
        if (!mounted.current) return;
        setError(cause instanceof Error ? cause.message : 'Could not save.');
        if (chains.current.get(key) === run) put(confirmed.current.get(key) ?? null);
      }
    });
    chains.current.set(key, run);
  }, [api, surface]);

  const stateFor = useCallback((subject: ReactionSubject) => states.get(reactionSubjectKey(subject)) ?? null, [states]);
  return { states, stateFor, change, loaded, error };
}
