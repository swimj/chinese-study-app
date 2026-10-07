import { useCallback, useEffect, useRef, useState } from 'react';
import type { WhatsNewAttention } from '../../domain/whats-new-attention';
import { WHATS_NEW_BADGE_WINDOW_MS } from '../../domain/whats-new-attention';
import { fetchWhatsNewAttention, updateWhatsNewAttention } from '../../services/api';
import { activeWhatsNewPostIds } from './whats-new-attention';

export function useWhatsNewAttention() {
  const [snapshot, setSnapshot] = useState<{ attention: WhatsNewAttention; receivedAt: number } | null>(null);
  const [clock, setClock] = useState(Date.now);
  // Serialize reads and writes so an older response cannot restore cleared badges.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const run = useCallback((request: () => Promise<WhatsNewAttention>): Promise<void> => {
    const result = queue.current.catch(() => undefined).then(async () => {
      if (!active.current) return;
      const attention = await request();
      if (active.current) {
        const receivedAt = Date.now();
        setClock(receivedAt);
        setSnapshot({ attention, receivedAt });
      }
    });
    queue.current = result;
    return result;
  }, []);
  const refresh = useCallback(() => run(fetchWhatsNewAttention), [run]);
  const read = useCallback((postIds: string[]) => run(() => updateWhatsNewAttention({ postIds, kind: 'read' })), [run]);
  const serverNow = snapshot ? Date.parse(snapshot.attention.serverNow) + Math.max(0, clock - snapshot.receivedAt) : 0;
  const unseenIds = snapshot ? activeWhatsNewPostIds(snapshot.attention, serverNow) : [];
  const exposureKey = JSON.stringify(unseenIds.filter(id =>
    snapshot?.attention.items.find(item => item.postId === id)?.firstBadgeSeenAt === null));
  const exposeBadge = useCallback(async () => {
    const postIds = JSON.parse(exposureKey) as string[];
    if (postIds.length) await run(() => updateWhatsNewAttention({ postIds, kind: 'badge-seen' }));
  }, [exposureKey, run]);

  useEffect(() => {
    if (!snapshot) return;
    const now = Date.parse(snapshot.attention.serverNow) + Math.max(0, Date.now() - snapshot.receivedAt);
    const expiries = snapshot.attention.items.filter(item => snapshot.attention.unseenPostIds.includes(item.postId)
      && item.firstBadgeSeenAt !== null && item.readAt === null)
      .map(item => Date.parse(item.firstBadgeSeenAt!) + WHATS_NEW_BADGE_WINDOW_MS)
      .filter(expiry => expiry > serverNow);
    if (!expiries.length) return;
    // Expire locally even if the network drops; focus refresh reconciles other tabs.
    const timer = window.setTimeout(() => setClock(Date.now()), Math.max(1, Math.min(...expiries) - now));
    return () => window.clearTimeout(timer);
  }, [snapshot, serverNow]);

  return { count: unseenIds.length, refresh, read, exposeBadge };
}
