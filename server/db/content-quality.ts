import { createHash } from 'node:crypto';
import {
  CONTENT_QUALITY_KINDS,
  type ContentQualityAnalytics,
  type ContentQualityBreakdown,
  type ContentQualityTotals,
  type ContentQualityFilters,
  type ContentQualityItem,
  type ContentQualityRatingLedger,
  type ContentQualityRating,
  type ContentQualityState,
  type ContentQualityTarget,
} from '../../src/domain/content-quality.ts';
import { materializeExercise, materializeTeachingPackage } from '../../src/domain/word-content/materialize.ts';
import { config, getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { getPureCueServedSnapshot } from './pure-cues.ts';
import { getCanonicalReviewContent } from './review-content.ts';
export class ContentQualityInputError extends Error {
}

function invalid(message: string): never {
  throw new ContentQualityInputError(message);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 250;
}

export function parseContentQualityTarget(value: unknown): ContentQualityTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('Expected content target');
  }
  const v = value as Record<string, unknown>;
  if (v.kind === 'pure_cue' && identifier(v.snapshotId)) {
    return { kind: v.kind, snapshotId: v.snapshotId };
  }
  if (v.kind === 'teaching_package' && identifier(v.packageId)) {
    return { kind: v.kind, packageId: v.packageId };
  }
  if (v.kind === 'rehearsal' && identifier(v.packageId) && identifier(v.rehearsalId)) {
    return {
      kind: v.kind,
      packageId: v.packageId,
      rehearsalId: v.rehearsalId
    };
  }
  if ((v.kind === 'production_cue' || v.kind === 'supplement') && identifier(v.id)) {
    return { kind: v.kind, id: v.id };
  }
  if (v.kind === 'contrast_prompt' && identifier(v.id)
    && v.expected && typeof v.expected === 'object' && !Array.isArray(v.expected)) {
    const expected = v.expected as Record<string, unknown>;
    if (typeof expected.promptText === 'string' && typeof expected.explanation === 'string'
      && identifier(expected.targetWordId)) {
      return {
        kind: v.kind,
        id: v.id,
        expected: {
          promptText: expected.promptText,
          explanation: expected.explanation,
          targetWordId: expected.targetWordId,
        },
      };
    }
  }
  return invalid('Invalid content target');
}

