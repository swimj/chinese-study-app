import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarkReflectionInboxSeenRequest } from '../../domain/reflection';
import {
  fetchAttentionBadges,
  markFailedReflectionRunsSeen,
  markReflectionInboxSeen,
} from '../../services/api';
import { useWhatsNewAttention } from './useWhatsNewAttention';

export function useAttentionBadges() {
  const [reflectionUnseenCount, setReflectionUnseenCount] = useState(0);
  const [failedReflectionRunIds, setFailedReflectionRunIds] = useState<string[]>([]);
  const updates = useWhatsNewAttention();
  const refreshUpdates = updates.refresh;

  const refreshGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const attention = await fetchAttentionBadges();
    if (generation !== refreshGeneration.current) return;
    setReflectionUnseenCount(attention.reflectionUnseenCount);
    if (!Array.isArray(attention.failedReflectionRunIds)) {
      throw new Error('Attention badges response is missing failedReflectionRunIds.');
    }
    setFailedReflectionRunIds(attention.failedReflectionRunIds);
  }, []);
  const refreshAll = useCallback(async () => {
    // Either attention source can still refresh if the other one is unavailable.
    const results = await Promise.allSettled([refresh(), refreshUpdates()]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }, [refresh, refreshUpdates]);

  const markHelpCardSeen = useCallback(async (request: MarkReflectionInboxSeenRequest) => {
    const result = await markReflectionInboxSeen(request);
    setReflectionUnseenCount(result.reflectionUnseenCount);
  }, []);

  const acknowledgeFailedReflectionRuns = useCallback(async () => {
    const result = await markFailedReflectionRunsSeen();
    setFailedReflectionRunIds(result.failedReflectionRunIds);
  }, []);

  useEffect(() => {
    void refreshAll().catch(() => undefined);
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void refreshAll().catch(() => undefined);
      }
    }
    function onFocus() { void refreshAll().catch(() => undefined); }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshAll]);

  return {
    reflectionUnseenCount,
    hasUnseenReflectionFailure: failedReflectionRunIds.length > 0,
    whatsNewUnseenCount: updates.count,
    refresh: refreshAll,
    markHelpCardSeen,
    acknowledgeFailedReflectionRuns,
    acknowledgeWhatsNew: updates.read,
    acknowledgeWhatsNewBadge: updates.exposeBadge,
  };
}
