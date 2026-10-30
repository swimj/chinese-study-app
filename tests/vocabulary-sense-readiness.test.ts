import { getVocabularyWordSenseCoverage,resolveVocabularySenseCoverage } from '../server/db/vocabulary-sense-coverage.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after,afterEach,before,beforeEach,test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { saveWordContentDocument } from '../server/db/word-introductions.ts';
import { createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog,getVocabularySenses } from '../server/db/vocabulary-content.ts';
import { installModelInvocationLedger } from '../server/llm/invocation-ledger.ts';
import { createOpenAiCompatibleAdapter } from '../server/llm/openai-compatible.ts';
import { createVocabularySenseProvider,ensureVocabularySenses,ensureVocabularySensesFromBootstrap,canEnsureVocabularySensesFromBootstrap,
  retryVocabularySenseReadiness,VocabularySenseReadinessPending,VOCABULARY_SENSE_SERVICE,type VocabularySenseProvider } from '../server/vocabulary/sense-readiness.ts';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';

let root: string; let baseline: string; let db: DatabaseSync;
let oldEnv: Record<string,string|undefined>;
const actor = { kind: 'operator' as const,id: 'operator' };
const inventory = { senses: [{ label: 'enlarge',defaultUseful:true,notes: ['Make an image or object larger.'] },{ label: 'amplify',defaultUseful:false,notes: ['Increase a signal or sound.'] }] };
const fixture: WordContentDocument = { schemaVersion: 1,id: 'bootstrap',word: { wordId: 'w1',hanzi: '放大',traditional: null,pinyin: 'fàng dà' },
  uses: [{ id: 'u1',label: 'enlarge',notes: ['Make something larger.'],exampleIds: ['e1'] }],
  examples: [{ id: 'e1',text: '放大照片',translation: 'Enlarge the photo.',pronunciation: null }] };
