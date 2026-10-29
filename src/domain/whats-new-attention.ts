export type WhatsNewAttention = {
  items: Array<{ postId: string; firstBadgeSeenAt: string | null; readAt: string | null }>;
  unseenPostIds: string[];
  nextExpiryAt: string | null;
  serverNow: string;
};

export const WHATS_NEW_BADGE_WINDOW_MS = 12 * 60 * 60 * 1000;
