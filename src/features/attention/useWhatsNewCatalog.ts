import { useCallback, useEffect, useState } from 'react';
import type { WhatsNewPost } from '../../domain/whats-new';
import { fetchWhatsNew } from '../../services/api';

export function useWhatsNewCatalog() {
  const [posts, setPosts] = useState<WhatsNewPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let active = true;
    let generation = 0;
    async function load() {
      const request = ++generation;
      try {
        const feed = await fetchWhatsNew();
        if (active && request === generation) { setPosts(feed.posts); setError(null); }
      } catch (err) {
        if (active && request === generation) setError(err instanceof Error ? err.message : 'Could not load updates.');
      }
    }
    void load();
    const onFocus = () => { void load(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [attempt]);
  return { posts, error, retry };
}
