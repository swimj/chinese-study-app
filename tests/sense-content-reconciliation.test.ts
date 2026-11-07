import { createVocabularyPracticePreparation, type VocabularyPracticeProvider } from '../server/vocabulary/preparation.ts';
import { listVocabularyAttention } from '../server/db/vocabulary-attention.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { enqueueWordPreparation } from '../server/db/preparation-work.ts';
import { claimSharedWordIntroductionStage, finishSharedWordIntroductionBootstrap, finishSharedWordIntroductionTeaching, getSharedWordIntroductionContent } from '../server/db/word-introductions.ts';
import { normalizePracticeRehearsals } from '../server/word-content/authoring.ts';
import { getVocabularySenses, updateVocabularySense, createVocabularyContent, getVocabularyContentForMaintenance } from '../server/db/vocabulary-content.ts';
import { getVocabularyWordSenseCoverage, writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { getSenseContentReconciliationWorkspace, saveSenseContentReconciliation, applySenseContentReconciliation,
  retrySenseContentReconciliation, listSenseContentReconciliationWords } from '../server/db/sense-content-reconciliation.ts';
import { assertSenseContentReconciliationGeneration, senseContentReconciliationGenerationToken, senseContentReconciliationProgress,
  listSenseContentReconciliationPracticeDemand, isSenseContentReconciliationPending } from '../server/db/sense-content-reconciliation-state.ts';
import { createWordPreparationWorker } from '../server/word-content/preparation-worker.ts';
import { createVocabularyPracticeWorker } from '../server/vocabulary/preparation-worker.ts';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';
import type { WordIntroductionProvider } from '../server/word-content/provider.ts';
import type { SenseContentReconciliationDraft, SenseContentReconciliationWorkspace } from '../src/domain/sense-content-reconciliation.ts';
import { snapshotInventoryForReconciliation } from '../server/db/sense-inventory-reconciliation-report.ts';

let root: string, baseline: string, db: DatabaseSync;
let previousAllowlist: string | undefined;
let previousMode: string | undefined;
let previousDataDir: string | undefined;
const actor = { kind: 'operator' as const, id: 'operator' };
before(() => {
  previousAllowlist = process.env.APP_OPERATOR_CLERK_USER_IDS; process.env.APP_OPERATOR_CLERK_USER_IDS = 'operator';
  previousMode = process.env.APP_MODE; process.env.APP_MODE = 'study';
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sense-content-reconciliation-'));
  previousDataDir = process.env.APP_DATA_DIR; process.env.APP_DATA_DIR = root;
  createBaselineFixture(path.join(root, 'baseline')); baseline = path.join(root, 'baseline', 'app.db');
  const template = new DatabaseSync(baseline); template.exec('PRAGMA foreign_keys=ON'); template.function('current_learner_id', () => 'learner'); migrateDatabase(template); template.close();
});
after(() => { if (previousAllowlist === undefined) delete process.env.APP_OPERATOR_CLERK_USER_IDS; else process.env.APP_OPERATOR_CLERK_USER_IDS = previousAllowlist; if (previousMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = previousMode; if (previousDataDir === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previousDataDir; fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  fs.copyFileSync(baseline, path.join(root, 'current.db')); db = new DatabaseSync(path.join(root, 'current.db'));
  db.exec('PRAGMA foreign_keys=ON'); db.function('current_learner_id', () => 'learner'); setDb(db);
  db.exec(`INSERT INTO learners(learner_id,display_name,created_at) VALUES ('learner','Learner','2026-11-06');
    INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('word','挂钩','掛鉤','guà gōu','hook; connect; tie','["hook","connect","tie"]','[]',1,'2026-11-06')`);
  runWithLearnerId('learner', () => enqueueWordPreparation('word', 'teaching'));
  const original: WordContentDocument = { schemaVersion: 1, id: 'source-A', word: { wordId: 'word', hanzi: '挂钩', traditional: '掛鉤', pinyin: 'guà gōu' },
    uses: ['hook', 'connect', 'tie'].map((id, index) => ({ id, label: id, notes: [`Meaning ${id}`], exampleIds: [`e${index}`] })),
    examples: ['hook', 'connect', 'tie'].map((id, index) => ({ id: `e${index}`, text: '奖金与工作表现挂钩。', translation: `Example of ${id}`, pronunciation: null })) };
  publish(original, 'package-A');
  const ids = getVocabularySenses('word').map(sense => sense.senseId);
  writeVocabularyDefaultUsefulSenses('word', 0, ids, actor);
  db.prepare('UPDATE word_introduction_preparation SET content_id=NULL,package_id=NULL WHERE word_id=?').run('word');
  publish({ ...original, id: 'source-B', uses: [...original.uses, { id: 'associate', label: 'Everyday association', notes: ['Link two ideas in judgment'], exampleIds: ['e3'] }],
    examples: [...original.examples, { id: 'e3', text: '别把一次迟到和他的态度挂钩。', translation: 'Do not associate one late arrival with his attitude.', pronunciation: null }] }, 'package-B');
  db.prepare("UPDATE word_preparation_work SET status='ready',source_content_id=CASE WHEN stage='teaching' THEN 'source-B' ELSE NULL END WHERE word_id='word'").run();
});
afterEach(() => { setDb(null); db.close(); });
function publish(content: WordContentDocument, packageId: string): void {
  const now = new Date().toISOString(), expires = new Date(Date.now() + 300_000).toISOString();
  assert.equal(claimSharedWordIntroductionStage('word', 'bootstrap', content.id, now, expires), 'claimed');
  finishSharedWordIntroductionBootstrap('word', content.id, content, 'fixture');
  assert.equal(claimSharedWordIntroductionStage('word', 'teaching', packageId, now, expires), 'claimed');
  finishSharedWordIntroductionTeaching('word', packageId, { schemaVersion: 1, id: packageId, wordContentId: content.id,
    beats: [{ id: 'beat', parts: [{ kind: 'text', text: 'Hook, connect, or tie things together.' }] }],
    rehearsals: normalizePracticeRehearsals({ rehearsals: [{ id: 'practice', stimulus: { kind: 'direct_text', text: 'A hook for hanging a coat.' } }] }, content) }, 'fixture');
}
function draft(): SenseContentReconciliationDraft {
  const state = getSenseContentReconciliationWorkspace('word', actor.id);
  return { defaultSenseIds: state.senses.map(sense => sense.senseId), rationale: 'Keep the three canonical meanings; association is a teaching distinction within tie.', unsupportedChanges: [],
    uses: state.teaching!.uses.map(use => ({ useId: use.id, decision: 'map', senseId: state.senses.find(sense => sense.label === (use.id === 'associate' ? 'tie' : use.id))!.senseId, rationale: 'Equivalent underlying meaning.' })) };
}
function resolved(): SenseContentReconciliationWorkspace { return saveSenseContentReconciliation('word', { expectedVersion: null, status: 'resolved', draft: draft() }, actor.id); }
function resolvedMissing(): SenseContentReconciliationWorkspace {
  const input = draft();
  const missing = input.defaultSenseIds[0]!;
  input.uses.forEach(use => { if (use.senseId === missing) use.senseId = input.defaultSenseIds[1]!; });
  return saveSenseContentReconciliation('word', {expectedVersion:null,status:'resolved',draft:input}, actor.id);
}
function apply(state = resolved()): SenseContentReconciliationWorkspace {
  assert.deepEqual(state.plan!.blockers, []);
  return applySenseContentReconciliation('word', { expectedVersion: state.resolution!.version, planFingerprint: state.plan!.fingerprint }, actor.id);
}
function addRelatedReflectionJob(status: 'failed' | 'queued' | 'running', reviewState: 'open' | 'resolved'): void {
  const at = '2026-11-07T00:00:00.000Z';
  db.prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,status)
    VALUES ('session','learner',1,'{}',?,'closed')`).run(at);
  db.prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,through_sequence,staged_at,close_at,status,input_json,report_json,policy_version,closed_at)
    VALUES ('completion','learner','session',1,0,?,?,'closed','{}','{}','fixture',?)`).run(at,at,at);
  db.prepare(`INSERT INTO vocabulary_reflection_session_evidence(completion_id,learner_id,session_id,projection_json,created_at)
    VALUES ('completion','learner','session','{}',?)`).run(at);
  for (const id of ['root-case','child-case']) db.prepare(`INSERT INTO reflection_cases
    (case_id,completion_id,learner_id,kind,subject_key,word_id,status,evidence_snapshot_json,created_at)
    VALUES (?,'completion','learner','exercise_improvement',?,'word','open','{}',?)`).run(id,id,at);
  db.prepare(`INSERT INTO vocabulary_case_reviews(case_id,state,created_at,resolved_at) VALUES ('root-case',?,?,?)`)
    .run(reviewState,at,reviewState === 'resolved' ? at : null);
  for (const id of ['root-case','child-case']) db.prepare('INSERT INTO vocabulary_case_lineage(member_case_id,case_id) VALUES (?,?)').run(id,'root-case');
  db.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,review_case_id,kind,dedupe_key,status,next_attempt_at,created_at,lease_token,lease_expires_at)
    VALUES ('job','child-case','root-case','exercise_improvement','job',?,?,?,?,?)`)
    .run(status,at,at,status === 'running' ? 'lease' : null,status === 'running' ? '2099-01-01T00:00:00.000Z' : null);
}

test('a failed assessment stops blocking when its review case resolves, without discarding saved decisions or evidence', () => {
  addRelatedReflectionJob('failed','open');
  const saved = resolved();
  assert.ok(saved.plan!.blockers.some(blocker => blocker.message === 'A related assessment failed. Resolve its case before applying.'));
  db.prepare("UPDATE vocabulary_case_reviews SET state='resolved',resolved_at=? WHERE case_id='root-case'").run('2026-11-07T01:00:00.000Z');
  const refreshed = getSenseContentReconciliationWorkspace('word',actor.id);
  assert.deepEqual(refreshed.plan!.blockers,[]);
  assert.equal(refreshed.resolution!.version,saved.resolution!.version);
  apply(refreshed);
  assert.equal(db.prepare("SELECT status FROM vocabulary_reflection_jobs WHERE job_id='job'").get()!.status,'failed');
});

for (const status of ['queued','running'] as const) test(`${status} assessment still blocks even on a resolved case`, () => {
  addRelatedReflectionJob(status,'resolved');
  const state = resolved();
  assert.ok(state.plan!.blockers.some(blocker => blocker.message.includes('assessment is queued or running') && blocker.objectIds.includes('job')));
});
function provider(fail = false): WordIntroductionProvider {
  return { model: 'fixture', isConfigured: () => true, generationKey: async () => 'fixture',
    generateBootstrap: async input => {
      if (fail) throw new Error('Synthetic generation failure');
      return { uses: input.canonicalSenses!.map(sense => ({ id: sense.senseId, exampleIds: ['e1'] })),
        examples: [{ id: 'e1', text: '奖金与表现挂钩。', translation: 'The bonus is tied to performance.', pronunciation: null }] };
    }, generateTeaching: async () => ({ beats: [{ id: 'b1', parts: [{ kind: 'text', text: 'A hook, a connection, or a dependency.' }] }] }),
    generatePractice: async () => ({ rehearsals: [{ id: 'p1', stimulus: { kind: 'direct_text', text: 'A wall hook for a coat.' } }] }),
    generateReview: async () => { throw new Error('No review generation expected'); } };
}
async function prepareTeaching(): Promise<void> {
  const worker = createWordPreparationWorker({ provider: provider(), controls: () => ({ maintenanceMode: false, providerWorkEnabled: true }), providerWork: work => work() });
  await worker.drain(); await worker.stop();
}
test('discover unmapped B and save a blocked linguistic resolution without mutating live content', () => {
  assert.equal(listSenseContentReconciliationWords(actor.id)[0]?.wordId, 'word');
  const senses = getVocabularySenses('word'), content = db.prepare('SELECT * FROM content_items ORDER BY content_id').all();
  const input = draft(); input.unsupportedChanges = ['Add a fourth canonical sense for everyday association'];
  const state = saveSenseContentReconciliation('word', { expectedVersion: null, status: 'resolved', draft: input }, actor.id);
  assert.equal(state.resolution!.status, 'resolved'); assert.ok(state.plan!.blockers.some(blocker => blocker.code === 'unsupported_change'));
  assert.deepEqual(getVocabularySenses('word'), senses); assert.deepEqual(db.prepare('SELECT * FROM content_items ORDER BY content_id').all(), content);
  assert.equal(getSharedWordIntroductionContent('word')?.id, 'source-B');
  assert.equal(db.prepare('SELECT count(*) n FROM sense_content_reconciliation_history').get()!.n, 1);
});
test('stale evidence survives ordinary save; only explicit refresh updates its source', () => {
  const state = resolved(), sense = getVocabularySenses('word')[0]!;
  updateVocabularySense(sense.senseId, sense.version, { description: sense.description, status: 'active' }, actor);
  const saved = saveSenseContentReconciliation('word', { expectedVersion: state.resolution!.version, status: 'resolved', draft: state.resolution!.draft }, actor.id);
  assert.ok(saved.plan!.blockers.some(blocker => blocker.code === 'source_changed'));
  const refreshed = saveSenseContentReconciliation('word', { expectedVersion: saved.resolution!.version, status: 'resolved', draft: saved.resolution!.draft, refreshSource: true }, actor.id);
  assert.ok(!refreshed.plan!.blockers.some(blocker => blocker.code === 'source_changed'));
});
test('opening a reconciliation remains readable while another connection reserves the WAL writer', () => {
  db.exec('PRAGMA journal_mode=WAL');
  const writer=new DatabaseSync(path.join(root,'current.db'));
  writer.exec('BEGIN IMMEDIATE');
  try {
    assert.equal(getSenseContentReconciliationWorkspace('word',actor.id).wordId,'word');
    assert.equal(listSenseContentReconciliationWords(actor.id)[0]?.wordId,'word');
  } finally { writer.exec('ROLLBACK');writer.close(); }
});
test('saving reads dependencies once and preserves compatibility with an offline saved snapshot', t => {
  const input=draft();
  db.exec('BEGIN');
  const legacySnapshot=snapshotInventoryForReconciliation(db,'word');
  db.exec('COMMIT');
  const statements:string[]=[],prepare=db.prepare.bind(db);
  t.mock.method(db,'prepare',(query:string)=>{statements.push(query);return prepare(query);});
  const saved=saveSenseContentReconciliation('word',{expectedVersion:null,status:'resolved',draft:input},actor.id);
  assert.equal(statements.filter(query=>query.startsWith('SELECT id,hanzi,traditional,pinyin,meaning FROM lexical_words')).length,1);
  assert.ok(!statements.some(query=>/\b(vocabulary_sessions|vocabulary_session_completions|learner_pure_cue_schedules)\b/.test(query)), 'Online save must not scan retained learner history');
  db.prepare('UPDATE sense_content_reconciliations SET snapshot_json=? WHERE resolution_id=?').run(JSON.stringify(legacySnapshot),saved.resolution!.resolutionId);
  const reopened=getSenseContentReconciliationWorkspace('word',actor.id);
  assert.deepEqual(reopened.plan,saved.plan);
  assert.deepEqual(reopened.affectedContent,saved.affectedContent);
});
test('apply replaces teaching atomically while preserving canonical identities and retained sources', () => {
  const state = resolved(), senses = getVocabularySenses('word'), token = senseContentReconciliationGenerationToken('word');
  const result = apply(state);
  assert.equal(result.resolution!.status, 'applied'); assert.equal(result.teaching!.contentId, 'source-B');
  assert.deepEqual(getVocabularySenses('word'), senses); assert.equal(getSharedWordIntroductionContent('word'), null);
  assert.equal(db.prepare('SELECT count(*) n FROM word_content_documents').get()!.n, 2);
  assert.equal(isSenseContentReconciliationPending('word'), true);
  assert.throws(() => assertSenseContentReconciliationGeneration('word', token), /Reconciliation changed/);
  const again = applySenseContentReconciliation('word', { expectedVersion: state.resolution!.version, planFingerprint: state.plan!.fingerprint }, actor.id);
  assert.equal(again.resolution!.version, result.resolution!.version);
  assert.equal(db.prepare('SELECT count(*) n FROM sense_content_reconciliation_history').get()!.n, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('injected apply failure rolls back content retirements and resolution effects', () => {
  const state = resolved(), before = db.prepare('SELECT * FROM content_items ORDER BY content_id').all();
  db.exec("CREATE TRIGGER fail_reconciliation BEFORE UPDATE ON word_introduction_preparation BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(() => apply(state), /injected failure/);
  assert.deepEqual(db.prepare('SELECT * FROM content_items ORDER BY content_id').all(), before);
  assert.equal(getSenseContentReconciliationWorkspace('word', actor.id).resolution!.status, 'resolved');
});
test('replacement teaching and repertoire progress through real workers with fake providers', async () => {
  apply(resolvedMissing()); await prepareTeaching();
  assert.equal(senseContentReconciliationProgress('word').teachingStatus, 'ready');
  assert.equal(senseContentReconciliationProgress('word').practiceStatus, 'pending');
  assert.deepEqual(listSenseContentReconciliationPracticeDemand(), ['word']);
  const worker = createVocabularyPracticeWorker({ demand: listSenseContentReconciliationPracticeDemand,
    provider: { model: 'fixture', isConfigured: () => true, generationKey: () => 'fixture', generate: async content => ({ exercises: [{ id: 'general', sourceUseId: content.uses[0]!.id, stimulus: { kind: 'direct_text', text: 'A hook for hanging something.' }, teachingNote: null }] }) },
    controls: () => ({ maintenanceMode: false, providerWorkEnabled: true }), providerWork: work => work() });
  await worker.drain(); await worker.stop();
  assert.equal(senseContentReconciliationProgress('word').status, 'ready'); assert.equal(isSenseContentReconciliationPending('word'), false);
  assert.deepEqual(listSenseContentReconciliationPracticeDemand(), []);
  assert.ok(db.prepare('SELECT completed_at FROM sense_content_reconciliations').get()!.completed_at);
  const coverage = getVocabularyWordSenseCoverage('word');
  writeVocabularyDefaultUsefulSenses('word', coverage.version, coverage.defaultUsefulSenseIds!.slice(0, 1), actor);
  assert.equal(isSenseContentReconciliationPending('word'), false);
  assert.notEqual(getSharedWordIntroductionContent('word')!.id, 'source-B');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('failed replacement is visible and explicitly retryable', async () => {
  apply();
  db.prepare("UPDATE word_preparation_work SET status='paused',last_error='Synthetic failure' WHERE word_id='word' AND stage='bootstrap'").run();
  assert.equal(senseContentReconciliationProgress('word').status, 'failed');
  const retried = retrySenseContentReconciliation('word', actor.id); assert.equal(retried.progress.status, 'pending');
  await prepareTeaching(); assert.equal(senseContentReconciliationProgress('word').teachingStatus, 'ready');
});
test('a new saved cycle never removes the applied authority or reader gate', () => {
  const applied = apply(), token = senseContentReconciliationGenerationToken('word');
  const next = saveSenseContentReconciliation('word', { expectedVersion: applied.resolution!.version, status: 'resolved', draft: applied.resolution!.draft }, actor.id);
  assert.notEqual(next.resolution!.resolutionId, applied.resolution!.resolutionId);
  assert.equal(next.resolution!.version, applied.resolution!.version + 1);
  assert.throws(() => saveSenseContentReconciliation('word', { expectedVersion: 1, status: 'draft', draft: next.resolution!.draft }, actor.id), /Resolution changed/);
  assert.equal(senseContentReconciliationGenerationToken('word'), token);
  assert.equal(isSenseContentReconciliationPending('word'), true);
  assert.equal(db.prepare('SELECT count(*) n FROM sense_content_reconciliations').get()!.n, 2);
});
test('operator authorization is enforced below HTTP', () => {
  assert.throws(() => getSenseContentReconciliationWorkspace('word', 'not-an-operator'), /Operator access/);
  assert.throws(() => listSenseContentReconciliationWords('not-an-operator'), /Operator access/);
});

test('a later linguistic draft does not hide retry of prior failed replacement', () => {
  const applied = apply();
  saveSenseContentReconciliation('word', { expectedVersion: applied.resolution!.version, status: 'draft', draft: applied.resolution!.draft }, actor.id);
  db.prepare("UPDATE word_preparation_work SET status='paused',last_error='Synthetic failure' WHERE word_id='word' AND stage='bootstrap'").run();
  const retried = retrySenseContentReconciliation('word', actor.id);
  assert.equal(retried.resolution!.status, 'draft'); assert.equal(retried.progress.status, 'pending');
});
test('authority drift before replacement can be resolved against retained evidence and applied again', () => {
  const applied = apply();
  const coverage = getVocabularyWordSenseCoverage('word');
  writeVocabularyDefaultUsefulSenses('word', coverage.version, coverage.defaultUsefulSenseIds!.slice(0, 1), actor);
  assert.equal(senseContentReconciliationProgress('word').status, 'failed');
  const next = saveSenseContentReconciliation('word', { expectedVersion: applied.resolution!.version, status: 'resolved', draft: applied.resolution!.draft, refreshSource: true }, actor.id);
  assert.equal(next.teaching!.contentId, 'source-B');
  assert.deepEqual(next.plan!.blockers, []);
  const recovered = apply(next);
  assert.equal(recovered.progress.status, 'pending');
});

test('bootstrap publication checks the reconciliation fence within the write transaction', () => {
  apply();
  const content = JSON.parse(String(db.prepare("SELECT content_json FROM word_content_documents WHERE content_id='source-B'").get()!.content_json)) as WordContentDocument;
  const token = senseContentReconciliationGenerationToken('word');
  const now = new Date().toISOString();
  claimSharedWordIntroductionStage('word', 'bootstrap', 'new-claim', now, new Date(Date.now() + 300_000).toISOString());
  const coverage = getVocabularyWordSenseCoverage('word');
  writeVocabularyDefaultUsefulSenses('word', coverage.version, coverage.defaultUsefulSenseIds!.slice(0, 1), actor);
  assert.throws(() => finishSharedWordIntroductionBootstrap('word', 'new-claim', { ...content, id: 'must-not-publish' }, 'fixture', null, undefined, () => {
    assert.equal(db.isTransaction, true);
    assertSenseContentReconciliationGeneration('word', token);
  }), /authority changed/);
  assert.equal(db.prepare("SELECT 1 FROM word_content_documents WHERE content_id='must-not-publish'").get(), undefined);
});

test('a complete mapping can apply without per-use reasons or an overall rationale', () => {
  const input=draft(); input.rationale=''; input.uses.forEach(use=>{use.rationale='';});
  const state=saveSenseContentReconciliation('word',{expectedVersion:null,status:'resolved',draft:input},actor.id);
  assert.deepEqual(state.plan!.blockers,[]);
  assert.equal(apply(state).resolution!.status,'applied');
});

function repertoireProvider(generate?:VocabularyPracticeProvider['generate']):VocabularyPracticeProvider {
  return {model:'fixture',isConfigured:()=>true,generationKey:()=> 'canonical-fixture',generate:generate??(async source=>({exercises:[{id:'canonical-general',sourceUseId:source.uses[0]!.id,stimulus:{kind:'direct_text',text:'A hook for hanging something.'},teachingNote:null}]}))};
}
test('canonical repertoire publishes before teaching exists and later teaching does not duplicate it', async()=>{
  const input=draft();input.defaultSenseIds=input.defaultSenseIds.slice(0,2);
  input.uses.forEach(use=>{if(use.senseId===input.defaultSenseIds[0])use.senseId=input.defaultSenseIds[1]!;});
  const state=apply(saveSenseContentReconciliation('word',{expectedVersion:null,status:'resolved',draft:input},actor.id));
  assert.equal(getSharedWordIntroductionContent('word'),null);
  assert.deepEqual(listSenseContentReconciliationPracticeDemand(),['word']);
  let calls=0;
  const provider=repertoireProvider(async source=>{
    calls++;
    assert.deepEqual(source.uses.map(use=>use.id).sort(),input.defaultSenseIds.slice().sort());
    assert.equal(source.uses.some(use=>use.id==='associate'),false);
    assert.ok(source.examples.length>0);
    assert.ok(source.uses.every(use=>use.notes[0]===`Meaning ${use.label}`));
    return {exercises:source.uses.map(use=>({id:use.id,sourceUseId:use.id,stimulus:{kind:'direct_text',text:`Recall ${use.label}.`},teachingNote:null}))};
  });
  const worker=createVocabularyPracticeWorker({demand:listSenseContentReconciliationPracticeDemand,provider,controls:()=>({maintenanceMode:false,providerWorkEnabled:true}),providerWork:work=>work()});
  await worker.drain();await worker.stop();
  assert.equal(calls,1);
  assert.equal(senseContentReconciliationProgress('word').practiceStatus,'ready');
  assert.equal(senseContentReconciliationProgress('word').teachingStatus,'pending');
  assert.equal(isSenseContentReconciliationPending('word'),true);
  assert.equal(getSharedWordIntroductionContent('word'),null);
  const work=db.prepare('SELECT * FROM vocabulary_practice_preparation WHERE reconciliation_id=?').get(state.resolution!.resolutionId)!;
  assert.equal(work.source_content_id,null);
  const authored=db.prepare("SELECT body_json FROM content_items WHERE exercise_role='general'").all();
  assert.equal(authored.length,2);
  assert.ok(authored.every(row=>JSON.parse(String(row.body_json)).source.reconciliationId===state.resolution!.resolutionId));
  const bindings=db.prepare("SELECT w.sense_id,s.version FROM content_words w JOIN content_items c USING(content_id) JOIN senses s USING(sense_id) WHERE c.exercise_role='general'").all();
  const snapshot=JSON.parse(String(db.prepare('SELECT practice_source_json FROM sense_content_reconciliations WHERE resolution_id=?').get(state.resolution!.resolutionId)!.practice_source_json));
  assert.ok(bindings.every(row=>snapshot.senses.some((sense:{sense_id:string;imported_sense_version:number})=>sense.sense_id===row.sense_id&&sense.imported_sense_version===row.version)));
  await prepareTeaching();
  assert.equal(senseContentReconciliationProgress('word').status,'ready');
  assert.ok(db.prepare('SELECT completed_at FROM sense_content_reconciliations').get()!.completed_at);
  assert.equal(listVocabularyAttention(actor.id,{}, {approvals:[],preparation:createVocabularyPracticePreparation({provider})}).total,0);
  const restarted=createVocabularyPracticePreparation({provider});
  assert.equal(restarted.ensure('word')!.workId,work.work_id);
  await restarted.prepare('word');assert.equal(calls,1);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_practice_preparation').get()!.n,1);
  const coverage=getVocabularyWordSenseCoverage('word');
  writeVocabularyDefaultUsefulSenses('word',coverage.version,input.defaultSenseIds.slice(0,1),actor);
  assert.equal(isSenseContentReconciliationPending('word'),false);
  assert.equal(restarted.ensure('word')!.reconciliationId,null);
});
test('canonical failure groups with resolution and retries without a teaching pointer',async()=>{
  const state=apply(resolvedMissing());let calls=0;
  const preparation=createVocabularyPracticePreparation({provider:repertoireProvider(async()=>{calls++;return {exercises:[]};})});
  const work=preparation.ensure('word')!;
  await assert.rejects(()=>preparation.run(work.workId,preparation.claim(work.workId)!),/no exercises/);
  assert.equal(senseContentReconciliationProgress('word').practiceStatus,'failed');
  const attention=listVocabularyAttention(actor.id,{}, {approvals:[],preparation});
  assert.equal(attention.total,1);
  const group=attention.items[0]!;assert.equal(group.kind,'reconciliation');
  if(group.kind!=='reconciliation')throw new Error('Missing reconciliation');
  assert.ok(group.children.some(child=>child.reconciliationId===state.resolution!.resolutionId&&child.sourceContentId===null));
  retrySenseContentReconciliation('word',actor.id);
  const restarted=createVocabularyPracticePreparation({provider:repertoireProvider()});
  await restarted.prepare('word');
  assert.equal(senseContentReconciliationProgress('word').practiceStatus,'ready');
  assert.equal(getSharedWordIntroductionContent('word'),null);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_preparation_attempts WHERE work_id=?').get(work.workId)!.n,2);
  assert.equal(calls,1);
});
test('canonical publication rejects changed defaults and stale retry without publishing content',async()=>{
  apply(resolvedMissing());
  const preparation=createVocabularyPracticePreparation({provider:repertoireProvider(async source=>{
    const coverage=getVocabularyWordSenseCoverage('word');
    writeVocabularyDefaultUsefulSenses('word',coverage.version,coverage.defaultUsefulSenseIds!.slice(0,1),actor);
    return {exercises:[{id:'stale',sourceUseId:source.uses[0]!.id,stimulus:{kind:'direct_text',text:'Recall this word.'},teachingNote:null}]};
  })});
  const work=preparation.ensure('word')!;
  await assert.rejects(()=>preparation.run(work.workId,preparation.claim(work.workId)!));
  assert.equal(db.prepare("SELECT count(*) n FROM content_items WHERE exercise_role='general'").get()!.n,0);
  assert.equal(preparation.failed(work.workId).lastError,'reconciliation_authority_changed');
  assert.equal(preparation.failed(work.workId).retryable,false);
  assert.throws(()=>retrySenseContentReconciliation('word',actor.id),/authority changed/);
});

test('an applied reconciliation cannot silently fall back to teaching when its canonical snapshot is missing',()=>{
  apply();db.exec('UPDATE sense_content_reconciliations SET practice_source_json=NULL');
  assert.throws(()=>senseContentReconciliationProgress('word'),/missing its canonical practice snapshot/);
  assert.throws(()=>createVocabularyPracticePreparation({provider:repertoireProvider()}).ensure('word'),/missing its canonical practice snapshot/);
});

function seedRepertoire(ambiguous = false, privateContent = false): string {
  const input = draft();
  for (const use of input.uses) db.prepare('INSERT INTO legacy_sense_imports(source_content_id,source_use_id,sense_id,imported_sense_version) VALUES (?,?,?,1)').run('source-B',use.useId,ambiguous && use.useId === 'connect' ? input.uses.find(item => item.useId === 'hook')!.senseId : use.senseId);
  const senseId = input.uses.find(use => use.useId === 'hook')!.senseId!;
  createVocabularyContent({contentId:'retained-general',kind:'exercise',payloadVersion:1,
    body:{prompt:'Recall a hook.',source:{kind:'general_exercises',bootstrapContentId:'source-B',localId:'general'}},
    exerciseType:'definition_gloss',skill:'production',exerciseRole:'general',assessment:{responseMode:'hanzi_entry',matchingProfile:'mandarin'},
    accessScope:privateContent?'private':'shared',ownerLearnerId:privateContent?'learner':null,availability:'active',originKind:'model',authorKind:'service',authorId:'fixture',
    words:[{wordId:'word',relation:'target',senseId,senseMappingEstablishedAt:new Date().toISOString()}],
    answers:[{wordId:'word',acceptedForms:['挂钩']}]},actor);
  return senseId;
}
test('covered selection preserves repertoire and skips generation through teaching completion and restart',async()=>{
  seedRepertoire();
  const before = getVocabularyContentForMaintenance('retained-general');
  const coverage = getVocabularyWordSenseCoverage('word');
  const state = resolved();
  assert.equal(state.plan!.replacementPracticeRequired,false);
  assert.ok(state.plan!.retainedContentIds.includes('retained-general'));
  assert.ok(state.plan!.retireContentIds.length>0);
  apply(state);
  assert.deepEqual(getVocabularyWordSenseCoverage('word'),coverage);
  assert.deepEqual(getVocabularyContentForMaintenance('retained-general'),before);
  assert.equal(senseContentReconciliationProgress('word').practiceStatus,'not_required');
  assert.equal(isSenseContentReconciliationPending('word'),true);
  assert.deepEqual(listSenseContentReconciliationPracticeDemand(),[]);
  let calls=0;
  const preparation=createVocabularyPracticePreparation({provider:repertoireProvider(async()=>{calls++;throw new Error('Unexpected repertoire generation');})});
  assert.equal(preparation.ensure('word'),null);
  await prepareTeaching();
  assert.equal(senseContentReconciliationProgress('word').status,'ready');
  assert.ok(db.prepare('SELECT completed_at FROM sense_content_reconciliations').get()!.completed_at);
  await preparation.prepare('word');
  assert.equal(createVocabularyPracticePreparation({provider:repertoireProvider()}).ensure('word'),null);
  assert.equal(calls,0);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_practice_preparation WHERE reconciliation_id IS NOT NULL').get()!.n,0);
  assert.equal(getVocabularyContentForMaintenance('retained-general')!.availability,'active');
});
test('covered many-to-one mapping carries repertoire forward with an audited canonical binding',()=>{
  const oldSense = seedRepertoire(), input=draft();
  const target = input.uses.find(use=>use.useId==='tie')!.senseId!;
  input.defaultSenseIds=[target];
  input.uses.forEach(use=>{use.senseId=target;});
  const state=saveSenseContentReconciliation('word',{expectedVersion:null,status:'resolved',draft:input},actor.id);
  assert.equal(state.plan!.replacementPracticeRequired,false);
  assert.deepEqual(state.plan!.repertoireMappings,[{contentId:'retained-general',fromSenseId:oldSense,toSenseId:target}]);
  const before=getVocabularyContentForMaintenance('retained-general')!;
  apply(state);
  const after=getVocabularyContentForMaintenance('retained-general')!;
  assert.equal(after.words[0]!.senseId,target);
  assert.equal(after.version,before.version);
  assert.deepEqual(after.body,before.body);
  assert.equal(db.prepare("SELECT sense_id FROM legacy_sense_imports WHERE source_content_id='source-B' AND source_use_id='hook'").get()!.sense_id,oldSense);
});
test('one uncovered selected sense requires full generation and source-dependent repertoire retirement',()=>{
  seedRepertoire();
  const state=resolvedMissing();
  assert.equal(state.plan!.replacementPracticeRequired,true);
  assert.ok(state.plan!.retireContentIds.includes('retained-general'));
  apply(state);
  assert.equal(senseContentReconciliationProgress('word').practiceStatus,'pending');
  assert.deepEqual(listSenseContentReconciliationPracticeDemand(),['word']);
});
test('ambiguous teaching-use attribution is saved but blocks retaining repertoire',()=>{
  seedRepertoire(true);const input=draft();
  const state=saveSenseContentReconciliation('word',{expectedVersion:null,status:'resolved',draft:input},actor.id);
  assert.equal(state.plan!.replacementPracticeRequired,false);
  assert.ok(state.plan!.blockers.some(blocker=>blocker.code==='repertoire_mapping_handler'));
  assert.throws(()=>apply(state));
});

test('private repertoire remapping is blocked by the shared reconciliation handler',()=>{
  seedRepertoire(false,true);
  const input=draft(),target=input.uses.find(use=>use.useId==='tie')!.senseId!;
  input.defaultSenseIds=[target];input.uses.forEach(use=>{use.senseId=target;});
  const state=saveSenseContentReconciliation('word',{expectedVersion:null,status:'resolved',draft:input},actor.id);
  assert.ok(state.plan!.blockers.some(blocker=>blocker.code==='private_content_handler'));
});
test('covered reconciliation still retires the complete teaching flow',()=>{
  seedRepertoire();
  const state=resolved();
  const teaching=db.prepare("SELECT content_id FROM content_items WHERE kind='introduction' OR exercise_role='teaching'").all();
  assert.equal(state.plan!.replacementPracticeRequired,false);
  assert.ok(teaching.length>0);
  assert.ok(teaching.every(row=>state.plan!.retireContentIds.includes(String(row.content_id))));
  assert.ok(state.plan!.retainedContentIds.includes('retained-general'));
});

test('an already-applied generation plan keeps its recorded policy despite complete teaching coverage',()=>{
  const state=apply();
  const oldPlan={...state.plan!,replacementPracticeRequired:true};
  delete oldPlan.repertoireMappings;
  db.prepare('UPDATE sense_content_reconciliations SET applied_plan_json=? WHERE resolution_id=?').run(JSON.stringify(oldPlan),state.resolution!.resolutionId);
  assert.equal(getSenseContentReconciliationWorkspace('word',actor.id).plan!.replacementPracticeRequired,true);
  assert.equal(senseContentReconciliationProgress('word').practiceStatus,'pending');
  assert.deepEqual(listSenseContentReconciliationPracticeDemand(),['word']);
  assert.equal(createVocabularyPracticePreparation({provider:repertoireProvider()}).ensure('word')!.reconciliationId,state.resolution!.resolutionId);
});