before(() => {
  oldEnv = Object.fromEntries(['APP_MODE','APP_AUTH_MODE','APP_DATA_DIR','APP_OPERATOR_CLERK_USER_IDS'].map(key=>[key,process.env[key]]));
  Object.assign(process.env,{APP_MODE:'study',APP_AUTH_MODE:'clerk',APP_DATA_DIR:'/tmp/vocabulary-senses-test',APP_OPERATOR_CLERK_USER_IDS:'operator'});
  root = fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-senses-'));
  const directory = path.join(root,'baseline'); createBaselineFixture(directory); baseline = path.join(directory,'app.db');
  installModelInvocationLedger();
});
after(() => { fs.rmSync(root,{ recursive: true,force: true });
  for (const [key,value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key]=value; }
});
beforeEach(() => {
  const file = path.join(root,`${Math.random()}.db`); fs.copyFileSync(baseline,file); db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON');db.function('current_learner_id',() => 'a');migrateDatabase(db);setDb(db);
  db.prepare("INSERT INTO learners(learner_id,display_name,created_at) VALUES ('a','A',?)").run(new Date().toISOString());
  db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('w1','放大',NULL,'fàng dà','enlarge; amplify','["enlarge","amplify"]','[]',1,?)`).run(new Date().toISOString());
});
afterEach(() => db.close());
function bootstrap(): void {
  runWithLearnerId('a',() => saveWordContentDocument(fixture,'legacy-model'));
  db.prepare("INSERT INTO word_introduction_preparation(word_id,content_id) VALUES ('w1','bootstrap')").run();
}

test('legacy bootstrap alone is not canonical readiness and ordinary inspection does not write',()=>{
  assert.equal(canEnsureVocabularySensesFromBootstrap('w1'),false);bootstrap();
  const before=db.prepare('SELECT total_changes() AS n').get()!.n;
  assert.equal(canEnsureVocabularySensesFromBootstrap('w1'),false);
  assert.equal(ensureVocabularySensesFromBootstrap('w1'),null);
  assert.equal(getVocabularySenses('w1').length,0);
  assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,before);
});
function provider(run: () => unknown | Promise<unknown> = () => inventory): VocabularySenseProvider {
  return { isConfigured: () => true,generate: async () => run() };
}
function response(value: unknown): Response {
  return new Response(JSON.stringify({ id: 'response',model: 'resolved',choices: [{ message: { content: JSON.stringify(value) },finish_reason: 'stop' }],
    usage: { prompt_tokens: 10,completion_tokens: 10,total_tokens: 20 } }),{ status: 200,headers: { 'content-type': 'application/json' } });
}

test('established inventory is reused without provider calls or bootstrap reads, including a disabled publisher',async () => {
  const sense = createVocabularySense({ wordId:'w1',description:{ label:'enlarge' } },actor);
  establishVocabularySenseCatalog('w1',getVocabularySenseCatalog('w1').version,actor);
  const before = getVocabularySenseCatalog('w1');
  const result = await ensureVocabularySenses('w1',{ workflowId:'test',provider:provider(() => assert.fail('unexpected call')),canPublish:()=>false });
  assert.equal(result.source,'existing');assert.deepEqual(result.catalog,before);assert.deepEqual(result.senses,[sense]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vocabulary_sense_readiness').get()!.n,0);
});

test('legacy rich source without canonical inventory requires explicit operator cutover',async()=>{
  bootstrap();await assert.rejects(ensureVocabularySenses('w1',{workflowId:'legacy',provider:provider(()=>assert.fail('No regeneration'))}),/operator review/);
  assert.equal(getVocabularySenses('w1').length,0);
  assert.equal(getVocabularyWordSenseCoverage('w1').defaultUsefulSenseIds,null);
});

test('lexical-only generation records exact invocation provenance and sense outputs, then reuses them',async () => {
  let calls=0;let sent:Record<string,unknown>={};
  const adapter = createOpenAiCompatibleAdapter({ id:'openai',defaultBaseUrl:'https://api.openai.com/v1',apiKeyEnvironmentVariable:'OPENAI_API_KEY',
    structuredOutputMode:'json_schema',maxTokensField:'max_completion_tokens',fetchImplementation:(async (_url,init) => {
      calls++;sent=JSON.parse(String(init?.body));return response(inventory);
    }) as typeof fetch });
  const instance = createVocabularySenseProvider({ environment:{ OPENAI_API_KEY:'test-key' },adapter });
  const result = await ensureVocabularySenses('w1',{ workflowId:'workflow',attemptNumber:2,provider:instance });
  assert.equal(result.source,'generated');assert.equal(result.senses.length,2);
  assert.deepEqual(resolveVocabularySenseCoverage('w1').includedSenseIds,[result.senses.find(sense=>(sense.description as {label:string}).label==='enlarge')!.senseId]);
  assert.equal(getVocabularySenses('w1').length,2);
  await ensureVocabularySenses('w1',{ workflowId:'next',provider:instance });assert.equal(calls,1);
  const invocation = db.prepare('SELECT * FROM model_invocations WHERE actor_id=?').get(VOCABULARY_SENSE_SERVICE)!;
  assert.equal(invocation.model,'gpt-5.6-luna');assert.equal(invocation.workflow_id,'workflow');assert.equal(invocation.attempt_number,1);
  assert.equal(invocation.prompt_name,'vocabulary-sense-inventory');assert.equal(invocation.prompt_version,'2');
  const selectionHistory=db.prepare("SELECT snapshot_json FROM vocabulary_sense_coverage_history WHERE scope='word' AND subject_id='w1'").get()!;
  const selectionEvent=db.prepare("SELECT data_json FROM backend_events WHERE name='vocabulary.sense_coverage.updated' AND entity_id='w1'").get()!;
  const reason={invocationId:invocation.id,workflowId:'workflow',attemptNumber:1,senseIds:resolveVocabularySenseCoverage('w1').includedSenseIds};
  assert.deepEqual(JSON.parse(String(selectionHistory.snapshot_json)).reason,reason);
  assert.deepEqual(JSON.parse(String(selectionEvent.data_json)).reason,reason);
  assert.throws(()=>db.exec("UPDATE vocabulary_sense_coverage_history SET snapshot_json='{}'"),/immutable/);
  assert.ok(invocation.prompt_template);assert.ok(invocation.request_snapshot_json);assert.ok(invocation.response_snapshot_json);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM invocation_sense_links WHERE role='output'").get()!.n,2);
  assert.equal(sent.reasoning_effort,'high');
  const messages=sent.messages as Array<{content:string}>;assert.deepEqual(Object.keys(JSON.parse(messages[1]!.content)),['word']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM content_items').get()!.n,0);
  assert.equal(db.prepare('SELECT status FROM vocabulary_sense_readiness').get()!.status,'ready');
});

test('concurrent calls do not duplicate generation; catalog changes fence the pending result',async () => {
  let resolve!: (value:unknown)=>void;let calls=0;
  const instance=provider(() => { calls++;return new Promise(done=>{resolve=done;}); });
  const running=ensureVocabularySenses('w1',{workflowId:'one',provider:instance});
  await assert.rejects(ensureVocabularySenses('w1',{workflowId:'two',provider:instance}),/running or waiting/);
  createVocabularySense({wordId:'w1',description:{label:'operator sense'}},actor);
  resolve(inventory);await assert.rejects(running,VocabularySenseReadinessPending);
  assert.equal(calls,1);assert.equal(getVocabularySenses('w1').length,1);
  assert.equal(db.prepare('SELECT status FROM vocabulary_sense_readiness').get()!.status,'queued');
});

test('maintenance defers beginning and publication without requiring operator retry',async () => {
  let allowed=false;let calls=0;let now='2026-10-29T00:00:00.000Z';
  const instance=provider(()=>{calls++;allowed=false;return inventory;});
  await assert.rejects(ensureVocabularySenses('w1',{workflowId:'blocked',provider:instance,canPublish:()=>allowed,now:()=>now}),VocabularySenseReadinessPending);
  assert.equal(calls,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vocabulary_sense_readiness').get()!.n,0);
  allowed=true;
  await assert.rejects(ensureVocabularySenses('w1',{workflowId:'running',provider:instance,canPublish:()=>allowed,now:()=>now}),VocabularySenseReadinessPending);
  assert.equal(getVocabularySenses('w1').length,0);
  assert.equal(db.prepare('SELECT status FROM vocabulary_sense_readiness').get()!.status,'queued');
  now='2026-10-29T00:00:30.000Z';allowed=true;
  const ready=await ensureVocabularySenses('w1',{workflowId:'retried',provider:provider(),now:()=>now});assert.equal(ready.senses.length,2);
});

test('interrupted expired sense work is fenced and scheduled after backoff',async () => {
  const now='2026-10-19T12:00:00.000Z';
  db.prepare(`INSERT INTO vocabulary_sense_readiness(word_id,status,attempt_count,active_token,expires_at,expected_catalog_version,workflow_id,created_at,updated_at)
    VALUES ('w1','running',1,'old','2026-10-19T11:00:00.000Z',0,'old',?,?)`).run(now,now);
  await assert.rejects(ensureVocabularySenses('w1',{workflowId:'new',now:()=>now,provider:provider(()=>assert.fail('must not retry'))}),VocabularySenseReadinessPending);
  assert.equal(db.prepare('SELECT status,last_error FROM vocabulary_sense_readiness').get()!.status,'queued');
  assert.equal(db.prepare('SELECT last_error FROM vocabulary_sense_readiness').get()!.last_error,'interrupted_unknown_outcome');
});

test('invalid, unbounded or duplicate inventories never establish a catalog',async () => {
  for (const output of [{senses:[]},{senses:Array.from({length:17},(_,i)=>({label:String(i),notes:[]}))},
    {senses:[{label:'same',notes:[]},{label:' SAME ',notes:[]}]},{senses:[{label:' ',notes:[]}]},
    {senses:[{label:'x'.repeat(601),notes:[]}]}]) {
    await assert.rejects(ensureVocabularySenses('w1',{workflowId:'bad',provider:provider(()=>output)}),VocabularySenseReadinessPending);
    assert.equal(getVocabularySenseCatalog('w1').establishedAt,null);
    // Distinct fixtures represent separate bad first attempts, not automatic retry behavior.
    db.prepare('DELETE FROM vocabulary_sense_readiness').run();
    db.prepare('DELETE FROM vocabulary_preparation_attempts').run();
  }
});

test('empty established and partial unestablished inventories are surfaced for review, never silently overwritten',async () => {
  createVocabularySense({wordId:'w1',description:{label:'partial'}},actor);
  await assert.rejects(ensureVocabularySenses('w1',{workflowId:'partial',provider:provider(()=>assert.fail('no call'))}),/Partial sense inventory/);
  bootstrap();
  assert.throws(()=>ensureVocabularySensesFromBootstrap('w1'),/Partial sense inventory/);
  assert.equal(getVocabularySenses('w1').length,1);
  establishVocabularySenseCatalog('w1',getVocabularySenseCatalog('w1').version,actor);
  // Retiring the only sense is an explicit editorial operation; readiness must not reverse it.
  const {updateVocabularySense}=await import('../server/db/vocabulary-content.ts');
  const sense=getVocabularySenses('w1')[0]!;updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'retired'},actor);
  await assert.rejects(ensureVocabularySenses('w1',{workflowId:'empty',provider:provider(()=>assert.fail('no call'))}),/no active senses/);
});


test('sense retries have durable 30/60 second delays and retain lifetime history after operator restart',async()=>{
  let now=Date.now(),calls=0;
  const instance=provider(()=>{calls++;throw new Error('provider down');});
  const options={workflowId:'same-dependent-job',provider:instance,now:()=>new Date(now).toISOString()};
  await assert.rejects(ensureVocabularySenses('w1',options),VocabularySenseReadinessPending);
  now+=29_999;await assert.rejects(ensureVocabularySenses('w1',options),VocabularySenseReadinessPending);assert.equal(calls,1);
  now++;await assert.rejects(ensureVocabularySenses('w1',options),VocabularySenseReadinessPending);assert.equal(calls,2);
  now+=59_999;await assert.rejects(ensureVocabularySenses('w1',options),VocabularySenseReadinessPending);assert.equal(calls,2);
  now++;await assert.rejects(ensureVocabularySenses('w1',options),/generation failed/);assert.equal(calls,3);
  now+=600_000;await assert.rejects(ensureVocabularySenses('w1',options),/explicit operator retry/);assert.equal(calls,3);
  retryVocabularySenseReadiness('w1','operator');
  const ready=await ensureVocabularySenses('w1',{...options,provider:provider()});assert.equal(ready.source,'generated');
  const attempts=db.prepare("SELECT attempt_number,cycle_attempt,outcome FROM vocabulary_preparation_attempts ORDER BY attempt_number").all();
  assert.deepEqual(attempts.map(row=>[row.attempt_number,row.cycle_attempt,row.outcome]),[[1,1,'failed'],[2,2,'failed'],[3,3,'failed'],[4,1,'ready']]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
