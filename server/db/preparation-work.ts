import { randomUUID } from 'node:crypto';
import { getDb } from './connection.ts';
import { getSharedIntroductionLexicalWord, getSharedWordIntroductionPreparation,
  getSharedWordIntroductionContent, getSharedWordTeachingPackageId } from './word-introductions.ts';
import { getSharedWordReviewPreparation } from './review-content.ts';

export type WordPreparationStage = 'bootstrap' | 'teaching' | 'review';
export type WordPreparationWork = {
  workId: string; wordId: string; stage: WordPreparationStage; sourceContentId: string | null;
  status: 'queued' | 'running' | 'ready' | 'paused'; attemptCount: number;
  nextAttemptAt: string; activeToken: string | null; expiresAt: string | null; lastError: string | null;
};
const projection = `work_id AS workId, word_id AS wordId, stage, source_content_id AS sourceContentId,
  status, attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt,
  active_token AS activeToken, expires_at AS expiresAt, last_error AS lastError`;
function transaction<T>(work: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function time(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Expected canonical UTC time');
  return value;
}
export function getWordPreparationWork(wordId: string, stage: WordPreparationStage): WordPreparationWork | null {
  return getDb().prepare(`SELECT ${projection} FROM word_preparation_work WHERE word_id = ? AND stage = ?`)
    .get(wordId, stage) as WordPreparationWork | undefined ?? null;
}
/** Demand is shared and idempotent. Enqueue never resets a failed budget. */
export function enqueueWordPreparation(wordId: string, stage: WordPreparationStage, now = new Date().toISOString()): WordPreparationWork {
  time(now);
  if (!['bootstrap', 'teaching', 'review'].includes(stage)) throw new Error('Unknown preparation stage');
  if (!getSharedIntroductionLexicalWord(wordId)) throw new Error('Word not found');
  if (stage !== 'bootstrap') enqueueWordPreparation(wordId, 'bootstrap', now);
  const source = stage === 'bootstrap' ? null : getSharedWordIntroductionPreparation(wordId)?.contentId ?? null;
  getDb().prepare(`INSERT OR IGNORE INTO word_preparation_work
    (work_id, word_id, stage, source_content_id, status, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`)
    .run(randomUUID(), wordId, stage, source, now, now, now);
  return getWordPreparationWork(wordId, stage)!;
}
export function listDueWordPreparation(now = new Date().toISOString(), limit = 100): WordPreparationWork[] {
  time(now);
  return getDb().prepare(`SELECT ${projection} FROM word_preparation_work
    WHERE status = 'queued' AND next_attempt_at <= ?
      AND (stage = 'bootstrap' OR EXISTS (
        SELECT 1 FROM word_introduction_preparation prepared
        WHERE prepared.word_id = word_preparation_work.word_id AND prepared.content_id IS NOT NULL
      ))
    ORDER BY CASE WHEN stage = 'bootstrap' THEN 1 ELSE 0 END, next_attempt_at, created_at, work_id LIMIT ?`)
    .all(now, limit) as WordPreparationWork[];
}
/** The existing content-stage lease is acquired first. This records its provider attempt, not a second publication lease. */
export function beginWordPreparationAttempt(workId: string, token: string, sourceContentId: string | null,
  now: string, expiresAt: string): boolean {
  time(now); time(expiresAt);
  if (!token.trim() || expiresAt <= now) throw new Error('Invalid preparation attempt lease');
  return transaction(() => {
    const result = getDb().prepare(`UPDATE word_preparation_work
      SET status = 'running', active_token = ?, expires_at = ?, attempt_count = attempt_count + 1,
          source_content_id = COALESCE(source_content_id, ?), updated_at = ?
      WHERE work_id = ? AND status = 'queued' AND attempt_count < 3 AND next_attempt_at <= ?
        AND (source_content_id IS NULL OR source_content_id = ?)`)
      .run(token, expiresAt, sourceContentId, now, workId, now, sourceContentId);
    if (Number(result.changes) !== 1) return false;
    getDb().prepare(`INSERT INTO word_preparation_attempts (attempt_id, work_id, started_at) VALUES (?, ?, ?)`)
      .run(token, workId, now);
    return true;
  });
}
export function markWordPreparationReady(workId: string, now = new Date().toISOString(), token: string | null = null): void {
  time(now);
  transaction(() => ready(workId, now, token));
}
function ready(workId: string, now: string, token: string | null): void {
    const current = getDb().prepare(`SELECT status, active_token FROM word_preparation_work WHERE work_id = ?`)
      .get(workId) as { status: string; active_token: string | null } | undefined;
    if (!current || (token === null ? current.status !== 'queued' : current.status !== 'running' || current.active_token !== token)) return;
    getDb().prepare(`UPDATE word_preparation_attempts SET finished_at = ?, outcome = 'ready'
      WHERE work_id = ? AND outcome IS NULL`).run(now, workId);
    getDb().prepare(`UPDATE word_preparation_work SET status = 'ready', active_token = NULL,
      expires_at = NULL, last_error = NULL, updated_at = ? WHERE work_id = ?`).run(now, workId);
}
export function isSharedWordPreparationReady(wordId: string, stage: WordPreparationStage): boolean {
  const source = getSharedWordIntroductionContent(wordId);
  if (stage === 'bootstrap') return source !== null;
  if (stage === 'teaching') return getSharedWordTeachingPackageId(wordId) !== null;
  const review = getSharedWordReviewPreparation(wordId);
  return source !== null && review?.sourceContentId === source.id && review.ready;
}
/** Withdrawn published content needs an operator disposition, never speculative regeneration. */
export function pauseUnavailableWordPreparation(workId: string, diagnostic: string, now = new Date().toISOString()): void {
  time(now);
  getDb().prepare(`UPDATE word_preparation_work SET status = 'paused', last_error = ?, updated_at = ?
    WHERE work_id = ? AND status = 'queued'`).run(diagnostic, now, workId);
}
function failed(workId: string, token: string, diagnostic: string, now: string, interrupted: boolean): void {
  const row = getDb().prepare(`SELECT ${projection} FROM word_preparation_work WHERE work_id = ?`)
    .get(workId) as WordPreparationWork | undefined;
  if (!row || row.status !== 'running' || row.activeToken !== token) return;
  const next = new Date(Date.parse(now) + Math.min(60 * 60_000, 30_000 * 2 ** (row.attemptCount - 1))).toISOString();
  getDb().prepare(`UPDATE word_preparation_attempts SET finished_at = ?, outcome = ?, diagnostic = ?
    WHERE attempt_id = ? AND outcome IS NULL`).run(now, interrupted ? 'interrupted' : 'failed', diagnostic, token);
  getDb().prepare(`UPDATE word_preparation_work SET status = ?, next_attempt_at = ?, active_token = NULL,
    expires_at = NULL, last_error = ?, updated_at = ? WHERE work_id = ?`)
    .run(row.attemptCount >= 3 ? 'paused' : 'queued', next, diagnostic, now, workId);
}
export function failWordPreparationAttempt(workId: string, token: string, diagnostic: string, now = new Date().toISOString()): void {
  time(now);
  transaction(() => failed(workId, token, diagnostic, now, false));
}
/** A crash consumes the already recorded attempt. Never retry while its publication lease may still be live. */
export function recoverExpiredWordPreparation(now = new Date().toISOString()): void {
  time(now);
  transaction(() => {
    const rows = getDb().prepare(`SELECT ${projection} FROM word_preparation_work
      WHERE status = 'running' AND expires_at <= ?`).all(now) as WordPreparationWork[];
    for (const row of rows) {
      // Publication commits before the operational journal update. Recover that success even on attempt three.
      if (isSharedWordPreparationReady(row.wordId, row.stage)) ready(row.workId, now, row.activeToken);
      else failed(row.workId, row.activeToken!, 'Preparation interrupted before completion; lease expired.', now, true);
    }
  });
}
export function listWordPreparationFailures() {
  const rows = getDb().prepare(`SELECT ${projection},
    (SELECT hanzi FROM lexical_words WHERE id = word_id) AS hanzi
    FROM word_preparation_work WHERE last_error IS NOT NULL ORDER BY updated_at DESC`)
    .all() as Array<WordPreparationWork & { hanzi: string }>;
  return rows.map((row) => ({ ...row, attempts: getDb().prepare(`SELECT attempt_id AS attemptId,
    started_at AS startedAt, finished_at AS finishedAt, outcome, diagnostic
    FROM word_preparation_attempts WHERE work_id = ? ORDER BY started_at, attempt_id`).all(row.workId) as Array<{
      attemptId: string; startedAt: string; finishedAt: string | null;
      outcome: 'ready' | 'failed' | 'interrupted' | null; diagnostic: string | null;
    }> }));
}
/** HTTP caller must authorize the operator before invoking this administrative operation. */
export function retryWordPreparation(workId: string, actorId: string, now = new Date().toISOString()): void {
  time(now);
  if (!actorId.trim()) throw new Error('Operator identity required');
  transaction(() => {
    const result = getDb().prepare(`UPDATE word_preparation_work SET status = 'queued', attempt_count = 0,
      next_attempt_at = ?, last_error = NULL, updated_at = ? WHERE work_id = ? AND status = 'paused'`)
      .run(now, now, workId);
    if (Number(result.changes) !== 1) throw new Error('Only paused preparation can be retried');
    getDb().prepare(`INSERT INTO word_preparation_retry_events (event_id, work_id, actor_id, occurred_at)
      VALUES (?, ?, ?, ?)`).run(randomUUID(), workId, actorId.trim(), now);
  });
}
