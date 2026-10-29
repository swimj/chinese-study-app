import type { ContentSharingDigest, ContentSharingExample, ContentSharingKind } from '../../src/domain/content-sharing.ts';
import { getDb } from './connection.ts';

export class ContentSharingInputError extends Error {}

export function currentSharingWeek(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function parseSharingWeek(value: unknown, now = new Date()): string {
  if (value === undefined) return currentSharingWeek(now);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ContentSharingInputError('weekStart must be a UTC Monday in YYYY-MM-DD format');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1 || value > currentSharingWeek(now)) {
    throw new ContentSharingInputError('weekStart must be a valid UTC Monday no later than the current week');
  }
  return value;
}

// Windows rank each learner's first use, so retries, repeated encounters and a
// third learner cannot create another "first second learner" milestone.
const milestones = `WITH uses AS (
  SELECT 'introduction' AS kind, e.package_id AS content_key, e.word_id, e.learner_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', MIN(julianday(e.occurred_at))) AS first_use
  FROM learner_word_introduction_events e WHERE e.event_kind = 'opened' AND julianday(e.occurred_at) <= julianday(?)
  GROUP BY e.package_id, e.word_id, e.learner_id
  UNION ALL
  SELECT q.kind, q.content_key, q.word_id, e.learner_id, strftime('%Y-%m-%dT%H:%M:%fZ', MIN(julianday(e.seen_at)))
  FROM learner_content_quality_encounters e JOIN content_quality_items q USING(content_key)
  WHERE julianday(e.seen_at) <= julianday(?) AND (q.kind = 'rehearsal' OR (q.kind IN ('production_cue','pure_cue') AND EXISTS (
    SELECT 1 FROM shared_content_publications p
    WHERE p.content_kind = q.kind AND p.content_id = q.source_id
  )))
  GROUP BY q.kind, q.content_key, q.word_id, e.learner_id
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY kind, content_key ORDER BY julianday(first_use), learner_id) AS position
  FROM uses
), milestones AS (
  SELECT kind, content_key, word_id, strftime('%Y-%m-%dT%H:%M:%fZ', MIN(julianday(first_use))) AS first_used_at,
    MAX(CASE WHEN position = 2 THEN first_use END) AS second_used_at, COUNT(*) AS learner_count
  FROM ranked GROUP BY kind, content_key, word_id
) `;

type MilestoneRow = { kind: ContentSharingKind; content_key: string; word_id: string | null; first_used_at: string; second_used_at: string; learner_count: number; hanzi: string | null; pinyin: string | null; title: string | null };