type Resolved = Pick<ContentQualityItem, 'kind' | 'sourceId' | 'wordId' | 'title' | 'content' | 'provenance'>;
function resolve(target: ContentQualityTarget): Resolved {
  const db = getDb();
  if (target.kind === 'pure_cue') {
    const snapshot = getPureCueServedSnapshot(target.snapshotId);
    if (!snapshot) {
      return invalid('Content is not available');
    }
    const { snapshotId: _snapshotId, servedAt: _servedAt, ...content } = snapshot;
    // A current canonical model is not truthful provenance for an older served revision.
    return {
      kind: target.kind,
      sourceId: snapshot.pureCueId,
      wordId: null,
      title: snapshot.stimulus,
      content,
      provenance: { source: 'served pure cue', model: null }
    };
  }
  if (target.kind === 'teaching_package' || target.kind === 'rehearsal') {
    const row = db.prepare(`
      SELECT p.package_json, p.word_id, p.model, c.content_json
      FROM word_teaching_packages p
      JOIN word_content_documents c ON c.content_id = p.content_id
      WHERE p.package_id = ?
    `).get(target.packageId) as {
      package_json: string;
      word_id: string;
      model: string;
      content_json: string;
    } | undefined;
    if (!row) {
      return invalid('Content is not available');
    }
    const snapshot = materializeTeachingPackage(JSON.parse(row.package_json), [JSON.parse(row.content_json)]);
    const content = target.kind === 'rehearsal' ? snapshot.rehearsals.find(r => r.exerciseId === target.rehearsalId) : snapshot;
    if (!content) {
      return invalid('Rehearsal is not available');
    }
    return {
      kind: target.kind,
      sourceId: target.kind === 'rehearsal' ? `${target.packageId}/${target.rehearsalId}` : target.packageId,
      wordId: row.word_id,
      title: `${target.kind === 'rehearsal' ? 'Rehearsal' : 'Introduction'}: ${JSON.parse(row.content_json).word.hanzi}`,
      content,
      provenance: { source: 'teaching package', model: row.model }
    };
  }
  if (target.kind === 'production_cue') {
    const row = db.prepare(`
      SELECT c.cue_text, c.cue_type, c.origin_kind, t.word_id
      FROM production_cues c JOIN production_tasks t ON t.task_id = c.task_id
      WHERE c.cue_id = ?
    `).get(target.id) as {
      cue_text: string;
      cue_type: string;
      origin_kind: string;
      word_id: string;
    } | undefined;
    if (!row) {
      return invalid('Content is not available');
    }
    const acceptedAnswers = db.prepare(`
      SELECT w.id AS wordId, w.hanzi, w.traditional
      FROM production_cue_accepted_words a
      JOIN lexical_words w ON w.id = a.word_id
      WHERE a.cue_id = ? ORDER BY a.position
    `).all(target.id);
    const record = getCanonicalReviewContent('production_cue', target.id);
    return {
      kind: target.kind,
      sourceId: target.id,
      wordId: row.word_id,
      title: row.cue_text,
      content: record?.kind === 'production_cue'
        ? materializeExercise(record.exercise, record.contents, config.studyProfile)
        : {
          cueText: row.cue_text,
          cueType: row.cue_type,
          acceptedAnswers
        },
      provenance: {
        source: row.origin_kind === 'manual' && record?.model ? 'prepared review' : row.origin_kind,
        model: record?.model ?? null,
      }
    };
  }
  if (target.kind === 'supplement') {
    const row = db.prepare(`
      SELECT s.english_frame, s.example_sentence, s.example_translation, t.word_id
      FROM production_cue_supplements s
      JOIN production_tasks t ON t.task_id = s.task_id
      WHERE s.supplement_id = ?
    `).get(target.id) as {
      english_frame: string;
      example_sentence: string;
      example_translation: string;
      word_id: string;
    } | undefined;
    if (!row) {
      return invalid('Content is not available');
    }
    const record = getCanonicalReviewContent('production_cue_supplement', target.id);
    return {
      kind: target.kind,
      sourceId: target.id,
      wordId: row.word_id,
      title: row.english_frame,
      content: row,
      provenance: { source: 'production supplement', model: record?.model ?? null }
    };
  }
  if (target.kind !== 'contrast_prompt') throw new Error('Unresolved content quality target');
  const row = db.prepare('SELECT target_word_id, prompt_text, explanation FROM contrast_prompts WHERE id=?').get(target.id) as {
    target_word_id: string;
    prompt_text: string;
    explanation: string;
  } | undefined;
  if (!row) {
    return invalid('Content is not available');
  }
  if (row.prompt_text !== target.expected.promptText
    || row.explanation !== target.expected.explanation
    || row.target_word_id !== target.expected.targetWordId) {
    return invalid('Content changed since this encounter; open a fresh session to rate it');
  }
  return {
    kind: target.kind,
    sourceId: target.id,
    wordId: row.target_word_id,
    title: row.prompt_text,
    content: row,
    provenance: { source: 'contrast prompt', model: null }
  };
}

export function recordContentQualityEncounter(target: ContentQualityTarget, encounterId: string): ContentQualityState {
  if (!identifier(encounterId)) {
    return invalid('Invalid encounter id');
  }
  const learnerId = requireLearnerId();
  const resolved = resolve(parseContentQualityTarget(target));
  const contentJson = JSON.stringify(resolved.content);
  const contentKey = createHash('sha256').update(JSON.stringify([resolved.kind, resolved.sourceId, contentJson])).digest('hex');
  const db = getDb();
  const now = new Date().toISOString();
  db.exec('SAVEPOINT content_quality_encounter');
  try {
    db.prepare(`INSERT OR IGNORE INTO content_quality_items VALUES (?,?,?,?,?,?,?,?)`).run(
      contentKey, resolved.kind, resolved.sourceId, resolved.wordId,
      resolved.title, contentJson, JSON.stringify(resolved.provenance), now,
    );
    db.prepare(`INSERT OR IGNORE INTO learner_content_quality_encounters VALUES (?,?,?,?)`).run(learnerId, encounterId, contentKey, now);
    db.exec('RELEASE content_quality_encounter');
  } catch (error) {
    db.exec('ROLLBACK TO content_quality_encounter; RELEASE content_quality_encounter');
    throw error;
  }
  const row = db.prepare('SELECT rating FROM learner_content_quality_ratings WHERE learner_id=? AND content_key=?').get(learnerId, contentKey) as {
    rating: ContentQualityRating;
  } | undefined;
  return { contentKey, rating: row?.rating ?? null };
}

