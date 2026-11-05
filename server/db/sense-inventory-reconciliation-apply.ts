import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { VocabularyActor, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { getDb, setDb } from './connection.ts';
import { assertSchemaCurrent } from './migrations.ts';
import { emitBackendEvent, getVocabularyContentForMaintenance, getVocabularySenses,
  updateVocabularyContent, updateVocabularySense } from './vocabulary-content.ts';
import { getVocabularyWordSenseCoverage, pruneVocabularyWordSenseCoverage } from './vocabulary-sense-coverage.ts';
import { VOCABULARY_PREPARATION_EPOCH } from './preparation-compatibility.ts';
import { checkInventoryReconciliation, inventoryHash, type InventorySnapshot, type ReconciliationJudgment } from '../vocabulary/sense-inventory-reconciliation.ts';
import { snapshotInventoryForReconciliation, reportInventoryRetirements } from './sense-inventory-reconciliation-report.ts';

export type InventoryReconciliationPlan = {
  snapshot: InventorySnapshot;
  candidate: unknown;
  judgment: ReconciliationJudgment;
  reportSha256: string;
  contentDecisions: Array<{ contentId: string; decision: 'keep' | 'retire'; rationale: string }>;
};
export type InventoryReconciliationBatch = { operationId: string; actorId: string; plans: InventoryReconciliationPlan[] };
export type InventoryReconciliationReceipt = {
  operationId: string; planSha256: string; appliedAt: string; wordIds: string[];
  retiredSenseIds: string[]; retiredContentIds: string[]; refreshedWordIds: string[]; replayed: boolean;
};
const eventName = 'vocabulary.sense_inventory.reconciled';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** The stopped-writer assertion and expected digest are transport checks, not part of the reviewed plan. */
export function inventoryReconciliationPlanHash(value: unknown): string {
  const batch = validateBatch(value);
  return inventoryHash({ operationId: batch.operationId, actorId: batch.actorId, plans: batch.plans });
}
function validateBatch(value: unknown): InventoryReconciliationBatch {
  if (!record(value) || !nonempty(value.operationId) || !/^[A-Za-z0-9._:-]{1,160}$/.test(value.operationId)
    || !nonempty(value.actorId) || value.actorId.length > 200 || !Array.isArray(value.plans)
    || !value.plans.length || value.plans.length > 1000) throw new Error('Expected an attributed reconciliation batch with one to 1000 plans');
  const words = new Set<string>();
  for (const plan of value.plans) {
    if (!record(plan) || !nonempty(plan.reportSha256) || !Array.isArray(plan.contentDecisions)) throw new Error('Invalid reconciliation plan');
    const checked = checkInventoryReconciliation(plan.snapshot, plan.candidate, plan.judgment);
    if (words.has(checked.wordId)) throw new Error('A word occurs more than once in the batch');
    words.add(checked.wordId);
    if (checked.groups.some(group => group.decision !== 'retain' && group.decision !== 'retire')) {
      throw new Error('This apply operation supports retain/retire only; additions, revisions, splits and merges require separate review');
    }
    for (const decision of plan.contentDecisions) {
      if (!record(decision) || !nonempty(decision.contentId) || !['keep','retire'].includes(String(decision.decision))
        || !nonempty(decision.rationale)) throw new Error('Expected explicit attributed content keep/retire decisions');
    }
  }
  return value as InventoryReconciliationBatch;
}
// Review binds the complete export; applying it only fences data the correction reads or changes.
// Learner progress can advance during review and is retained exactly as found at apply time.
function dependencyHash(snapshot: InventorySnapshot): string {
  const dependencies = { ...snapshot.dependencies };
  for (const key of ['preservedCounts', 'learnerSenses', 'wordSchedules', 'pureCueSchedules', 'retainedSessions']) delete dependencies[key];
  return inventoryHash({ ...snapshot, dependencies });
}
function assertIntegrity(db: DatabaseSync): void {
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed; reconciliation was not committed');
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== 'ok') throw new Error('SQLite integrity check failed; reconciliation was not committed');
}
function retirePublication(db: DatabaseSync, kind: 'word_content' | 'teaching_package', contentId: string, actorId: string, reason: string, now: string): void {
  const publication = db.prepare('SELECT publication_id,publication_status FROM shared_content_publications WHERE content_kind=? AND content_id=?')
    .get(kind, contentId) as { publication_id: string; publication_status: string } | undefined;
  if (!publication) throw new Error('Affected immutable source has no publication');
  if (publication.publication_status === 'retired') return;
  db.prepare(`INSERT INTO shared_content_publication_events
    (event_id,publication_id,from_status,to_status,actor_kind,actor_id,reason,occurred_at)
    VALUES (?,?,?,'retired','operator',?,?,?)`).run(randomUUID(), publication.publication_id, publication.publication_status, actorId, reason, now);
  db.prepare("UPDATE shared_content_publications SET publication_status='retired',status_updated_at=? WHERE publication_id=? AND publication_status=?")
    .run(now, publication.publication_id, publication.publication_status);
}
function refreshPreparation(db: DatabaseSync, wordId: string, selected: boolean, now: string, operationId: string): void {
  const requester = db.prepare(`SELECT w.requested_by_learner_id AS learner_id FROM word_preparation_work w
    JOIN learners l ON l.learner_id=w.requested_by_learner_id WHERE w.word_id=? AND l.disabled_at IS NULL
    ORDER BY w.created_at,w.work_id LIMIT 1`).get(wordId) as { learner_id: string } | undefined
    ?? db.prepare(`SELECT w.learner_id FROM learner_words w JOIN learners l USING(learner_id)
      WHERE w.word_id=? AND w.in_stash=1 AND w.dismissed_at IS NULL AND l.disabled_at IS NULL
      ORDER BY w.added_at,w.learner_id LIMIT 1`).get(wordId) as { learner_id: string } | undefined;
  db.prepare(`INSERT INTO word_introduction_preparation(word_id,preparation_epoch) VALUES (?,?)
    ON CONFLICT(word_id) DO UPDATE SET content_id=NULL,package_id=NULL,active_stage=NULL,
      lease_token=NULL,lease_expires_at=NULL,preparation_epoch=excluded.preparation_epoch`).run(wordId, VOCABULARY_PREPARATION_EPOCH);
  const diagnostic = `Source superseded by inventory reconciliation ${operationId}`;
  // Old source jobs remain evidence. Their inputs are never rebound to the new document.
  db.prepare("UPDATE vocabulary_practice_preparation SET status='ready',last_error=?,updated_at=? WHERE word_id=? AND status='queued'")
    .run(diagnostic, now, wordId);
  db.prepare("UPDATE word_preparation_work SET status='paused',last_error=?,updated_at=? WHERE word_id=? AND stage='review' AND status='queued'")
    .run(diagnostic, now, wordId);
  for (const stage of ['bootstrap','teaching']) {
    if (selected && requester) {
      db.prepare(`INSERT INTO word_preparation_work
        (work_id,word_id,stage,source_content_id,status,attempt_count,next_attempt_at,created_at,updated_at,requested_by_learner_id)
        VALUES (?,?,?,NULL,'queued',0,?,?,?,?)
        ON CONFLICT(word_id,stage) DO UPDATE SET source_content_id=NULL,status='queued',attempt_count=0,
          next_attempt_at=excluded.next_attempt_at,active_token=NULL,expires_at=NULL,last_error=NULL,
          updated_at=excluded.updated_at,requested_by_learner_id=excluded.requested_by_learner_id`)
        .run(randomUUID(), wordId, stage, now, now, now, requester.learner_id);
    } else {
      db.prepare(`UPDATE word_preparation_work SET status='paused',last_error=?,updated_at=?,active_token=NULL,expires_at=NULL
        WHERE word_id=? AND stage=?`).run(diagnostic, now, wordId, stage);
    }
  }
  db.prepare(`INSERT INTO learner_word_reserve_requests(learner_id,requested_at)
    SELECT DISTINCT w.learner_id,? FROM learner_words w JOIN learners l USING(learner_id)
    WHERE w.word_id=? AND l.disabled_at IS NULL
    ON CONFLICT(learner_id) DO UPDATE SET requested_at=excluded.requested_at`).run(now, wordId);
}

