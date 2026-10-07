import { WHATS_NEW_BADGE_WINDOW_MS, type WhatsNewAttention } from '../../domain/whats-new-attention';

export function activeWhatsNewPostIds(attention: WhatsNewAttention, now: number): string[] {
  return attention.unseenPostIds.filter(id => {
    const item = attention.items.find(item => item.postId === id);
    if (!item) throw new Error('Blog attention is missing a post state.');
    return item.readAt === null && (item.firstBadgeSeenAt === null
      || now < Date.parse(item.firstBadgeSeenAt) + WHATS_NEW_BADGE_WINDOW_MS);
  });
}