export function setContentQualityRating(contentKey: string, rating: ContentQualityRating): ContentQualityState {
  if (!identifier(contentKey) || (rating !== null && rating !== 'up' && rating !== 'down')) {
    return invalid('Invalid quality rating');
  }
  const learnerId = requireLearnerId();
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM learner_content_quality_encounters WHERE learner_id=? AND content_key=? LIMIT 1').get(learnerId, contentKey)) {
    return invalid('Content has not been encountered');
  }
  if (rating === null) {
    db.prepare('DELETE FROM learner_content_quality_ratings WHERE learner_id=? AND content_key=?').run(learnerId, contentKey);
  } else {
    db.prepare(`
      INSERT INTO learner_content_quality_ratings VALUES (?, ?, ?, ?)
      ON CONFLICT(learner_id, content_key)
      DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at
    `).run(learnerId, contentKey, rating, new Date().toISOString());
  }
  return { contentKey, rating };
}

type QualitySummaryRow = {
  content_key: string;
  kind: ContentQualityItem['kind'];
  provenance_json: string;
  exposures: number;
  learners_exposed: number;
  up: number;
  down: number;
  last_seen_at: string;
};

type QualitySnapshotRow = {
  content_key: string;
  kind: ContentQualityItem['kind'];
  source_id: string;
  word_id: string | null;
  title: string;
  content_json: string;
  provenance_json: string;
};

function emptyTotals(): ContentQualityTotals {
  return { exposures: 0, learnerContentPairs: 0, up: 0, down: 0, ratedLearners: 0, coverage: 0 };
}

function addSummary(totals: ContentQualityTotals, row: QualitySummaryRow): void {
  totals.exposures += row.exposures;
  totals.learnerContentPairs += row.learners_exposed;
  totals.up += row.up;
  totals.down += row.down;
  totals.ratedLearners = totals.up + totals.down;
  totals.coverage = totals.learnerContentPairs ? totals.ratedLearners / totals.learnerContentPairs : 0;
}

