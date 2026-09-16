import { useEffect, useRef, useState } from 'react';
import {
  ALL_MY_WORDS_STATUSES,
  toggleMyWordsStatus,
  type MyWord,
  type MyWordsResponse,
  type MyWordsStatus,
  type MyWordsView,
} from '../../domain/my-words';
import { fetchMyWords } from '../../services/api';

export function useMyWordsController(active: boolean) {
  const [view, setView] = useState<MyWordsView>('recent');
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<MyWordsStatus[]>([...ALL_MY_WORDS_STATUSES]);
  const [recentLapses, setRecentLapses] = useState(false);
  const [words, setWords] = useState<MyWord[]>([]);
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
      void fetchMyWords(view, query, 0, controller.signal, statuses, recentLapses).then((result) => {
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
  }, [active, view, query, statuses, recentLapses, revision]);

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
      const result = await fetchMyWords(view, query, words.length, controller.signal, statuses, recentLapses);
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
    onToggleStatus: (status: MyWordsStatus) => {
      resetList();
      setStatuses((current) => toggleMyWordsStatus(current, status));
    },
    onToggleRecentLapses: () => {
      resetList();
      setRecentLapses((current) => !current);
    },
    onSelect: setSelectedId,
    onLoadMore: () => void loadMore(),
    onRetry: () => { resetList(); setRevision((value) => value + 1); },
    onScroll: (top: number) => { scrollTop.current = top; },
  };
}
