import { useEffect, useRef, useState } from 'react';
import {
  ALL_MY_WORDS_STATUSES,
  type MyWord,
  type MyWordsResponse,
  type MyWordsStatus,
  type MyWordsView,
} from '../../domain/my-words';
import { fetchMyWords } from '../../services/api';
import type { WordBrowserEntry } from '../../domain/my-words';

export type WordsLoader<Stage extends string, Entry extends WordBrowserEntry<Stage>> = (view: MyWordsView, query: string, offset: number, signal: AbortSignal, statuses: readonly Stage[], recentLapses: boolean) => Promise<{words: Entry[]; currentDeck: MyWordsResponse['currentDeck']; hasMore: boolean; total: number}>;

export function useWordBrowserController<Stage extends string, Entry extends WordBrowserEntry<Stage>>(active: boolean, fetchWords: WordsLoader<Stage, Entry>, allStages: readonly Stage[]) {
  const [view, setView] = useState<MyWordsView>('recent');
  const [query, setQuery] = useState('');
  // Empty = all stages (no chips pressed).
  const [statuses, setStatuses] = useState<Stage[]>([]);
  const [recentLapses, setRecentLapses] = useState(false);
  const [words, setWords] = useState<Entry[]>([]);
  const [currentDeck, setCurrentDeck] = useState<MyWordsResponse['currentDeck']>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const scrollTop = useRef(0);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const fetchingMore = useRef(false);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    fetchingMore.current = false;
    const timer = window.setTimeout(() => {
      void fetchWords(view, query, 0, controller.signal, statuses, recentLapses).then((result) => {
        if (generation.current !== current || controller.signal.aborted) return;
        setCurrentDeck(result.currentDeck);
        setWords(result.words);
        setHasMore(result.hasMore);
        setTotal(result.total);
        setSelectedId((id) => result.words.some((entry) => entry.word.id === id) ? id : null);
        scrollTop.current = 0;
      }).catch((err: unknown) => {
        if (!controller.signal.aborted && generation.current === current) {
          setError(err instanceof Error ? err.message : 'Could not load your words.');
        }
      }).finally(() => {
        if (!controller.signal.aborted && generation.current === current) setLoading(false);
      });
    }, query ? 200 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      request.current?.abort();
      generation.current += 1;
    };
  }, [active, view, query, statuses, recentLapses, revision, fetchWords]);

  function resetList() {
    request.current?.abort();
    generation.current += 1;
    setWords([]);
    setSelectedId(null);
    setHasMore(false);
    setTotal(null);
    setLoading(true);
    setError(null);
    scrollTop.current = 0;
  }

  async function loadMore() {
    if (loading || fetchingMore.current || !hasMore) return;
    fetchingMore.current = true;
    const controller = new AbortController();
    request.current = controller;
    const current = generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWords(view, query, words.length, controller.signal, statuses, recentLapses);
      if (generation.current !== current || controller.signal.aborted) return;
      setCurrentDeck(result.currentDeck);
      setWords((existing) => {
        const ids = new Set(existing.map((entry) => entry.word.id));
        return [...existing, ...result.words.filter((entry) => !ids.has(entry.word.id))];
      });
      setHasMore(result.hasMore);
      setTotal(result.total);
    } catch (err) {
      if (generation.current === current && !controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Could not load more words.');
      }
    } finally {
      if (generation.current === current && !controller.signal.aborted) {
        setLoading(false);
        fetchingMore.current = false;
      }
    }
  }

  return {
    view, query, statuses, recentLapses, words, currentDeck, selectedId, hasMore, total, loading, error,
    scrollTop: scrollTop.current,
    onViewChange: (next: MyWordsView) => { resetList(); setView(next); },
    onQueryChange: (next: string) => { resetList(); setQuery(next); },
    onToggleStatus: (status: Stage) => {
      resetList();
      setStatuses((current) => current.length === 0 || current.length === allStages.length ? [status] : allStages.filter((stage) => stage === status ? !current.includes(stage) : current.includes(stage)));
    },
    onToggleRecentLapses: () => {
      resetList();
      setRecentLapses((current) => !current);
    },
    onSelect: setSelectedId,
    onLoadMore: () => void loadMore(),
    reload: () => setRevision((value) => value + 1),
    onRetry: () => { resetList(); setRevision((value) => value + 1); },
    onScroll: (top: number) => { scrollTop.current = top; },
  };
}

export function useMyWordsController(active: boolean) {
  return useWordBrowserController<MyWordsStatus, MyWord>(active, fetchMyWords, ALL_MY_WORDS_STATUSES);
}
