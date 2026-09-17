import { useCallback, useEffect, useState } from 'react';
import type { MarkReflectionInboxSeenRequest } from '../../domain/reflection';
import {
  fetchAttentionBadges,
  markFailedReflectionRunsSeen,
  markReflectionInboxSeen,
  markWhatsNewSeen,
} from '../../services/api';
import { countUnseenWhatsNew, latestWhatsNewDate } from '../../pages/AboutPage';

export function useAttentionBadges() {
  const [reflectionUnseenCount, setReflectionUnseenCount] = useState(0);
  const [failedReflectionRunIds, setFailedReflectionRunIds] = useState<string[]>([]);
  const [whatsNewUnseenCount, setWhatsNewUnseenCount] = useState(0);

  const refresh = useCallback(async () => {
    const attention = await fetchAttentionBadges();
    let seenThrough = attention.whatsNewSeenThroughDate;
    if (seenThrough === null) {
      const ensured = await markWhatsNewSeen({
        throughDate: latestWhatsNewDate(),
        mode: 'ensure',
      });
      seenThrough = ensured.whatsNewSeenThroughDate;
    }
    setReflectionUnseenCount(attention.reflectionUnseenCount);
    if (!Array.isArray(attention.failedReflectionRunIds)) {
      throw new Error('Attention badges response is missing failedReflectionRunIds.');
    }
    setFailedReflectionRunIds(attention.failedReflectionRunIds);
    setWhatsNewUnseenCount(countUnseenWhatsNew(seenThrough));
  }, []);

  const markHelpCardSeen = useCallback(async (request: MarkReflectionInboxSeenRequest) => {
    const result = await markReflectionInboxSeen(request);
    setReflectionUnseenCount(result.reflectionUnseenCount);
  }, []);

  const acknowledgeFailedReflectionRuns = useCallback(async () => {
    const result = await markFailedReflectionRunsSeen();
    setFailedReflectionRunIds(result.failedReflectionRunIds);
  }, []);

  const acknowledgeWhatsNew = useCallback(async () => {
    const result = await markWhatsNewSeen({
      throughDate: latestWhatsNewDate(),
      mode: 'seen',
    });
    setWhatsNewUnseenCount(countUnseenWhatsNew(result.whatsNewSeenThroughDate));
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void refresh().catch(() => undefined);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
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
