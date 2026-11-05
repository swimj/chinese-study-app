import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { before, beforeEach, after, afterEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { addVocabularyWord } from '../server/db/vocabulary-learners.ts';
import { createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog, getVocabularySenses,
  createVocabularyContent, getVocabularyContentForMaintenance } from '../server/db/vocabulary-content.ts';
import { writeVocabularyDefaultUsefulSenses, getVocabularyWordSenseCoverage } from '../server/db/vocabulary-sense-coverage.ts';
import { isVocabularySessionWordEligible } from '../server/db/vocabulary-sense-eligibility.ts';
import { claimSharedWordIntroductionStage, finishSharedWordIntroductionBootstrap } from '../server/db/word-introductions.ts';
import { enqueueWordPreparation } from '../server/db/preparation-work.ts';
import { inventoryHash, type ReconciliationJudgment } from '../server/vocabulary/sense-inventory-reconciliation.ts';
import { snapshotInventoryForReconciliation, reportInventoryRetirements } from '../server/db/sense-inventory-reconciliation-report.ts';
import { applySenseInventoryReconciliation, inventoryReconciliationPlanHash, type InventoryReconciliationPlan,
  type InventoryReconciliationBatch } from '../server/db/sense-inventory-reconciliation-apply.ts';
import type { VocabularyJson } from '../src/domain/vocabulary-content.ts';

const at = '2026-11-04T12:00:00.000Z';
const actor = { kind: 'service' as const, id: 'reconciliation-fixture' };
let root: string, baseline: string, db: DatabaseSync;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sense-reconciliation-apply-'));
  const directory = path.join(root, 'baseline'); createBaselineFixture(directory); baseline = path.join(directory, 'app.db');
});
after(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  const file = path.join(root, 'current.db'); fs.copyFileSync(baseline, file); db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON'); db.function('current_learner_id', () => 'learner'); migrateDatabase(db); setDb(db);
  db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('learner', 'Learner', at);
  word('word');
});
afterEach(() => { setDb(null); db.close(); });
function word(id: string): void {
  db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES (?, '垂', NULL, 'chuí', 'hang; approach', '["hang","approach"]', '[]', 1, ?)`).run(id, at);
  createVocabularySense({ senseId: `${id}:keep`, wordId: id, description: { label: 'Hang downward', notes: ['Physical use.'] } }, actor);
  createVocabularySense({ senseId: `${id}:retire`, wordId: id, description: { label: 'Be critically ill', notes: ['Only supported by 垂危.'] } }, actor);
  establishVocabularySenseCatalog(id, getVocabularySenseCatalog(id).version, actor);
  writeVocabularyDefaultUsefulSenses(id, 0, [`${id}:keep`, `${id}:retire`], actor);
  runWithLearnerId('learner', () => addVocabularyWord(id));
  db.prepare("INSERT INTO learner_senses(learner_id,word_id,sense_id,disposition) VALUES ('learner',?,?,'active')").run(id, `${id}:retire`);
}
function exercise(id: string, senseId: string | null, body: VocabularyJson = { prompt: 'Hang downward.' }, wordId = 'word') {
  return createVocabularyContent({ contentId: id, kind: 'exercise', payloadVersion: 1, body,
    exerciseType: 'definition', skill: 'production', exerciseRole: 'general', assessment: { match: 'prepared_answer_membership' },
    answers: [{ wordId, acceptedForms: ['垂'] }], words: [{ wordId, relation: 'target', senseId,
      senseMappingEstablishedAt: senseId ? at : null }], accessScope: 'shared', availability: 'active', originKind: 'human' }, actor);
}
function plan(wordId = 'word', retireIds = [`${wordId}:retire`]): InventoryReconciliationPlan {
  db.exec('BEGIN');
  let snapshot: ReturnType<typeof snapshotInventoryForReconciliation>;
  try { snapshot = snapshotInventoryForReconciliation(db, wordId); } finally { db.exec('ROLLBACK'); }
  const retained = snapshot.senses.filter(sense => sense.status === 'active' && !retireIds.includes(sense.senseId));
  const candidate = { senses: retained.map(sense => ({ label: `Candidate wording ${sense.senseId}`, notes: [], defaultUseful: false })) };
  const judgment: ReconciliationJudgment = { snapshotSha256: inventoryHash(snapshot), candidateSha256: inventoryHash(candidate), reviewer: 'fixture-reviewer',
    groups: snapshot.senses.filter(sense => sense.status === 'active').map(sense => retireIds.includes(sense.senseId)
      ? { existingSenseIds: [sense.senseId], candidateIndexes: [], decision: 'retire' as const, rationale: 'Reviewed compound-only meaning.' }
      : { existingSenseIds: [sense.senseId], candidateIndexes: [retained.findIndex(item => item.senseId === sense.senseId)], decision: 'retain' as const, rationale: 'Same target meaning; retain its original identity and wording.' }) };
  const report = reportInventoryRetirements(snapshot, retireIds);
  return { snapshot, candidate, judgment, reportSha256: inventoryHash(report), contentDecisions: report.affectedContent.map(content => ({
    contentId: content.contentId, decision: content.requiredRetirement ? 'retire' as const : 'keep' as const, rationale: 'Explicit fixture content review.',
  })) };
}
function batch(plans: InventoryReconciliationPlan[], operationId = 'test-operation'): InventoryReconciliationBatch {
  return { operationId, actorId: 'operator', plans };
}
function apply(plans: InventoryReconciliationPlan[], operationId = 'test-operation') {
  const input = batch(plans, operationId);
  return applySenseInventoryReconciliation(db, { ...input, expectedPlanSha256: inventoryReconciliationPlanHash(input), confirmAppStopped: true });
}
function table(name: string) { return db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(); }
function historicalState() {
  return Object.fromEntries(['learner_words', 'learner_senses', 'learner_word_schedules', 'vocabulary_sessions',
    'session_actions', 'exercise_encounters', 'encounter_words', 'learner_pure_cue_schedules', 'word_content_documents', 'legacy_sense_imports', 'word_teaching_packages',
    'word_preparation_attempts', 'teaching_completions'].map(name => [name, table(name)]));
}
function caseCoverage(id = 'case'): void {
  db.prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,status)
    VALUES (?, 'learner', 1, ?, ?, 'closed')`).run(`session:${id}`, JSON.stringify({ words: [{ wordId: 'word' }], retained: 'exact source' }), at);
  db.prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,through_sequence,staged_at,close_at,status,input_json,report_json,policy_version,closed_at)
    VALUES (?, 'learner', ?, 1, 0, ?, ?, 'closed', '{}', '{}', 'fixture', ?)`).run(`completion:${id}`, `session:${id}`, at, at, at);
  db.prepare(`INSERT INTO vocabulary_reflection_session_evidence(completion_id,learner_id,session_id,projection_json,created_at)
    VALUES (?, 'learner', ?, '{}', ?)`).run(`completion:${id}`, `session:${id}`, at);
  db.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,status,evidence_snapshot_json,created_at)
    VALUES (?, ?, 'learner', 'exercise_improvement', ?, 'word', 'closed', '{}', ?)`).run(id, `completion:${id}`, id, at);
  db.prepare('INSERT INTO vocabulary_case_reviews(case_id,created_at) VALUES (?,?)').run(id, at);
  db.prepare('INSERT INTO vocabulary_case_lineage(case_id,member_case_id) VALUES (?,?)').run(id, id);
  db.prepare('INSERT INTO vocabulary_case_sense_coverage(case_id,version,included_sense_ids_json,updated_at) VALUES (?,1,?,?)').run(id, JSON.stringify(['word:keep', 'word:retire']), at);
}
function bootstrap(): string {
  const token = 'bootstrap-claim', now = new Date().toISOString(), id = 'old-bootstrap';
  assert.equal(claimSharedWordIntroductionStage('word', 'bootstrap', token, now, new Date(Date.now() + 300_000).toISOString()), 'claimed');
  const senses = getVocabularySenses('word');
  finishSharedWordIntroductionBootstrap('word', token, { schemaVersion: 1, id,
    word: { wordId: 'word', hanzi: '垂', traditional: null, pinyin: 'chuí' },
    uses: senses.map(sense => ({ id: sense.senseId, label: sense.senseId, notes: [], exampleIds: ['example'] })),
    examples: [{ id: 'example', text: '树枝垂到水面。', translation: 'The branches hang down to the water.', pronunciation: null }],
  }, 'fixture', null, { catalogVersion: getVocabularySenseCatalog('word').version,
    senseVersions: senses.map(sense => ({ senseId: sense.senseId, version: sense.version })), senseIds: senses.map(sense => sense.senseId) });
  return id;
}