export function getContentQualityAnalytics(filters: ContentQualityFilters = {}): ContentQualityAnalytics {
  const { kind, since, until, limit = 50, offset = 0 } = filters;
  const date = (value: string | undefined) => value === undefined || (
    /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value
  );
  if ((kind !== undefined && !CONTENT_QUALITY_KINDS.includes(kind))
    || !date(since) || !date(until) || (since && until && since > until)
    || !Number.isInteger(limit) || limit < 1 || limit > 100
    || !Number.isInteger(offset) || offset < 0) {
    return invalid('Invalid quality filters');
  }
  // Exposure cohort first, then current standing votes: repeat displays never multiply votes.
  const rows = getDb().prepare(`
    WITH cohort AS (
      SELECT e.content_key,e.learner_id,count(*) exposures,max(e.seen_at) last_seen_at
      FROM learner_content_quality_encounters e JOIN content_quality_items i ON i.content_key=e.content_key
      WHERE (? IS NULL OR i.kind=?) AND (? IS NULL OR e.seen_at>=?) AND (? IS NULL OR e.seen_at<?)
      GROUP BY e.content_key,e.learner_id
) SELECT i.content_key, i.kind, i.provenance_json, sum(c.exposures) exposures,count(*) learners_exposed,
      sum(CASE WHEN r.rating='up' THEN 1 ELSE 0 END) up,
      sum(CASE WHEN r.rating='down' THEN 1 ELSE 0 END) down,max(c.last_seen_at) last_seen_at
      FROM cohort c JOIN content_quality_items i ON i.content_key=c.content_key
      LEFT JOIN learner_content_quality_ratings r ON r.content_key=c.content_key AND r.learner_id=c.learner_id
      GROUP BY i.content_key ORDER BY down DESC,exposures DESC,i.content_key`).all(
    kind ?? null, kind ?? null,
    since ?? null, since ? `${since}T00:00:00.000Z` : null,
    until ?? null, until ? new Date(Date.parse(until) + 86400000).toISOString() : null,
  ) as QualitySummaryRow[];
  const totals = emptyTotals();
  const groups = new Map<string, ContentQualityBreakdown>();
  for (const row of rows) {
    addSummary(totals, row);
    const provenance = JSON.parse(row.provenance_json) as ContentQualityItem['provenance'];
    const key = JSON.stringify([row.kind, provenance.source, provenance.model]);
    let group = groups.get(key);
    if (!group) {
      group = { kind: row.kind, ...provenance, totals: emptyTotals() };
      groups.set(key, group);
    }
    addSummary(group.totals, row);
  }
  const breakdowns = [...groups.values()].sort((a, b) =>
    b.totals.down - a.totals.down
    || b.totals.exposures - a.totals.exposures
    || JSON.stringify([a.kind, a.source, a.model]).localeCompare(JSON.stringify([b.kind, b.source, b.model])),
  );
  return {
    totalItems: rows.length,
    totals,
    breakdowns,
    items: rows.slice(offset, offset + limit).map(summary => {
      const snapshot = getDb().prepare('SELECT * FROM content_quality_items WHERE content_key = ?')
        .get(summary.content_key) as QualitySnapshotRow;
      const r = { ...snapshot, ...summary };
      return ({
        contentKey: r.content_key,
        kind: r.kind,
        sourceId: r.source_id,
        wordId: r.word_id,
        title: r.title,
        content: JSON.parse(r.content_json),
        provenance: JSON.parse(r.provenance_json),
        exposures: r.exposures,
        learnersExposed: r.learners_exposed,
        up: r.up,
        down: r.down,
        ratedLearners: r.up + r.down,
        coverage: (r.up + r.down) / r.learners_exposed,
        lastSeenAt: r.last_seen_at
      });
    })
  };
}

/** Current non-null votes, ordered newest first, plus counts grouped by exact snapshot. */
export function getContentQualityRatingLedger(): ContentQualityRatingLedger {
  const rows = getDb().prepare(`
    SELECT i.content_key, i.kind, i.source_id, i.title, i.content_json, r.rating, r.updated_at
    FROM learner_content_quality_ratings r
    JOIN content_quality_items i ON i.content_key = r.content_key
    ORDER BY r.updated_at DESC, i.content_key ASC, r.rating ASC
  `).all() as Array<{
    content_key: string;
    kind: ContentQualityItem['kind'];
    source_id: string;
    title: string;
    content_json: string;
    rating: 'up' | 'down';
    updated_at: string;
  }>;
  const bySnapshot = new Map<string, ContentQualityRatingLedger['snapshots'][number]>();
  const ratings = rows.map((row) => {
    let snapshot = bySnapshot.get(row.content_key);
    if (!snapshot) {
      snapshot = {
        contentKey: row.content_key,
        kind: row.kind,
        sourceId: row.source_id,
        title: row.title,
        content: JSON.parse(row.content_json),
        up: 0,
        down: 0,
        totalRatings: 0,
      };
      bySnapshot.set(row.content_key, snapshot);
    }
    snapshot[row.rating] += 1;
    snapshot.totalRatings += 1;
    return {
      contentKey: row.content_key,
      kind: row.kind,
      sourceId: row.source_id,
      title: row.title,
      content: JSON.parse(row.content_json),
      rating: row.rating,
      updatedAt: row.updated_at,
    };
  });
  return { ratings, snapshots: [...bySnapshot.values()], totalRatings: ratings.length };
}

export function validateContentQualitySchema(): void {
  for (const table of ['content_quality_items', 'learner_content_quality_encounters', 'learner_content_quality_ratings']) {
    if (!getDb().prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) {
      throw new Error(`Missing ${table}`);
    }
  }
}
