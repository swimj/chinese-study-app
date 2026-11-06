import type { SenseContentReconciliationPlan, SenseContentReconciliationProgress } from '../../src/domain/sense-content-reconciliation.ts';
import { getDb } from './connection.ts';
import { parseWordContent } from '../../src/domain/word-content/validation.ts';

export function senseContentReconciliationAuthority(wordId: string): string {
  const db = getDb();
  return JSON.stringify({
    catalog: db.prepare('SELECT sense_catalog_version FROM vocabulary_word_catalogs WHERE word_id=?').get(wordId) ?? null,
    senses: db.prepare('SELECT sense_id,version,status FROM senses WHERE word_id=? ORDER BY sense_id').all(wordId),
    coverage: db.prepare('SELECT version,default_useful_sense_ids_json FROM vocabulary_word_sense_coverage WHERE word_id=?').get(wordId) ?? null,
  });
}

/** Capture at dispatch, compare at publication. An unapplied draft has no runtime authority. */
export function senseContentReconciliationGenerationToken(wordId: string): string | null {
  const row = getDb().prepare("SELECT resolution_id,applied_at,authority_json FROM sense_content_reconciliations WHERE word_id=? AND status='applied' ORDER BY rowid DESC LIMIT 1").get(wordId);
  return row ? JSON.stringify(row) : null;
}
export function assertSenseContentReconciliationGeneration(wordId: string, token: string | null): void {
  if (senseContentReconciliationGenerationToken(wordId) !== token) throw new Error('Reconciliation changed during content generation');
  const row = getDb().prepare("SELECT authority_json,completed_at FROM sense_content_reconciliations WHERE word_id=? AND status='applied' ORDER BY rowid DESC LIMIT 1").get(wordId);
  if (row && row.completed_at === null && row.authority_json !== senseContentReconciliationAuthority(wordId)) throw new Error('Reconciliation authority changed; operator review required');
}

