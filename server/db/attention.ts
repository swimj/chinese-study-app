import { getDb } from './connection.ts';
import { getLearnerParam, upsertLearnerParam } from './identity.ts';

const WHATS_NEW_SEEN_THROUGH_KEY = 'whats_new_seen_through_date';
const UTC_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ReflectionInboxSeenTarget =
  | { kind: 'proposal'; proposalId: string }
  | { kind: 'explanation'; artifactId: string; itemId: string };

export type AttentionBadges = {
  reflectionUnseenCount: number;
  whatsNewSeenThroughDate: string | null;
};

export function getAttentionBadges(): AttentionBadges {
  return {
    reflectionUnseenCount: countUnseenReflectionHelpItems(),
    whatsNewSeenThroughDate: getWhatsNewSeenThroughDate(),
  };
}

export function countUnseenReflectionHelpItems(): number {
  const row = getDb().prepare(`
    SELECT
      (
        SELECT COUNT(*)
        FROM reflection_proposal_reviews
        WHERE disposition = 'pending' AND inbox_seen_at IS NULL
      ) + (
        SELECT COUNT(*)
        FROM reflection_help_inbox AS inbox
        WHERE inbox.inbox_seen_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM reflection_proposal_reviews AS review
            WHERE review.artifact_id = inbox.artifact_id
              AND review.item_id = inbox.item_id
              AND review.disposition = 'pending'
          )
      ) AS count
  `).get() as { count: number };
  return row.count;
}

export function markReflectionInboxSeen(
  target: ReflectionInboxSeenTarget,
  seenAt = new Date().toISOString(),
): { marked: boolean; reflectionUnseenCount: number } {
  assertIsoTimestamp(seenAt, 'inbox seen timestamp');
  if (target.kind === 'proposal') {
    return markProposalInboxSeen(target.proposalId, seenAt);
  }
  return markExplanationInboxSeen(target.artifactId, target.itemId, seenAt);
}

export function stampProposalInboxSeenIfLeavingPending(
  proposalId: string,
  seenAt: string,
): void {
  assertNonEmpty(proposalId, 'proposal id');
  assertIsoTimestamp(seenAt, 'inbox seen timestamp');
  getDb().prepare(`
    UPDATE reflection_proposal_reviews
    SET inbox_seen_at = COALESCE(inbox_seen_at, ?)
    WHERE proposal_id = ?
  `).run(seenAt, proposalId);
}

export function getWhatsNewSeenThroughDate(): string | null {
  const parsed = getLearnerParam(WHATS_NEW_SEEN_THROUGH_KEY);
  if (parsed === null) return null;
  if (typeof parsed !== 'string' || !isUtcDateKey(parsed)) {
    throw new Error('Stored whats-new seen-through date is invalid.');
  }
  return parsed;
}

export function ensureWhatsNewSeenThroughDate(throughDate: string): string {
  const normalized = requireUtcDateKey(throughDate);
  const current = getWhatsNewSeenThroughDate();
  if (current !== null) return current;
  upsertWhatsNewSeenThroughDate(normalized);
  return normalized;
}

export function markWhatsNewSeenThroughDate(throughDate: string): string {
  const normalized = requireUtcDateKey(throughDate);
  const current = getWhatsNewSeenThroughDate();
  const next = current === null || normalized > current ? normalized : current;
  if (next !== current) upsertWhatsNewSeenThroughDate(next);
  return next;
}

function markProposalInboxSeen(
  proposalId: string,
  seenAt: string,
): { marked: boolean; reflectionUnseenCount: number } {
  assertNonEmpty(proposalId, 'proposal id');
  const existing = getDb().prepare(`
    SELECT proposal_id, inbox_seen_at
    FROM reflection_proposal_reviews
    WHERE proposal_id = ?
  `).get(proposalId) as { proposal_id: string; inbox_seen_at: string | null } | undefined;
  if (!existing) {
    throw new Error('Reflection proposal not found.');
  }
  if (existing.inbox_seen_at === null) {
    getDb().prepare(`
      UPDATE reflection_proposal_reviews
      SET inbox_seen_at = ?
      WHERE proposal_id = ? AND inbox_seen_at IS NULL
    `).run(seenAt, proposalId);
  }
  return {
    marked: existing.inbox_seen_at === null,
    reflectionUnseenCount: countUnseenReflectionHelpItems(),
  };
}

function markExplanationInboxSeen(
  artifactId: string,
  itemId: string,
  seenAt: string,
): { marked: boolean; reflectionUnseenCount: number } {
  assertNonEmpty(artifactId, 'artifact id');
  assertNonEmpty(itemId, 'item id');
  const existing = getDb().prepare(`
    SELECT inbox_id, inbox_seen_at
    FROM reflection_help_inbox
    WHERE artifact_id = ? AND item_id = ?
  `).get(artifactId, itemId) as { inbox_id: string; inbox_seen_at: string | null } | undefined;
  if (!existing) {
    return {
      marked: false,
      reflectionUnseenCount: countUnseenReflectionHelpItems(),
    };
  }
  if (existing.inbox_seen_at === null) {
    getDb().prepare(`
      UPDATE reflection_help_inbox
      SET inbox_seen_at = ?
      WHERE inbox_id = ? AND inbox_seen_at IS NULL
    `).run(seenAt, existing.inbox_id);
  }
  return {
    marked: existing.inbox_seen_at === null,
    reflectionUnseenCount: countUnseenReflectionHelpItems(),
  };
}

function upsertWhatsNewSeenThroughDate(throughDate: string): void {
  upsertLearnerParam(WHATS_NEW_SEEN_THROUGH_KEY, throughDate);
}

function requireUtcDateKey(value: string): string {
  if (!isUtcDateKey(value)) {
    throw new Error('Expected a YYYY-MM-DD whats-new date.');
  }
  return value;
}

function isUtcDateKey(value: string): boolean {
  if (!UTC_DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty ${label}.`);
  }
}

function assertIsoTimestamp(value: string, label: string): void {
  assertNonEmpty(value, label);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`Expected ${label} to be an ISO-8601 UTC timestamp.`);
  }
}