test('retain/retire preserves identity, learner history and defaults while recording audited revisions', () => {
  const kept = exercise('kept', 'word:keep'), retired = exercise('retired', 'word:retire');
  caseCoverage();
  caseCoverage('historical-case');
  db.prepare("UPDATE vocabulary_case_lineage SET case_id='case' WHERE member_case_id='historical-case'").run();
  db.prepare("DELETE FROM vocabulary_case_reviews WHERE case_id='historical-case'").run();
  const historicalCoverage = db.prepare("SELECT * FROM vocabulary_case_sense_coverage WHERE case_id='historical-case'").get();
  db.prepare(`INSERT INTO session_actions(action_id,learner_id,session_id,sequence_number,client_action_id,kind,action_json,encounter_id,word_id,occurred_at,recorded_at)
    VALUES ('presented','learner','session:case',1,'presented','presentation',?,'encounter','word',?,?)`).run(JSON.stringify({ contentId: retired.contentId, body: retired.body }), at, at);
  db.prepare(`INSERT INTO exercise_encounters(encounter_id,learner_id,session_id,presented_action_id,content_id,content_version,selected_through_word_id,context_json,served_snapshot_json,presented_at)
    VALUES ('encounter','learner','session:case','presented',?,1,'word','{}',?,?)`).run(retired.contentId, JSON.stringify({ body: retired.body, assessment: retired.assessment }), at);
  db.prepare("INSERT INTO encounter_words(learner_id,encounter_id,word_id,role) VALUES ('learner','encounter','word','target')").run();
  const history = historicalState(); const originalSense = getVocabularySenses('word').find(sense => sense.senseId === 'word:keep');
  const originalContent = getVocabularyContentForMaintenance(kept.contentId);
  const result = apply([plan()]);
  assert.equal(result.replayed, false);
  assert.deepEqual(getVocabularySenses('word').find(sense => sense.senseId === 'word:keep'), originalSense);
  assert.equal(getVocabularySenses('word').find(sense => sense.senseId === 'word:retire')!.status, 'retired');
  assert.deepEqual(getVocabularyContentForMaintenance(kept.contentId), originalContent);
  assert.equal(getVocabularyContentForMaintenance(retired.contentId)!.availability, 'retired');
  assert.equal(getVocabularyContentForMaintenance(retired.contentId)!.version, 2);
  assert.deepEqual(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds, ['word:keep']);
  assert.deepEqual(JSON.parse(String(db.prepare("SELECT included_sense_ids_json FROM vocabulary_case_sense_coverage WHERE case_id='case'").get()!.included_sense_ids_json)), ['word:keep', 'word:retire']);
  assert.deepEqual(db.prepare("SELECT * FROM vocabulary_case_sense_coverage WHERE case_id='historical-case'").get(), historicalCoverage);
  assert.deepEqual(historicalState(), history);
  assert.equal(db.prepare("SELECT count(*) n FROM sense_revision_history WHERE sense_id='word:retire'").get()!.n, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('all-retire leaves the word stashed and ineligible with empty defaults', () => {
  const history = historicalState();
  apply([plan('word', ['word:keep', 'word:retire'])]);
  assert.equal(isVocabularySessionWordEligible('word'), false);
  assert.deepEqual(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds, []);
  assert.deepEqual(historicalState(), history);
});

test('reviewed apply is idempotent and a reused operation ID cannot authorize a different plan', () => {
  const reviewed = plan(), first = apply([reviewed]), count = db.prepare('SELECT total_changes() n').get()!.n;
  const second = apply([reviewed]);
  assert.equal(second.replayed, true); assert.equal(second.planSha256, first.planSha256);
  assert.equal(db.prepare('SELECT total_changes() n').get()!.n, count);
  const changed = structuredClone(reviewed); changed.judgment.reviewer = 'another-reviewer';
  assert.throws(() => apply([changed]), /operation|receipt|different|hash/i);
});

test('app-stopped assertion and exact reviewed batch digest are required before mutation', () => {
  const input = batch([plan()]), before = table('senses');
  assert.throws(() => applySenseInventoryReconciliation(db, { ...input, expectedPlanSha256: inventoryReconciliationPlanHash(input), confirmAppStopped: false }), /stopped/i);
  assert.throws(() => applySenseInventoryReconciliation(db, { ...input, expectedPlanSha256: 'wrong', confirmAppStopped: true }), /hash|digest/i);
  assert.deepEqual(table('senses'), before);
});

for (const change of ['catalog', 'coverage', 'new-content', 'report'] as const) test(`changed ${change} evidence rejects the whole reviewed batch`, () => {
  word('second'); const reviewed = [plan(), plan('second')];
  if (change === 'catalog') createVocabularySense({ wordId: 'second', description: { label: 'Added after review', notes: [] } }, actor);
  if (change === 'coverage') writeVocabularyDefaultUsefulSenses('second', 1, ['second:keep'], actor);
  if (change === 'new-content') exercise('late-content', 'second:retire', { prompt: 'Late content' }, 'second');
  if (change === 'report') reviewed[1]!.reportSha256 = 'wrong';
  const before = table('senses');
  assert.throws(() => apply(reviewed), /stale|changed|hash|snapshot|report/i);
  assert.deepEqual(table('senses'), before);
});

test('failure during a later word mutation rolls back earlier retirements and their histories', () => {
  word('second'); const reviewed = [plan(), plan('second')], before = table('senses'), revisions = table('sense_revision_history');
  db.exec("CREATE TEMP TRIGGER fail_second_retirement BEFORE UPDATE ON senses WHEN NEW.sense_id='second:retire' BEGIN SELECT RAISE(ABORT,'fixture forced rollback'); END");
  assert.throws(() => apply(reviewed), /fixture forced rollback/);
  assert.deepEqual(table('senses'), before); assert.deepEqual(table('sense_revision_history'), revisions);
  assert.equal(db.isTransaction, false);
});

test('ambiguous unmapped content requires an explicit disposition and required retirements cannot be kept', () => {
  exercise('unmapped', null); exercise('bad', 'word:retire');
  const reviewed = plan(); assert.ok(reviewed.contentDecisions.some(item => item.contentId === 'unmapped'));
  const missing = structuredClone(reviewed); missing.contentDecisions = missing.contentDecisions.filter(item => item.contentId !== 'unmapped');
  assert.throws(() => apply([missing]), /content|decision|disposition/i);
  const unsafe = structuredClone(reviewed); unsafe.contentDecisions.find(item => item.contentId === 'bad')!.decision = 'keep';
  assert.throws(() => apply([unsafe]), /retir|content|decision/i);
  apply([reviewed]); assert.equal(getVocabularyContentForMaintenance('unmapped')!.availability, 'active');
});

test('contaminated source pins and native introductions require retirement while immutable sources survive', () => {
  const source = bootstrap();
  exercise('pinned-survivor', 'word:keep', { prompt: 'Hang downward.', source: { bootstrapContentId: source } });
  createVocabularyContent({ contentId: 'native-intro', kind: 'introduction', payloadVersion: 1, body: { text: 'Both old senses.' },
    words: [{ wordId: 'word', relation: 'target' }], teachingExercises: [], accessScope: 'shared', availability: 'active', originKind: 'human' }, actor);
  const reviewed = plan(), report = reportInventoryRetirements(reviewed.snapshot, ['word:retire']);
  assert.equal(report.affectedContent.find(item => item.contentId === 'pinned-survivor')?.requiredRetirement, true);
  assert.ok(report.affectedContent.some(item => item.contentId === 'native-intro'));
  reviewed.contentDecisions.find(item => item.contentId === 'native-intro')!.decision = 'retire';
  const history = historicalState(); apply([reviewed]);
  assert.equal(getVocabularyContentForMaintenance('pinned-survivor')!.availability, 'retired');
  assert.equal(getVocabularyContentForMaintenance('native-intro')!.availability, 'retired');
  assert.equal(db.prepare("SELECT content_id FROM word_introduction_preparation WHERE word_id='word'").get()!.content_id, null);
  assert.deepEqual(historicalState(), history);
});

test('running preparation and queued reflection jobs block apply before any retirement', () => {
  const work = runWithLearnerId('learner', () => enqueueWordPreparation('word', 'bootstrap'));
  db.prepare("UPDATE word_preparation_work SET status='running',active_token='busy',expires_at='2020-01-01T00:00:00.000Z' WHERE work_id=?").run(work.workId);
  const reviewed = plan(); assert.throws(() => apply([reviewed]), /running|lease|block/i);
  db.prepare("UPDATE word_preparation_work SET status='ready',active_token=NULL,expires_at=NULL WHERE work_id=?").run(work.workId);
  caseCoverage('pending-case');
  db.prepare("INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at) VALUES ('pending','pending-case','exercise_improvement','pending','queued',?,?)").run(at, at);
  assert.throws(() => apply([plan()]), /pending|queued|block|reflection/i);
  assert.equal(getVocabularySenses('word').every(sense => sense.status === 'active'), true);
});

test('teaching refresh retains attempts and immutable sources while queuing a bounded replacement', () => {
  bootstrap();
  const work = runWithLearnerId('learner', () => enqueueWordPreparation('word', 'teaching'));
  db.prepare("UPDATE word_preparation_work SET status='ready',attempt_count=2 WHERE word_id='word'").run();
  db.prepare("INSERT INTO word_preparation_attempts(attempt_id,work_id,started_at,finished_at,outcome,diagnostic) VALUES ('old-attempt',?,?,?,'ready','retained evidence')").run(work.workId, at, at);
  const history = historicalState(); apply([plan()]);
  assert.deepEqual(historicalState(), history);
  const jobs = db.prepare("SELECT stage,status,attempt_count,source_content_id FROM word_preparation_work WHERE word_id='word' ORDER BY stage").all() as
    Array<{ stage: string; status: string; attempt_count: number; source_content_id: string | null }>;
  assert.ok(jobs.some(job => job.stage === 'teaching' && job.status === 'queued' && job.source_content_id === null));
  assert.ok(jobs.some(job => job.stage === 'bootstrap' && job.status === 'queued'));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});


test('retain-only review is a no-op for authored content, preparation and selected defaults', () => {
  bootstrap(); exercise('unmapped-kept', null);
  runWithLearnerId('learner', () => enqueueWordPreparation('word', 'teaching'));
  const before = { senses: table('senses'), content: table('content_items'), jobs: table('word_preparation_work'),
    pointers: table('word_introduction_preparation'), coverage: table('vocabulary_word_sense_coverage') };
  const reviewed = plan('word', []);
  assert.deepEqual(reviewed.contentDecisions, []);
  apply([reviewed]);
  assert.deepEqual({ senses: table('senses'), content: table('content_items'), jobs: table('word_preparation_work'),
    pointers: table('word_introduction_preparation'), coverage: table('vocabulary_word_sense_coverage') }, before);
});

test('unknown useful defaults remain unknown while some senses survive', () => {
  db.prepare("UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL WHERE word_id='word'").run();
  apply([plan()]);
  assert.equal(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds, null);
});

test('an empty fresh candidate does not override a reviewed retained sense or its useful default', () => {
  exercise('omitted-valid-content', 'word:keep');
  const reviewed = plan(), originalSense = getVocabularySenses('word').find(sense => sense.senseId === 'word:keep');
  const originalContent = getVocabularyContentForMaintenance('omitted-valid-content');
  reviewed.candidate = { senses: [] };
  reviewed.judgment.candidateSha256 = inventoryHash(reviewed.candidate);
  const retained = reviewed.judgment.groups.find(group => group.decision === 'retain')!;
  retained.candidateIndexes = [];
  retained.rationale = 'A valid existing target sense was omitted from the fresh candidate.';
  const receipt = apply([reviewed]);
  assert.deepEqual(receipt.retiredSenseIds, ['word:retire']);
  assert.deepEqual(getVocabularySenses('word').find(sense => sense.senseId === 'word:keep'), originalSense);
  assert.deepEqual(getVocabularyContentForMaintenance('omitted-valid-content'), originalContent);
  assert.deepEqual(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds, ['word:keep']);
  assert.equal(isVocabularySessionWordEligible('word'), true);
});

test('semantic revisions require separate review rather than silently rewriting retained senses', () => {
  const reviewed = plan(); reviewed.judgment.groups.find(group => group.decision === 'retain')!.decision = 'revise';
  const before = table('senses');
  assert.throws(() => apply([reviewed]), /retain|retire|unsupported|revision/i);
  assert.deepEqual(table('senses'), before);
});

test('learner progress acquired after review is preserved without making the content review stale', () => {
  const reviewed = plan();
  db.prepare("UPDATE learner_senses SET disposition='excluded' WHERE sense_id='word:retire'").run();
  db.prepare(`UPDATE learner_word_schedules SET next_eligible_at='2026-12-01T00:00:00.000Z',
    scheduler_state_json='{"completed":3}',state_version=state_version+1 WHERE learner_id='learner' AND word_id='word'`).run();
  db.prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,status)
    VALUES ('later-session','learner',1,'{"words":[{"wordId":"word"}]}',?,'closed')`).run(at);
  const history = historicalState();
  apply([reviewed]);
  assert.deepEqual(historicalState(), history);
});

test('bound teaching material needs consistent explicit retirement decisions', () => {
  const teaching = createVocabularyContent({ contentId: 'bound-exercise', kind: 'exercise', payloadVersion: 1,
    body: { prompt: 'Hang downward.' }, exerciseType: 'definition', skill: 'production', exerciseRole: 'teaching',
    assessment: { match: 'prepared_answer_membership' }, answers: [{ wordId: 'word', acceptedForms: ['垂'] }],
    words: [{ wordId: 'word', relation: 'target', senseId: 'word:keep', senseMappingEstablishedAt: at }],
    accessScope: 'shared', availability: 'active', originKind: 'human' }, actor);
  createVocabularyContent({ contentId: 'bound-intro', kind: 'introduction', payloadVersion: 1, body: { text: 'Old introduction.' },
    words: [{ wordId: 'word', relation: 'target' }], teachingExercises: [{ exerciseId: teaching.contentId, exerciseVersion: teaching.version }],
    accessScope: 'shared', availability: 'active', originKind: 'human' }, actor);
  const reviewed = plan();
  assert.ok(reviewed.contentDecisions.some(item => item.contentId === teaching.contentId));
  reviewed.contentDecisions.find(item => item.contentId === 'bound-intro')!.decision = 'retire';
  assert.throws(() => apply([reviewed]), /bound|together|conflict/i);
  assert.equal(getVocabularyContentForMaintenance('bound-intro')!.availability, 'active');
  reviewed.contentDecisions.find(item => item.contentId === teaching.contentId)!.decision = 'retire';
  apply([reviewed]);
  assert.equal(getVocabularyContentForMaintenance(teaching.contentId)!.availability, 'retired');
});

test('unknown defaults still queue replacement teaching for surviving senses', () => {
  bootstrap();
  db.prepare("UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL WHERE word_id='word'").run();
  apply([plan()]);
  assert.equal(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds, null);
  assert.equal(db.prepare("SELECT status FROM word_preparation_work WHERE word_id='word' AND stage='teaching'").get()!.status, 'queued');
});

test('source dependency follows rendered references and does not retire a self-contained cloze', () => {
  const source = bootstrap();
  exercise('reference-consumer', 'word:keep', { prompt: 'Hang downward.', source: { bootstrapContentId: source } });
  exercise('self-contained-cloze', 'word:keep', { prompt: '树枝___到水面。', source: { bootstrapContentId: source } });
  const reviewed = plan(), report = reportInventoryRetirements(reviewed.snapshot, ['word:retire']);
  assert.ok(report.requiredRetireContentIds.includes('reference-consumer'));
  assert.equal(report.affectedContent.some(item => item.contentId === 'self-contained-cloze'), false);
  apply([reviewed]);
  assert.equal(getVocabularyContentForMaintenance('self-contained-cloze')!.availability, 'active');
});

test('CLI report, canonical plan hash, apply and receipt recovery complete without provider calls', () => {
  exercise('cli-retired', 'word:retire');
  const reviewed = plan();
  const directory = fs.mkdtempSync(path.join(root, 'cli-'));
  const save = (name: string, value: unknown) => {
    const file = path.join(directory, name); fs.writeFileSync(file, JSON.stringify(value)); return file;
  };
  const run = (...args: string[]): Record<string, unknown> => JSON.parse(execFileSync(process.execPath,
    ['--import', 'tsx', 'scripts/reconcile-sense-inventory.ts', ...args], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' } }));
  const reportFile = path.join(directory, 'report.json');
  const output = run('report', '--snapshot', save('snapshot.json', reviewed.snapshot), '--candidate', save('candidate.json', reviewed.candidate),
    '--judgment', save('judgment.json', reviewed.judgment), '--out', reportFile);
  const generated = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as { reportSha256: string; plan: InventoryReconciliationPlan };
  assert.equal(output.reportSha256, reviewed.reportSha256);
  assert.equal(generated.reportSha256, reviewed.reportSha256);
  assert.deepEqual(generated.plan.contentDecisions, [{ contentId: 'cli-retired', decision: 'retire', rationale: '' }]);
  generated.plan.contentDecisions[0]!.rationale = 'Reviewed compound-only exercise.';
  // Human-authored JSON commonly changes key order; the CLI hashes the same batch contract as apply.
  const reordered = { plans: [generated.plan], actorId: 'operator', operationId: 'cli-operation' };
  const planFile = save('plan.json', reordered);
  const hash = run('hash-plan', '--plan', planFile);
  assert.equal(hash.applied, false);
  assert.equal(hash.planSha256, inventoryReconciliationPlanHash({ operationId: reordered.operationId, actorId: reordered.actorId, plans: reordered.plans }));
  const receiptFile = path.join(directory, 'receipt.json');
  const args = ['apply', '--database', path.join(root, 'current.db'), '--plan', planFile,
    '--expected-plan-sha256', String(hash.planSha256), '--confirm-app-stopped=true'];
  const receipt = run(...args, '--out', receiptFile);
  assert.equal(receipt.replayed, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(receiptFile, 'utf8')), receipt);
  assert.equal(getVocabularyContentForMaintenance('cli-retired')!.availability, 'retired');
  const history = table('sense_revision_history');
  const replayFile = path.join(directory, 'recovered-receipt.json');
  const replay = run(...args, '--out', replayFile);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay, { ...receipt, replayed: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(replayFile, 'utf8')), replay);
  assert.deepEqual(table('sense_revision_history'), history);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

for (const kind of ['pending','accepted'] as const) test(`reconciliation blocks an open ${kind} repair target without changing intent`,()=>{
  caseCoverage();
  db.prepare(`INSERT INTO vocabulary_case_repair_targets(case_id,version,pending_sense_id,accepted_sense_id,accepted_version,updated_at)
    VALUES ('case',1,?,?,?,?)`).run(kind==='pending'?'word:retire':null,kind==='accepted'?'word:retire':null,kind==='accepted'?1:null,at);
  const reviewed=plan(),before=table('vocabulary_case_repair_targets');
  assert.match(reportInventoryRetirements(reviewed.snapshot,['word:retire']).blockers.join('\n'),/Open repair target/);
  assert.throws(()=>apply([reviewed]),/Open repair target/);
  assert.deepEqual(table('vocabulary_case_repair_targets'),before);
  assert.equal(getVocabularySenses('word').find(sense=>sense.senseId==='word:retire')!.status,'active');
  db.prepare("UPDATE vocabulary_case_reviews SET state='resolved',resolved_at=? WHERE case_id='case'").run(at);
  apply([plan()]);
  assert.deepEqual(table('vocabulary_case_repair_targets'),before);
});

test('reconciliation requires fresh dependency snapshots after scope schema cleanup',()=>{
  const snapshot=plan().snapshot;
  snapshot.dependencies.reportVersion=1;
  assert.throws(()=>reportInventoryRetirements(snapshot,['word:retire']),/current dependency snapshot/);
});

test('new pending repair intent invalidates a reviewed reconciliation snapshot',()=>{
  caseCoverage();const reviewed=plan();
  db.prepare("INSERT INTO vocabulary_case_repair_targets(case_id,version,pending_sense_id,updated_at) VALUES ('case',1,'word:retire',?)").run(at);
  assert.throws(()=>apply([reviewed]),/changed|drift|snapshot/i);
  assert.equal(getVocabularySenses('word').find(sense=>sense.senseId==='word:retire')!.status,'active');
});