const empty: SenseContentReconciliationProgress = { status: 'not_required', teachingStatus: 'not_required', practiceStatus: 'not_required', errors: [] };
export function senseContentReconciliationProgress(wordId: string): SenseContentReconciliationProgress {
  const db = getDb();
  const row = db.prepare("SELECT applied_plan_json,authority_json,completed_at FROM sense_content_reconciliations WHERE word_id=? AND status='applied' ORDER BY rowid DESC LIMIT 1").get(wordId);
  if (!row) return { ...empty, errors: [] };
  const plan = JSON.parse(String(row.applied_plan_json)) as SenseContentReconciliationPlan;
  if (row.completed_at !== null) return { status: 'ready', teachingStatus: plan.replacementTeachingRequired ? 'ready' : 'not_required', practiceStatus: plan.replacementPracticeRequired ? 'ready' : 'not_required', errors: [] };
  if (row.authority_json !== senseContentReconciliationAuthority(wordId)) return { status: 'failed', teachingStatus: 'failed', practiceStatus: 'failed', errors: ['Canonical inventory or defaults changed after application; review a new resolution.'] };
  const current = db.prepare(`SELECT p.content_id,p.package_id,d.content_json FROM word_introduction_preparation p
    JOIN word_content_documents d ON d.content_id=p.content_id
    JOIN shared_content_publications publication ON publication.publication_id=d.publication_id
    WHERE p.word_id=? AND publication.publication_status IN ('available','shared_trial')`).get(wordId);
  const errors: string[] = [];
  let teachingStatus: SenseContentReconciliationProgress['teachingStatus'] = plan.replacementTeachingRequired ? 'pending' : 'not_required';
  if (plan.replacementTeachingRequired) {
    let scopeAligned = false;
    if (current) {
      const document = parseWordContent(JSON.parse(String(current.content_json)));
      const mappings = db.prepare(`SELECT m.source_use_id,m.sense_id,m.imported_sense_version,s.version,s.status FROM legacy_sense_imports m
        JOIN senses s USING(sense_id) WHERE m.source_content_id=? AND s.word_id=?`).all(current.content_id, wordId) as Array<{source_use_id:string;sense_id:string;imported_sense_version:number;version:number;status:string}>;
      const defaults = db.prepare('SELECT default_useful_sense_ids_json FROM vocabulary_word_sense_coverage WHERE word_id=?').get(wordId);
      const selected = defaults?.default_useful_sense_ids_json ? JSON.parse(String(defaults.default_useful_sense_ids_json)) as string[] : [];
      const represented = document.uses.map(use => mappings.find(mapping => mapping.source_use_id === use.id));
      scopeAligned = represented.length === selected.length && represented.length > 0
        && represented.every(mapping => mapping && mapping.status === 'active' && mapping.version === mapping.imported_sense_version && selected.includes(String(mapping.sense_id)))
        && new Set(represented.map(mapping => mapping?.sense_id)).size === selected.length;
    }
    const packageReady = scopeAligned && current?.package_id && !plan.retireSourceIds.includes(String(current.content_id))
      && db.prepare(`SELECT 1 FROM word_teaching_packages p JOIN shared_content_publications s USING(publication_id)
        WHERE p.package_id=? AND p.content_id=? AND s.publication_status IN ('available','shared_trial')`).get(current.package_id, current.content_id);
    if (packageReady) teachingStatus = 'ready';
    else {
      const failed = db.prepare("SELECT stage,last_error FROM word_preparation_work WHERE word_id=? AND stage IN ('bootstrap','teaching') AND status='paused'").all(wordId) as Array<{stage:string;last_error:string|null}>;
      if (failed.length) { teachingStatus = 'failed'; errors.push(...failed.map(work => `${work.stage}: ${work.last_error ?? 'Preparation paused'}`)); }
    }
  }
  let practiceStatus: SenseContentReconciliationProgress['practiceStatus'] = plan.replacementPracticeRequired ? 'pending' : 'not_required';
  if (plan.replacementPracticeRequired && current && !plan.retireSourceIds.includes(String(current.content_id))) {
    const work = db.prepare(`SELECT status,last_error FROM vocabulary_practice_preparation WHERE word_id=? AND source_content_id=?
      ORDER BY created_at DESC,work_id DESC LIMIT 1`).get(wordId, current.content_id);
    if (work?.status === 'ready' && work.last_error === null) practiceStatus = 'ready';
    if (work?.status === 'failed') { practiceStatus = 'failed'; errors.push(`Practice: ${work.last_error ?? 'Preparation failed'}`); }
  }
  const states = [teachingStatus, practiceStatus];
  return { status: states.includes('failed') ? 'failed' : states.includes('pending') ? 'pending' : 'ready', teachingStatus, practiceStatus, errors };
}
export function isSenseContentReconciliationPending(wordId: string): boolean {
  return ['pending', 'failed'].includes(senseContentReconciliationProgress(wordId).status);
}
/** Call within replacement publication's transaction; later policy edits are ordinary product work. */
export function settleSenseContentReconciliation(wordId: string): void {
  if (senseContentReconciliationProgress(wordId).status !== 'ready') return;
  getDb().prepare(`UPDATE sense_content_reconciliations SET completed_at=? WHERE rowid=(
    SELECT rowid FROM sense_content_reconciliations WHERE word_id=? AND status='applied' ORDER BY rowid DESC LIMIT 1)
    AND completed_at IS NULL`).run(new Date().toISOString(), wordId);
}
/** Worker demand persists through restart and does not depend on another teaching completion. */
export function listSenseContentReconciliationPracticeDemand(): string[] {
  return (getDb().prepare("SELECT DISTINCT word_id FROM sense_content_reconciliations WHERE status='applied' ORDER BY word_id").all() as Array<{ word_id: string }>)
    .filter(row => { const progress = senseContentReconciliationProgress(row.word_id); return progress.teachingStatus === 'ready' && progress.practiceStatus === 'pending'; })
    .map(row => row.word_id);
}