/** Offline operation: validates the whole batch under one write lock before changing any word. */
export function applySenseInventoryReconciliation(db: DatabaseSync, input: unknown): InventoryReconciliationReceipt {
  if (!record(input) || input.confirmAppStopped !== true) throw new Error('Explicit stopped-writer confirmation is required');
  const batch = validateBatch(input);
  const planSha256 = inventoryReconciliationPlanHash(batch);
  if (input.expectedPlanSha256 !== planSha256) throw new Error('Expected plan hash does not match the reviewed batch');
  if (db.isTransaction) throw new Error('Reconciliation owns its transaction; nested application is not supported');
  if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) throw new Error('Foreign key enforcement must be enabled');
  assertSchemaCurrent(db);
  let previous: DatabaseSync | null = null;
  try { previous = getDb(); } catch { /* A standalone CLI has no installed connection. */ }
  setDb(db);
  try {
    db.exec('BEGIN IMMEDIATE');
    const receipts = db.prepare("SELECT data_json FROM backend_events WHERE name=? AND entity_kind='inventory_reconciliation' AND entity_id=?")
      .all(eventName, batch.operationId) as Array<{ data_json: string }>;
    if (receipts.length > 1) throw new Error('Duplicate reconciliation receipts require investigation');
    if (receipts.length === 1) {
      const receipt = JSON.parse(receipts[0]!.data_json) as InventoryReconciliationReceipt;
      if (receipt.planSha256 !== planSha256) throw new Error('Operation identity was already used for another plan');
      db.exec('COMMIT');
      return { ...receipt, replayed: true };
    }
    assertIntegrity(db);
    const reports = batch.plans.map(plan => {
      const current = snapshotInventoryForReconciliation(db, plan.snapshot.word.wordId);
      if (dependencyHash(current) !== dependencyHash(plan.snapshot)) throw new Error(`Reconciliation snapshot changed for ${plan.snapshot.word.wordId}`);
      const retireIds = plan.judgment.groups.filter(group => group.decision === 'retire').flatMap(group => group.existingSenseIds);
      const report = reportInventoryRetirements(current, retireIds);
      if (inventoryHash(report) !== plan.reportSha256) throw new Error(`Dependency report changed for ${plan.snapshot.word.wordId}`);
      if (report.blockers.length) throw new Error(`Unresolved reconciliation blockers for ${plan.snapshot.word.wordId}: ${report.blockers.join('; ')}`);
      return report;
    });
    const dispositions = new Map<string, 'keep' | 'retire'>();
    for (const [index, plan] of batch.plans.entries()) {
      const report = reports[index]!;
      const required = new Set(report.requiredRetireContentIds);
      const expected = new Set([...required, ...report.reviewContentIds]);
      const seen = new Set<string>();
      for (const decision of plan.contentDecisions) {
        if (!expected.has(decision.contentId) || seen.has(decision.contentId)) throw new Error('Unexpected or duplicate content disposition');
        if (required.has(decision.contentId) && decision.decision !== 'retire') throw new Error('A required content retirement cannot be kept');
        const previousDecision = dispositions.get(decision.contentId);
        if (previousDecision && previousDecision !== decision.decision) throw new Error('Conflicting content dispositions across words');
        dispositions.set(decision.contentId, decision.decision); seen.add(decision.contentId);
      }
      if (seen.size !== expected.size) throw new Error('Every affected content item needs an explicit keep/retire disposition');
    }
    for (const plan of batch.plans) {
      const bindings = plan.snapshot.dependencies.introductionBindings as Array<{ introduction_id: string; exercise_id: string }>;
      const contents = plan.snapshot.dependencies.contents as Array<{ content_id: string; availability: string }>;
      const active = new Set(contents.filter(row => row.availability === 'active').map(row => row.content_id));
      for (const binding of bindings) {
        if (!active.has(binding.introduction_id) || !active.has(binding.exercise_id)) continue;
        const introduction = dispositions.get(binding.introduction_id), exercise = dispositions.get(binding.exercise_id);
        if ((introduction === 'retire' || exercise === 'retire') && introduction !== exercise) {
          throw new Error('Bound teaching content must be retired together; conflicting or missing disposition');
        }
      }
    }
    const appliedAt = new Date().toISOString();
    const actor: VocabularyActor = { kind: 'operator', id: batch.actorId, reason: { operationId: batch.operationId, planSha256 } };
    const retiredSenseIds: string[] = [], retiredContentIds: string[] = [], refreshedWordIds: string[] = [];
    for (const [contentId, decision] of dispositions) {
      if (decision !== 'retire') continue;
      const content = getVocabularyContentForMaintenance(contentId);
      if (!content || content.availability === 'retired') throw new Error('Reviewed content retirement no longer names active content');
      updateVocabularyContent(contentId, content.version, { ...content, availability: 'retired' }, actor);
      retiredContentIds.push(contentId);
    }
    for (const [index, plan] of batch.plans.entries()) {
      const report = reports[index]!, wordId = plan.snapshot.word.wordId;
      if (!report.retireSenseIds.length) continue;
      const senseById = new Map(getVocabularySenses(wordId).map(sense => [sense.senseId, sense]));
      for (const id of report.retireSenseIds) {
        const sense = senseById.get(id);
        if (!sense || sense.status !== 'active') throw new Error('Reviewed retirement no longer names an active sense');
        updateVocabularySense(id, sense.version, { description: sense.description, status: 'retired' }, actor);
        retiredSenseIds.push(id);
      }
      const coverage = getVocabularyWordSenseCoverage(wordId);
      const afterCoverage = pruneVocabularyWordSenseCoverage(wordId, coverage.version, actor);
      const surviving = new Set(getVocabularySenses(wordId).filter(sense => sense.status === 'active').map(sense => sense.senseId));
      const reason = `Inventory reconciliation ${batch.operationId}`;
      for (const id of report.contaminatedSourceIds) retirePublication(db, 'word_content', id, batch.actorId, reason, appliedAt);
      for (const id of report.contaminatedPackageIds) retirePublication(db, 'teaching_package', id, batch.actorId, reason, appliedAt);
      if (report.refreshPreparation) {
        refreshPreparation(db, wordId, surviving.size > 0 && (afterCoverage.defaultUsefulSenseIds === null || afterCoverage.defaultUsefulSenseIds.length > 0), appliedAt, batch.operationId);
        refreshedWordIds.push(wordId);
      }
    }
    const receipt: InventoryReconciliationReceipt = { operationId: batch.operationId, planSha256, appliedAt,
      wordIds: batch.plans.map(plan => plan.snapshot.word.wordId), retiredSenseIds: retiredSenseIds.sort(),
      retiredContentIds: retiredContentIds.sort(), refreshedWordIds: refreshedWordIds.sort(), replayed: false };
    emitBackendEvent({ name: eventName, entityKind: 'inventory_reconciliation', entityId: batch.operationId,
      actorKind: 'operator', actorId: batch.actorId, data: receipt as unknown as VocabularyJson });
    assertIntegrity(db);
    db.exec('COMMIT');
    return receipt;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { setDb(previous); }
}
