import { canonicalExerciseSource } from '../vocabulary/canonical-exercise-source.ts';
import { randomUUID } from 'node:crypto';
import type { SenseContentReconciliationDraft, SenseContentReconciliationPlan, SenseContentReconciliationResolution,
  SenseContentReconciliationSave, SenseContentReconciliationWord, SenseContentReconciliationWorkspace } from '../../src/domain/sense-content-reconciliation.ts';
import type { VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { parseWordContent } from '../../src/domain/word-content/validation.ts';
import { isOperatorSubject, parseOperatorAllowlist } from '../operator-access.ts';
import { inventoryHash, type InventorySnapshot } from '../vocabulary/sense-inventory-reconciliation.ts';
import { config, getDb } from './connection.ts';
import { snapshotInventoryForReconciliation } from './sense-inventory-reconciliation-report.ts';
import { getVocabularyContentForMaintenance, updateVocabularyContent, getVocabularySenses, mapVocabularyContentSense } from './vocabulary-content.ts';
import { getVocabularyWordSenseCoverage, writeVocabularyDefaultUsefulSenses } from './vocabulary-sense-coverage.ts';
import { VOCABULARY_PREPARATION_EPOCH } from './preparation-compatibility.ts';
import { senseContentReconciliationAuthority, senseContentReconciliationProgress } from './sense-content-reconciliation-state.ts';

export class SenseContentReconciliationError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) { super(message); }
}
type Row = Record<string, string | number | null>;
type Stored = Row & { resolution_id: string; word_id: string; version: number; status: SenseContentReconciliationResolution['status'];
  draft_json: string; snapshot_json: string; applied_plan_json: string | null; created_at: string; updated_at: string; applied_at: string | null };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const sorted = (items: Iterable<string>): string[] => [...new Set(items)].sort();
