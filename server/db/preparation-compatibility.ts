import { getDb } from './connection.ts';

/** Deliberate contract boundary, independent of prompt/model revisions. */
export const VOCABULARY_PREPARATION_EPOCH = 1;

/** Caller owns the reserve transaction. False defers until current provider work has settled. */
export function ensureCurrentVocabularyPreparation(wordId: string, now: string): boolean {
  const db = getDb();
  if (!db.isTransaction) throw new Error('Preparation refresh requires a transaction');
  const row = db.prepare(`SELECT preparation_epoch,content_id,package_id,lease_expires_at
    FROM word_introduction_preparation WHERE word_id=?`).get(wordId) as
    {preparation_epoch:number;content_id:string|null;package_id:string|null;lease_expires_at:string|null}|undefined;
  if (row && row.preparation_epoch >= VOCABULARY_PREPARATION_EPOCH) return true;
  // Never invalidate provider leases or reset an unfinished/failed attempt budget.
  if ((row?.lease_expires_at && row.lease_expires_at > now) || db.prepare(`SELECT 1 FROM word_preparation_work
    WHERE word_id=? AND (status IN ('running','paused') OR (stage='review' AND status='queued')) LIMIT 1`).get(wordId)
    || db.prepare(`SELECT 1 FROM vocabulary_practice_preparation WHERE word_id=? AND status IN ('queued','running') LIMIT 1`).get(wordId)) return false;
  db.prepare(`INSERT INTO word_introduction_preparation(word_id,preparation_epoch) VALUES (?,?)
    ON CONFLICT(word_id) DO UPDATE SET content_id=NULL,package_id=NULL,active_stage=NULL,
      lease_token=NULL,lease_expires_at=NULL,preparation_epoch=excluded.preparation_epoch`).run(wordId,VOCABULARY_PREPARATION_EPOCH);
  // Finished artifacts and attempt journals remain. A new compatibility cycle gets its own bounded budget.
  db.prepare(`UPDATE word_preparation_work SET source_content_id=NULL,
    status='queued',attempt_count=CASE WHEN status='ready' THEN 0 ELSE attempt_count END,
    next_attempt_at=CASE WHEN status='ready' THEN ? ELSE next_attempt_at END,
    active_token=NULL,expires_at=NULL,last_error=CASE WHEN status='ready' THEN NULL ELSE last_error END,updated_at=?
    WHERE word_id=? AND stage IN ('bootstrap','teaching') AND status IN ('ready','queued')`).run(now,now,wordId);
  return true;
}

/** Native introductions use the vocabulary contract; imported packages must cross the explicit boundary. */
export function isCompatibleVocabularyIntroduction(wordId: string, body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return true;
  const source = body as Record<string,unknown>;
  if (typeof source.sourcePackageId !== 'string') return true;
  return Boolean(getDb().prepare(`SELECT 1 FROM word_introduction_preparation
    WHERE word_id=? AND preparation_epoch>=? AND package_id=? AND content_id=?`)
    .get(wordId,VOCABULARY_PREPARATION_EPOCH,source.sourcePackageId,
      typeof source.bootstrapContentId === 'string' ? source.bootstrapContentId : null));
}
