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
import { getVocabularySenses, updateVocabularySense } from '../server/db/vocabulary-content.ts';
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
function apply(state = resolved()): SenseContentReconciliationWorkspace {
  assert.deepEqual(state.plan!.blockers, []);
  return applySenseContentReconciliation('word', { expectedVersion: state.resolution!.version, planFingerprint: state.plan!.fingerprint }, actor.id);
}
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
  apply(); await prepareTeaching();
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