function authorize(actorId: string): void {
  if (!isOperatorSubject(actorId, parseOperatorAllowlist(), config.authMode)) throw new SenseContentReconciliationError('Operator access required', 403);
}
function atomic<T>(work: () => T, mode: 'read' | 'write' = 'write'): T {
  const db = getDb(), nested = db.isTransaction, point = `reconcile_${randomUUID().replaceAll('-', '')}`;
  db.exec(nested ? `SAVEPOINT ${point}` : mode === 'read' ? 'BEGIN' : 'BEGIN IMMEDIATE');
  try { const value = work(); db.exec(nested ? `RELEASE ${point}` : 'COMMIT'); return value; }
  catch (error) { db.exec(nested ? `ROLLBACK TO ${point}` : 'ROLLBACK'); if (nested) db.exec(`RELEASE ${point}`); throw error; }
}
function stored(wordId: string): Stored | null {
  return getDb().prepare('SELECT * FROM sense_content_reconciliations WHERE word_id=? ORDER BY rowid DESC LIMIT 1').get(wordId) as Stored | undefined ?? null;
}
function snapshot(wordId: string): InventorySnapshot {
  if (!getDb().prepare('SELECT 1 FROM lexical_words WHERE id=?').get(wordId)) throw new SenseContentReconciliationError('Unknown vocabulary word', 404);
  const current = snapshotInventoryForReconciliation(getDb(), wordId, { mode: 'online' });
  if (!teaching(current)) {
    const previous = getDb().prepare("SELECT snapshot_json FROM sense_content_reconciliations WHERE word_id=? AND status='applied' ORDER BY rowid DESC LIMIT 1").get(wordId);
    // A pending replacement has no current pointer. Retain the last reviewed
    // teaching as evidence while taking inventory and dependencies from today.
    const evidence = previous ? teaching(JSON.parse(String(previous.snapshot_json)) as InventorySnapshot) : null;
    if (evidence) current.dependencies.reconciliationTeachingEvidence = evidence;
  }
  return current;
}
function rows(source: InventorySnapshot, key: string): Row[] { return source.dependencies[key] as Row[]; }
function dependencyFingerprint(source: InventorySnapshot): string {
  const dependencies = { ...source.dependencies };
  // Learning can continue while an operator reviews. These records are preserved, never rewritten.
  for (const key of ['preservedCounts', 'learnerSenses', 'wordSchedules', 'pureCueSchedules', 'retainedSessions', 'pendingCompletions', 'stashed', 'reserve']) delete dependencies[key];
  return inventoryHash({ ...source, dependencies });
}
function resolution(row: Stored): SenseContentReconciliationResolution {
  return { resolutionId: row.resolution_id, wordId: row.word_id, version: row.version, status: row.status,
    draft: JSON.parse(row.draft_json) as SenseContentReconciliationDraft, createdAt: row.created_at, updatedAt: row.updated_at, appliedAt: row.applied_at };
}
function history(row: Stored, actorId: string): void {
  getDb().prepare('INSERT INTO sense_content_reconciliation_history(resolution_id,version,record_json,actor_id,recorded_at) VALUES (?,?,?,?,?)')
    .run(row.resolution_id, row.version, JSON.stringify(row), actorId, row.updated_at);
}
function teaching(source: InventorySnapshot): SenseContentReconciliationWorkspace['teaching'] {
  const current = rows(source, 'introductionPreparation')[0];
  const document = rows(source, 'sourceDocuments').find(row => row.content_id === current?.content_id);
  if (!document) return source.dependencies.reconciliationTeachingEvidence as SenseContentReconciliationWorkspace['teaching'] ?? null;
  const content = parseWordContent(JSON.parse(String(document.content_json)));
  return { contentId: content.id, packageId: typeof current?.package_id === 'string' ? current.package_id : null,
    uses: content.uses.map(use => ({ id: use.id, label: use.label, notes: [...use.notes],
      examples: content.examples.filter(example => use.exampleIds.includes(example.id)).map(({ text, translation, pronunciation }) => ({ text, translation, pronunciation })) })) };
}
function validateSave(value: unknown): asserts value is SenseContentReconciliationSave {
  const text = (entry: unknown): entry is string => typeof entry === 'string' && entry.length <= 10000;
  if (!object(value) || !(value.expectedVersion === null || Number.isSafeInteger(value.expectedVersion) && Number(value.expectedVersion) > 0)
    || !['draft', 'resolved'].includes(String(value.status)) || value.refreshSource !== undefined && typeof value.refreshSource !== 'boolean'
    || !object(value.draft)) throw new SenseContentReconciliationError('Invalid reconciliation save', 400);
  const draft = value.draft;
  if (!text(draft.rationale) || !Array.isArray(draft.defaultSenseIds) || draft.defaultSenseIds.length > 100
    || draft.defaultSenseIds.some(id => !text(id) || !id.trim()) || new Set(draft.defaultSenseIds).size !== draft.defaultSenseIds.length
    || !Array.isArray(draft.unsupportedChanges) || draft.unsupportedChanges.length > 100 || draft.unsupportedChanges.some(change => !text(change))
    || !Array.isArray(draft.uses) || draft.uses.length > 100) throw new SenseContentReconciliationError('Invalid linguistic resolution', 400);
  const ids = new Set<string>();
  for (const use of draft.uses) {
    if (!object(use) || !text(use.useId) || !use.useId.trim() || ids.has(use.useId)
      || !['map', 'reject', 'unsupported'].includes(String(use.decision)) || !(use.senseId === null || text(use.senseId))
      || !text(use.rationale)) throw new SenseContentReconciliationError('Invalid teaching-use decision', 400);
    ids.add(use.useId);
  }
}
function requester(wordId: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT w.requested_by_learner_id AS learner_id FROM word_preparation_work w JOIN learners l ON l.learner_id=w.requested_by_learner_id
    WHERE w.word_id=? AND l.disabled_at IS NULL ORDER BY w.created_at,w.work_id LIMIT 1`).get(wordId)
    ?? db.prepare(`SELECT w.learner_id FROM learner_words w JOIN learners l USING(learner_id) WHERE w.word_id=?
      AND w.in_stash=1 AND w.dismissed_at IS NULL AND l.disabled_at IS NULL ORDER BY w.added_at,w.learner_id LIMIT 1`).get(wordId);
  return row ? String(row.learner_id) : null;
}
function references(value: unknown, ids: Set<string>): boolean {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some(item => references(item, ids));
  return object(value) && Object.values(value).some(item => references(item, ids));
}
function makePlan(row: Stored, current: InventorySnapshot): SenseContentReconciliationPlan {
  if (row.status === 'applied') return JSON.parse(row.applied_plan_json!) as SenseContentReconciliationPlan;
  const source = JSON.parse(row.snapshot_json) as InventorySnapshot, draft = JSON.parse(row.draft_json) as SenseContentReconciliationDraft;
  const blockers: SenseContentReconciliationPlan['blockers'] = [];
  const block = (code: string, message: string, objectIds: string[] = []) => blockers.push({ code, message, objectIds });
  if (row.status !== 'resolved') block('linguistic_resolution', 'Save a resolved linguistic decision before applying.');
  if (dependencyFingerprint(source) !== dependencyFingerprint(current)) block('source_changed', 'Source or dependencies changed. Re-review the current source before applying.', [row.word_id]);
  const material = teaching(source), active = new Set(source.senses.filter(sense => sense.status === 'active').map(sense => sense.senseId));
  if (!material) block('missing_teaching_source', 'No current teaching document is available to reconcile.', [row.word_id]);
  if (draft.defaultSenseIds.some(id => !active.has(id))) block('inventory_change_handler', 'Adding, revising, merging or splitting canonical identities requires an inventory-change handler.', draft.defaultSenseIds.filter(id => !active.has(id)));
  if (!draft.defaultSenseIds.length) block('empty_selection_handler', 'Applying an empty selected scope requires an explicit no-content disposition handler.', [row.word_id]);
  for (const change of draft.unsupportedChanges.filter(value => value.trim())) block('unsupported_change', `Inventory transformation handler required: ${change}`, [row.word_id]);
  const useIds = new Set(material?.uses.map(use => use.id) ?? []);
  if (draft.uses.length !== useIds.size || draft.uses.some(use => !useIds.has(use.useId))) block('use_accounting', 'Every source teaching use needs exactly one decision.', [...useIds]);
  for (const use of draft.uses) {
    if (use.decision === 'unsupported') block('use_handler', 'This teaching use requires a decision or an unsupported transformation handler.', [use.useId]);
    if (use.decision === 'map' && (!use.senseId || !active.has(use.senseId))) block('sense_mapping', 'Map the teaching use to an active canonical sense.', [use.useId]);
  }
  if (!requester(row.word_id)) block('preparation_requester', 'Replacement preparation needs an active requesting learner.', [row.word_id]);
  for (const [key, id] of [['wordPreparation', 'work_id'], ['practicePreparation', 'work_id'], ['senseReadiness', 'word_id'], ['selectionReadiness', 'word_id']] as const) {
    for (const work of rows(current, key)) if (work.status === 'running' || work.active_token != null) block('active_generation', `Wait for active ${key} work to settle.`, [String(work[id])]);
  }
  for (const key of ['introductionPreparation', 'reviewPreparation']) for (const work of rows(current, key)) if (work.lease_token != null) block('active_generation', 'Wait for the active source generation lease to settle.', [row.word_id]);
  // Keep failed job evidence in snapshots, including older saved snapshots, but a
  // failed attempt on a resolved review case no longer requires a disposition.
  // Active jobs still block even if their case has been resolved: they must not
  // publish against content changed by this application.
  const failedJobIds = rows(current, 'pendingReflectionJobs').filter(job=>job.status === 'failed').map(job=>String(job.job_id));
  const resolvedFailedJobs = new Set((getDb().prepare(`SELECT j.job_id FROM vocabulary_reflection_jobs j
    LEFT JOIN vocabulary_case_lineage l ON l.member_case_id=j.case_id
    JOIN vocabulary_case_reviews r ON r.case_id=COALESCE(j.review_case_id,l.case_id,j.case_id)
    WHERE j.status='failed' AND r.state='resolved' AND j.job_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(failedJobIds)) as {job_id:string}[]).map(job=>job.job_id));
  for (const item of rows(current, 'pendingReflectionJobs')) {
    if (item.status === 'failed' && resolvedFailedJobs.has(String(item.job_id))) continue;
    const message = item.status === 'failed'
      ? 'A related assessment failed. Resolve its case before applying.'
      : 'A related assessment is queued or running. Wait for it to finish and resolve its case before applying.';
    block('pending_content_decision', message, [String(item.job_id)]);
  }
  for (const [key, id, message] of [
    ['pendingDispatches', 'dispatch_id', 'A related feedback dispatch has not completed. Resolve it before applying.'],
    ['pendingProposals', 'proposal_id', 'A related content proposal is still open. Review or close it before applying.'],
  ] as const) {
    for (const item of rows(current, key)) block('pending_content_decision', message, [String(item[id])]);
  }
  const covered = new Set(draft.uses.filter(use => use.decision === 'map' && use.senseId).map(use => use.senseId!));
  const replacementPracticeRequired = draft.defaultSenseIds.some(id => !covered.has(id));
  const repertoireMappings: NonNullable<SenseContentReconciliationPlan['repertoireMappings']> = [];
  const retireSourceIds = material ? [material.contentId] : [], retirePackageIds = material?.packageId ? [material.packageId] : [];
  const invalid = new Set([...retireSourceIds, ...retirePackageIds]);
  const contents = rows(source, 'contents'), bindings = rows(source, 'introductionBindings'), retire = new Set<string>();
  for (const content of contents.filter(item => item.availability === 'active')) {
    const targetWord = rows(source, 'contentWords').find(word => word.content_id === content.content_id && word.word_id === row.word_id && word.relation === 'target');
    const sourceDependent = references(JSON.parse(String(content.body_json)), invalid);
    if (targetWord && content.kind === 'introduction') retire.add(String(content.content_id));
    else if (sourceDependent) {
      // Repertoire provenance remains historical. The operator's use mapping can
      // establish current compatibility without replacing its authored content.
      if (!replacementPracticeRequired && content.kind === 'exercise' && content.exercise_role === 'general' && targetWord) {
        const importedUses = rows(source, 'imports').filter(item => item.source_content_id === material?.contentId && item.sense_id === targetWord.sense_id);
        const decisions = importedUses.map(item => draft.uses.find(use => use.useId === item.source_use_id));
        const targets = new Set(decisions.map(use => use?.decision === 'map' ? use.senseId : use?.decision === 'reject' ? null : undefined));
        if (!decisions.length || targets.size !== 1 || targets.has(undefined)) {
          block('repertoire_mapping_handler', 'This exercise cannot be attributed unambiguously to a resolved teaching use.', [String(content.content_id)]);
        } else {
          const target = [...targets][0];
          if (target === null) retire.add(String(content.content_id));
          else if (target !== targetWord.sense_id) repertoireMappings.push({contentId: String(content.content_id), fromSenseId: String(targetWord.sense_id), toSenseId: target!});
        }
      } else retire.add(String(content.content_id));
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const binding of bindings) if (retire.has(String(binding.introduction_id)) || retire.has(String(binding.exercise_id))) {
      for (const id of [String(binding.introduction_id), String(binding.exercise_id)]) if (!retire.has(id) && contents.some(content => content.content_id === id && content.availability === 'active')) { retire.add(id); changed = true; }
    }
  }
  for (const content of contents.filter(item => retire.has(String(item.content_id)))) if (content.access_scope !== 'shared') block('private_content_handler', 'This dependency is private; shared reconciliation cannot retire it.', [String(content.content_id)]);
  for (const mapping of repertoireMappings.filter(mapping => !retire.has(mapping.contentId))) {
    if (contents.find(content => content.content_id === mapping.contentId)?.access_scope !== 'shared') block('private_content_handler', 'This dependency is private; shared reconciliation cannot remap it.', [mapping.contentId]);
  }
  const retainedContentIds = contents.filter(content => content.availability === 'active' && !retire.has(String(content.content_id))).map(content => String(content.content_id));
  const result = { blockers, retireContentIds: sorted(retire), retireSourceIds, retirePackageIds, retainedContentIds,
    replacementTeachingRequired: true, replacementPracticeRequired, repertoireMappings: repertoireMappings.filter(mapping => !retire.has(mapping.contentId)) };
  return { ...result, fingerprint: inventoryHash({ resolutionId: row.resolution_id, version: row.version, source: dependencyFingerprint(source), current: dependencyFingerprint(current), draft, ...result }) };
}

