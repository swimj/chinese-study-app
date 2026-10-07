import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarkReflectionInboxSeenRequest } from '../../domain/reflection';
import {
  fetchAttentionBadges,
  markFailedReflectionRunsSeen,
  markReflectionInboxSeen,
  markWhatsNewSeenSequence,
  fetchWhatsNew,
} from '../../services/api';
import { countUnseenWhatsNew, latestWhatsNewSequence } from './whats-new-attention';

export function useAttentionBadges() {
  const [reflectionUnseenCount, setReflectionUnseenCount] = useState(0);
  const [failedReflectionRunIds, setFailedReflectionRunIds] = useState<string[]>([]);
  const [whatsNewUnseenCount, setWhatsNewUnseenCount] = useState(0);

  const refreshGeneration = useRef(0);
  const seenSequence = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const attention = await fetchAttentionBadges();
    if (generation !== refreshGeneration.current) return;
    setReflectionUnseenCount(attention.reflectionUnseenCount);
    if (!Array.isArray(attention.failedReflectionRunIds)) {
      throw new Error('Attention badges response is missing failedReflectionRunIds.');
    }
    setFailedReflectionRunIds(attention.failedReflectionRunIds);
    // Blog availability must not prevent reflection attention from updating.
    const feed = await fetchWhatsNew();
    let seenThrough = attention.whatsNewSeenThroughSequence;
    if (seenThrough === null) {
      const ensured = await markWhatsNewSeenSequence({
        throughSequence: latestWhatsNewSequence(feed.posts), mode: 'ensure',
      });
      seenThrough = ensured.whatsNewSeenThroughSequence;
    }
    if (generation !== refreshGeneration.current) return;
    seenSequence.current = Math.max(seenSequence.current ?? 0, seenThrough);
    setWhatsNewUnseenCount(countUnseenWhatsNew(feed.posts, seenSequence.current));
  }, []);

  const markHelpCardSeen = useCallback(async (request: MarkReflectionInboxSeenRequest) => {
    const result = await markReflectionInboxSeen(request);
    setReflectionUnseenCount(result.reflectionUnseenCount);
  }, []);

  const acknowledgeFailedReflectionRuns = useCallback(async () => {
    const result = await markFailedReflectionRunsSeen();
    setFailedReflectionRunIds(result.failedReflectionRunIds);
  }, []);

  const acknowledgeWhatsNew = useCallback(async (throughSequence: number) => {
    const result = await markWhatsNewSeenSequence({ throughSequence, mode: 'seen' });
    seenSequence.current = Math.max(seenSequence.current ?? 0, result.whatsNewSeenThroughSequence);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void refresh().catch(() => undefined);
      }
    }
    function onFocus() { void refresh().catch(() => undefined); }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return {
    reflectionUnseenCount,
    hasUnseenReflectionFailure: failedReflectionRunIds.length > 0,
    whatsNewUnseenCount,
    refresh,
    markHelpCardSeen,
    acknowledgeFailedReflectionRuns,
    acknowledgeWhatsNew,
  };
}