export function getContentSharingDigest(weekInput?: unknown, now = new Date()): ContentSharingDigest {
  const db = getDb();
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec('BEGIN');
  try {
    const digest = readContentSharingDigest(weekInput, now);
    if (ownTransaction) db.exec('COMMIT');
    return digest;
  } catch (error) {
    if (ownTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function readContentSharingDigest(weekInput: unknown, now: Date): ContentSharingDigest {
  const weekStart = parseSharingWeek(weekInput, now);
  const end = new Date(`${weekStart}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const weekEnd = end.toISOString().slice(0, 10);
  const db = getDb();
  const bounds = [`${weekStart}T00:00:00.000Z`, `${weekEnd}T00:00:00.000Z`];
  const counts = db.prepare(`${milestones} SELECT kind, COUNT(*) AS count FROM milestones
    WHERE julianday(second_used_at) >= julianday(?) AND julianday(second_used_at) < julianday(?) GROUP BY kind`).all(now.toISOString(), now.toISOString(), ...bounds) as { kind: ContentSharingKind; count: number }[];
  const count = (kind: ContentSharingKind) => counts.find(row => row.kind === kind)?.count ?? 0;
  const rows = db.prepare(`${milestones} SELECT m.*, w.hanzi, w.pinyin, q.title FROM milestones m LEFT JOIN content_quality_items q ON q.content_key = m.content_key AND q.kind = m.kind
    LEFT JOIN lexical_words w ON w.id = m.word_id
    WHERE julianday(second_used_at) >= julianday(?) AND julianday(second_used_at) < julianday(?)
    ORDER BY julianday(second_used_at) DESC, kind, content_key LIMIT 5`).all(now.toISOString(), now.toISOString(), ...bounds) as MilestoneRow[];
  const examples: ContentSharingExample[] = rows.map(row => {
    const completed = row.kind === 'introduction' ? db.prepare(`SELECT COUNT(DISTINCT learner_id) AS count
      FROM learner_word_introduction_events WHERE package_id = ? AND event_kind = 'completed' AND julianday(occurred_at) <= julianday(?)`).get(row.content_key, now.toISOString()) as { count: number } : null;
    const generation = row.kind === 'introduction' ? db.prepare(`SELECT w.stage, COUNT(*) AS attempts, COALESCE(SUM(a.outcome = 'ready'), 0) AS count
      FROM word_preparation_attempts a JOIN word_preparation_work w USING(work_id)
      WHERE w.word_id = ? AND w.stage IN ('bootstrap','teaching') GROUP BY w.stage`).all(row.word_id) as { stage: string; attempts: number; count: number }[] : [];
    return {
      contentKey: row.content_key, wordId: row.word_id, kind: row.kind, title: row.title ?? `Introduction: ${row.hanzi ?? 'word'}`,
      word: row.hanzi === null ? null : { hanzi: row.hanzi, pinyin: row.pinyin ?? '' },
      firstUsedAt: row.first_used_at, secondLearnerUsedAt: row.second_used_at, learnerCount: row.learner_count,
      completedLearnerCount: completed?.count ?? null,
      generation: generation.length ? { bootstrapAttempts: generation.find(r => r.stage === 'bootstrap')?.attempts ?? 0, teachingAttempts: generation.find(r => r.stage === 'teaching')?.attempts ?? 0, bootstrapSuccessfulAttempts: generation.find(r => r.stage === 'bootstrap')?.count ?? 0, teachingSuccessfulAttempts: generation.find(r => r.stage === 'teaching')?.count ?? 0 } : null,
    };
  });
  const reflected = db.prepare(`WITH attempts AS (
    SELECT 'production_cue' AS kind, evidence.cue_id AS cue_id, event.learner_id, event.occurred_at AS attempted_at
    FROM learner_owned_production_cue_evidence_records evidence JOIN learner_owned_study_attempt_events event
      ON event.learner_id = evidence.learner_id AND event.id = evidence.source_attempt_id
    WHERE evidence.record_kind = 'attempt' AND event.action_kind = 'production' AND event.projected_at IS NOT NULL
    UNION ALL SELECT 'pure_cue', pure_cue_id, learner_id, committed_at FROM pure_cue_attempts
  ) SELECT a.kind, COUNT(DISTINCT a.cue_id) AS count FROM attempts a
  JOIN shared_content_publications p ON p.content_kind = a.kind AND p.content_id = a.cue_id
  JOIN learner_owned_shared_content_publication_provenance origin USING(publication_id)
  JOIN learner_owned_reflection_operation_invocations invocation ON invocation.invocation_id = origin.source_invocation_id
  WHERE a.learner_id != origin.learner_id AND julianday(a.attempted_at) >= julianday(?)
    AND julianday(a.attempted_at) < julianday(?) AND julianday(a.attempted_at) >= julianday(origin.authorized_at) AND julianday(a.attempted_at) <= julianday(?)
  GROUP BY a.kind`).all(...bounds, now.toISOString()) as { kind: string; count: number }[];
  const productionCues = reflected.find(r => r.kind === 'production_cue')?.count ?? 0;
  const pureCues = reflected.find(r => r.kind === 'pure_cue')?.count ?? 0;
  const overlap = db.prepare(`SELECT COUNT(*) AS studied_words,
    COALESCE(SUM(learner_count > 1), 0) AS shared_words FROM (
    SELECT word_id, COUNT(DISTINCT learner_id) AS learner_count FROM learner_word_state
    WHERE status IN ('learning','review') GROUP BY word_id
  )`).get() as { studied_words: number; shared_words: number };
  return {
    weekStart, weekEnd, currentWeekStart: currentSharingWeek(now), isCurrentWeek: weekStart === currentSharingWeek(now), generatedAt: now.toISOString(),
    newlyReused: { introductions: count('introduction'), rehearsals: count('rehearsal'), reviewCues: count('production_cue') + count('pure_cue') },
    reflectionCuesAttemptedByOthers: { productionCues, pureCues, total: productionCues + pureCues },
    overlap: { studiedWords: overlap.studied_words, wordsStudiedByMultipleLearners: overlap.shared_words }, examples,
    coverageNotes: [
      'Weeks run Monday through Sunday in UTC; the current week is partial.',
      'Introduction reuse counts immutable packages opened by a second distinct learner. Rehearsal and review reuse counts exact frozen content encounters; an encounter does not prove completion.',
      'Reflection reuse counts distinct published cues with committed attempts by someone other than the originating learner, at cue identity rather than exact revision.',
      'Earlier activity without recorded introductions or exact encounters is absent. Studied-word overlap includes historical/imported progress and is not evidence of shared content use.',
      'Learner and completion counts, publication registry membership, and studied-word overlap reflect current records, not historical snapshots. Generation counts are recorded word-level preparation attempts and successful attempts, not package-specific cost or proof of avoided generation.',
    ],
  };
}