function contentSummary(value: unknown): string {
  const texts: string[] = [];
  function visit(part: unknown): void {
    if (Array.isArray(part)) { part.forEach(visit); return; }
    if (!object(part)) return;
    for (const [key, child] of Object.entries(part)) {
      if (['text', 'prompt', 'translation', 'label', 'teachingNote'].includes(key) && typeof child === 'string') texts.push(child);
      else if (typeof child === 'object') visit(child);
    }
  }
  visit(value);
  return (texts.length ? [...new Set(texts)].join(' · ') : JSON.stringify(value)).slice(0, 500);
}
function workspace(wordId: string, current = snapshot(wordId)): SenseContentReconciliationWorkspace {
  const row = stored(wordId);
  const display = row ? JSON.parse(row.snapshot_json) as InventorySnapshot : current;
  const defaults = getVocabularyWordSenseCoverage(wordId).defaultUsefulSenseIds ?? [];
  return { wordId, hanzi: current.word.hanzi, pinyin: current.word.pinyin,
    senses: display.senses.filter(sense => sense.status === 'active').map(sense => {
      const description = sense.description;
      return { senseId: sense.senseId, version: sense.version, label: object(description) && typeof description.label === 'string' ? description.label : String(description),
        notes: object(description) && Array.isArray(description.notes) ? description.notes.filter((note): note is string => typeof note === 'string') : [], defaultUseful: defaults.includes(sense.senseId) };
    }), teaching: teaching(display), resolution: row ? resolution(row) : null, plan: row ? makePlan(row, current) : null,
    affectedContent: rows(display, 'contents').map(content => ({ contentId: String(content.content_id), kind: String(content.kind), summary: contentSummary(JSON.parse(String(content.body_json))) })),
    progress: senseContentReconciliationProgress(wordId) };
}
export function getSenseContentReconciliationWorkspace(wordId: string, actorId: string): SenseContentReconciliationWorkspace {
  authorize(actorId); return atomic(() => workspace(wordId), 'read');
}
export function listSenseContentReconciliationWords(actorId: string): SenseContentReconciliationWord[] {
  authorize(actorId);
  const db = getDb();
  return atomic(() => {
    const words = db.prepare(`SELECT DISTINCT w.id AS wordId,w.hanzi,w.pinyin,p.content_id,r.status FROM lexical_words w
      LEFT JOIN word_introduction_preparation p ON p.word_id=w.id LEFT JOIN sense_content_reconciliations r ON r.rowid=(SELECT MAX(latest.rowid) FROM sense_content_reconciliations latest WHERE latest.word_id=w.id)
      WHERE r.word_id IS NOT NULL OR p.content_id IS NOT NULL ORDER BY w.hanzi,w.id`).all() as Array<{ wordId: string; hanzi: string; pinyin: string; content_id: string | null; status: string | null }>;
    return words.flatMap(word => {
      const saved = word.status ? [{ wordId: word.wordId, hanzi: word.hanzi, pinyin: word.pinyin, reason: word.status === 'applied' ? `Replacement ${senseContentReconciliationProgress(word.wordId).status}` : 'Saved resolution' }] : [];
      const document = db.prepare('SELECT content_json FROM word_content_documents WHERE content_id=?').get(word.content_id);
      if (!document) return saved;
      const source = parseWordContent(JSON.parse(String(document.content_json)));
      const mappings = db.prepare(`SELECT m.source_use_id,m.sense_id,m.imported_sense_version,s.version,s.status FROM legacy_sense_imports m
        JOIN senses s USING(sense_id) WHERE m.source_content_id=? AND s.word_id=?`).all(word.content_id, word.wordId) as Row[];
      const represented = source.uses.map(use => mappings.find(mapping => mapping.source_use_id === use.id));
      const defaults = getVocabularyWordSenseCoverage(word.wordId).defaultUsefulSenseIds;
      if (represented.some(mapping => !mapping || mapping.status !== 'active' || mapping.version !== mapping.imported_sense_version)
        || new Set(represented.map(mapping => mapping?.sense_id)).size !== source.uses.length) return [{ wordId: word.wordId, hanzi: word.hanzi, pinyin: word.pinyin, reason: 'Teaching and canonical senses differ' }];
      if (defaults !== null && JSON.stringify(sorted(defaults)) !== JSON.stringify(sorted(mappings.map(mapping => String(mapping.sense_id))))) return [{ wordId: word.wordId, hanzi: word.hanzi, pinyin: word.pinyin, reason: 'Teaching and selected default scope differ' }];
      return saved;
    });
  }, 'read');
}
export function saveSenseContentReconciliation(wordId: string, input: SenseContentReconciliationSave, actorId: string): SenseContentReconciliationWorkspace {
  authorize(actorId); validateSave(input);
  return atomic(() => {
    const current = snapshot(wordId), before = stored(wordId);
    if ((before?.version ?? null) !== input.expectedVersion) throw new SenseContentReconciliationError('Resolution changed; reload before saving', 409);
    const continuing = before?.status !== 'applied' ? before : null;
    const source = continuing && !input.refreshSource ? continuing.snapshot_json : JSON.stringify(current);
    // Explicit re-review carries matching decisions forward and exposes new source uses
    // as unresolved. Prior rows and rationale remain in immutable revision history.
    const draft = !continuing || input.refreshSource ? {
      ...input.draft,
      uses: (teaching(current)?.uses ?? []).map(use => input.draft.uses.find(decision => decision.useId === use.id)
        ?? { useId: use.id, decision: 'unsupported' as const, senseId: null, rationale: '' }),
    } : input.draft;
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO sense_content_reconciliations(resolution_id,word_id,version,status,draft_json,snapshot_json,actor_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(resolution_id) DO UPDATE SET version=excluded.version,status=excluded.status,draft_json=excluded.draft_json,
      snapshot_json=excluded.snapshot_json,actor_id=excluded.actor_id,updated_at=excluded.updated_at`)
      .run(continuing?.resolution_id ?? randomUUID(), wordId, (before?.version ?? 0) + 1, input.status, JSON.stringify(draft), source, actorId, continuing?.created_at ?? now, now);
    // Saving changes only the judgment/history, not the dependencies just read.
    history(stored(wordId)!, actorId); return workspace(wordId, current);
  });
}

function retirePublication(kind: string, id: string, actorId: string, reason: string, now: string): void {
  const db = getDb();
  const publication = db.prepare('SELECT publication_id,publication_status FROM shared_content_publications WHERE content_kind=? AND content_id=?').get(kind, id);
  if (!publication) throw new Error('Reconciliation source publication is missing');
  if (publication.publication_status === 'retired') return;
  db.prepare(`INSERT INTO shared_content_publication_events(event_id,publication_id,from_status,to_status,actor_kind,actor_id,reason,occurred_at)
    VALUES (?,?,?,'retired','operator',?,?,?)`).run(randomUUID(), publication.publication_id, publication.publication_status, actorId, reason, now);
  db.prepare("UPDATE shared_content_publications SET publication_status='retired',status_updated_at=? WHERE publication_id=?").run(now, publication.publication_id);
}
function queueReplacement(wordId: string, learnerId: string, now: string): void {
  const db = getDb();
  db.prepare(`INSERT INTO word_introduction_preparation(word_id,preparation_epoch) VALUES (?,?)
    ON CONFLICT(word_id) DO UPDATE SET content_id=NULL,package_id=NULL,active_stage=NULL,lease_token=NULL,lease_expires_at=NULL,
    preparation_epoch=excluded.preparation_epoch`).run(wordId, VOCABULARY_PREPARATION_EPOCH);
  db.prepare("UPDATE vocabulary_practice_preparation SET status='ready',last_error='Source superseded by sense reconciliation',updated_at=? WHERE word_id=? AND status='queued'").run(now, wordId);
  db.prepare("UPDATE word_preparation_work SET status='paused',last_error='Source superseded by sense reconciliation',updated_at=? WHERE word_id=? AND stage='review' AND status='queued'").run(now, wordId);
  for (const stage of ['bootstrap', 'teaching']) db.prepare(`INSERT INTO word_preparation_work
    (work_id,word_id,stage,status,next_attempt_at,created_at,updated_at,requested_by_learner_id) VALUES (?,?,?,'queued',?,?,?,?)
    ON CONFLICT(word_id,stage) DO UPDATE SET source_content_id=NULL,status='queued',attempt_count=0,next_attempt_at=excluded.next_attempt_at,
    active_token=NULL,expires_at=NULL,last_error=NULL,updated_at=excluded.updated_at,requested_by_learner_id=excluded.requested_by_learner_id`)
    .run(randomUUID(), wordId, stage, now, now, now, learnerId);
}
export function applySenseContentReconciliation(wordId: string, input: { expectedVersion: number; planFingerprint: string }, actorId: string): SenseContentReconciliationWorkspace {
  authorize(actorId);
  return atomic(() => {
    const row = stored(wordId);
    if (!row) throw new SenseContentReconciliationError('Save a resolution before applying', 409);
    if (row.status === 'applied') {
      const plan = JSON.parse(row.applied_plan_json!) as SenseContentReconciliationPlan;
      if (plan.fingerprint !== input.planFingerprint || row.version !== input.expectedVersion + 1) throw new SenseContentReconciliationError('Application identity differs from the applied resolution', 409);
      return workspace(wordId);
    }
    if (row.version !== input.expectedVersion) throw new SenseContentReconciliationError('Resolution changed; reload before applying', 409);
    const plan = makePlan(row, snapshot(wordId));
    if (plan.fingerprint !== input.planFingerprint) throw new SenseContentReconciliationError('Application plan changed; review the current plan', 409);
    if (plan.blockers.length) throw new SenseContentReconciliationError(plan.blockers.map(blocker => blocker.message).join(' '), 409);
    const learnerId = requester(wordId); if (!learnerId) throw new Error('Ready reconciliation lost its requester');
    const now = new Date().toISOString(), actor = { kind: 'operator' as const, id: actorId, reason: { resolutionId: row.resolution_id, version: row.version, planFingerprint: plan.fingerprint } };
    for (const id of plan.retireContentIds) {
      const content = getVocabularyContentForMaintenance(id); if (!content) throw new Error('Reviewed reconciliation content disappeared');
      updateVocabularyContent(id, content.version, { ...content, availability: 'retired' }, actor);
    }
    for (const mapping of plan.repertoireMappings ?? []) {
      const content = getVocabularyContentForMaintenance(mapping.contentId);
      const word = content?.words.find(word => word.wordId === row.word_id);
      if (!content || !word || word.senseId !== mapping.fromSenseId) throw new Error('Reviewed repertoire mapping disappeared');
      mapVocabularyContentSense({contentId: mapping.contentId, wordId: row.word_id, expectedContentVersion: content.version,
        expectedMapping: {senseId: word.senseId, establishedAt: word.senseMappingEstablishedAt ?? null}, senseId: mapping.toSenseId}, actor);
    }
    for (const id of plan.retireSourceIds) retirePublication('word_content', id, actorId, `Sense reconciliation ${row.resolution_id}`, now);
    for (const id of plan.retirePackageIds) retirePublication('teaching_package', id, actorId, `Sense reconciliation ${row.resolution_id}`, now);
    const draft = JSON.parse(row.draft_json) as SenseContentReconciliationDraft, coverage = getVocabularyWordSenseCoverage(wordId);
    if (JSON.stringify(sorted(coverage.defaultUsefulSenseIds ?? [])) !== JSON.stringify(sorted(draft.defaultSenseIds))) writeVocabularyDefaultUsefulSenses(wordId, coverage.version, draft.defaultSenseIds, actor);
    queueReplacement(wordId, learnerId, now);
    const lexical = getDb().prepare('SELECT id AS wordId,hanzi,traditional,pinyin FROM lexical_words WHERE id=?').get(wordId) as {wordId:string;hanzi:string;traditional:string|null;pinyin:string};
    const selected = getVocabularySenses(wordId).filter(sense => draft.defaultSenseIds.includes(sense.senseId));
    const practiceSource = {source:canonicalExerciseSource(lexical,selected),senses:selected.map(sense=>({source_use_id:sense.senseId,sense_id:sense.senseId,imported_sense_version:sense.version}))};
    getDb().prepare("UPDATE sense_content_reconciliations SET status='applied',version=version+1,applied_plan_json=?,authority_json=?,practice_source_json=?,actor_id=?,applied_at=?,updated_at=? WHERE resolution_id=?")
      .run(JSON.stringify(plan), senseContentReconciliationAuthority(wordId), JSON.stringify(practiceSource), actorId, now, now, row.resolution_id);
    history(stored(wordId)!, actorId); return workspace(wordId);
  });
}
export function retrySenseContentReconciliation(wordId: string, actorId: string): SenseContentReconciliationWorkspace {
  authorize(actorId);
  return atomic(() => {
    const row = getDb().prepare("SELECT * FROM sense_content_reconciliations WHERE word_id=? AND status='applied' ORDER BY rowid DESC LIMIT 1").get(wordId) as Stored | undefined;
    if (!row) throw new SenseContentReconciliationError('No applied resolution to retry', 409);
    if (row.authority_json !== senseContentReconciliationAuthority(wordId)) throw new SenseContentReconciliationError('Canonical authority changed; a new resolution is required', 409);
    if (senseContentReconciliationProgress(wordId).status !== 'failed') throw new SenseContentReconciliationError('Replacement preparation is not failed', 409);
    const now = new Date().toISOString(), db = getDb();
    db.prepare(`UPDATE word_preparation_work SET status='queued',attempt_count=0,last_error=NULL,next_attempt_at=?,updated_at=?
      WHERE word_id=? AND stage IN ('bootstrap','teaching') AND status='paused'`).run(now, now, wordId);
    db.prepare(`UPDATE vocabulary_practice_preparation SET status='queued',attempt_count=0,last_error=NULL,next_attempt_at=?,updated_at=?
      WHERE word_id=? AND status='failed' AND reconciliation_id=?`).run(now, now, wordId, row.resolution_id);
    return workspace(wordId);
  });
}
