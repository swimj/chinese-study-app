import { WHATS_NEW_BADGE_WINDOW_MS, type WhatsNewAttention } from '../../src/domain/whats-new-attention.ts';
import { WhatsNewInputError } from '../../src/domain/whats-new.ts';
import { getWhatsNewSeenThroughSequence } from './attention.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

type AttentionRequest = { postIds: string[]; kind: 'badge-seen' | 'read' };
type AttentionRow = WhatsNewAttention['items'][number] & { publicationSequence: number };

function assertTimestamp(now: string): void {
  const date = new Date(now);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== now) {
    throw new Error('Expected a canonical UTC blog attention timestamp.');
  }
}

function parseRequest(value: unknown): AttentionRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WhatsNewInputError('Expected a blog attention request.');
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some(key => key !== 'postIds' && key !== 'kind')
    || (request.kind !== 'badge-seen' && request.kind !== 'read')
    || !Array.isArray(request.postIds) || request.postIds.length < 1 || request.postIds.length > 1000
    || request.postIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(id))
    || new Set(request.postIds).size !== request.postIds.length) {
    throw new WhatsNewInputError('Expected badge-seen or read and 1–1000 distinct published post IDs.');
  }
  return { kind: request.kind, postIds: request.postIds as string[] };
}

/** A read never starts an exposure clock or initializes away historical posts. */
export function getWhatsNewAttention(now = new Date().toISOString()): WhatsNewAttention {
  assertTimestamp(now);
  const db = getDb();
  const learnerId = requireLearnerId();
  const legacySequence = getWhatsNewSeenThroughSequence();
  const legacy = legacySequence === null ? undefined : db.prepare(`
    SELECT updated_at AS updatedAt FROM learner_params
    WHERE learner_id = ? AND param_key IN ('whats_new_seen_through_sequence', 'whats_new_seen_through_date')
    ORDER BY CASE param_key WHEN 'whats_new_seen_through_sequence' THEN 0 ELSE 1 END LIMIT 1
  `).get(learnerId) as { updatedAt: string } | undefined;
  if (legacySequence !== null && !legacy) throw new Error('Missing legacy blog acknowledgement timestamp.');
  const rows = db.prepare(`
    SELECT posts.post_id AS postId, posts.publication_sequence AS publicationSequence,
      attention.first_badge_seen_at AS firstBadgeSeenAt, attention.read_at AS readAt
    FROM whats_new_posts AS posts LEFT JOIN learner_whats_new_attention AS attention
      ON attention.post_id = posts.post_id AND attention.learner_id = ?
    WHERE posts.status = 'published' ORDER BY posts.publication_sequence DESC
  `).all(learnerId) as AttentionRow[];
  const items = rows.map(({ publicationSequence, ...item }) => ({
    ...item,
    readAt: item.readAt ?? (legacySequence !== null && publicationSequence <= legacySequence ? legacy!.updatedAt : null),
  }));
  const unseenPostIds: string[] = [];
  let nextExpiryAt: string | null = null;
  for (const item of items) {
    if (item.readAt !== null) continue;
    if (item.firstBadgeSeenAt === null) {
      unseenPostIds.push(item.postId);
      continue;
    }
    assertTimestamp(item.firstBadgeSeenAt);
    const expiresAt = new Date(Date.parse(item.firstBadgeSeenAt) + WHATS_NEW_BADGE_WINDOW_MS).toISOString();
    if (expiresAt <= now) continue;
    unseenPostIds.push(item.postId);
    if (nextExpiryAt === null || expiresAt < nextExpiryAt) nextExpiryAt = expiresAt;
  }
  return { items, unseenPostIds, nextExpiryAt, serverNow: now };
}

export function updateWhatsNewAttention(value: unknown, now = new Date().toISOString()): WhatsNewAttention {
  const request = parseRequest(value);
  assertTimestamp(now);
  const db = getDb();
  const learnerId = requireLearnerId();
  db.exec('BEGIN IMMEDIATE');
  try {
    const published = db.prepare("SELECT 1 FROM whats_new_posts WHERE post_id = ? AND status = 'published'");
    for (const id of request.postIds) {
      if (!published.get(id)) throw new WhatsNewInputError('Every attention post ID must identify a published post.');
    }
    // Separate COALESCE columns preserve the first successful write across tabs,
    // retries, and restarts; a later post never renews another post's clock.
    const write = db.prepare(`
      INSERT INTO learner_whats_new_attention (learner_id, post_id, first_badge_seen_at, read_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(learner_id, post_id) DO UPDATE SET
        first_badge_seen_at = COALESCE(learner_whats_new_attention.first_badge_seen_at, excluded.first_badge_seen_at),
        read_at = COALESCE(learner_whats_new_attention.read_at, excluded.read_at)
    `);
    for (const id of request.postIds) {
      write.run(learnerId, id, request.kind === 'badge-seen' ? now : null, request.kind === 'read' ? now : null);
    }
    const result = getWhatsNewAttention(now);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
