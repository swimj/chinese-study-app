import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { after, before, test } from 'node:test';

const envKeys = ['APP_MODE', 'APP_DATA_DIR', 'APP_LEARNER_ID', 'APP_AUTH_MODE', 'APP_OPERATOR_CLERK_USER_IDS'] as const;
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let dir: string;
let server: http.Server;
let base: string;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-quality-api-'));
  Object.assign(process.env, { APP_MODE: 'study', APP_DATA_DIR: dir, APP_LEARNER_ID: 'quality-api', APP_AUTH_MODE: 'trusted_local', APP_OPERATOR_CLERK_USER_IDS: '' });
  const { createApp } = await import('../server/index.ts');
  const { getDb } = await import('../server/db/connection.ts');
  const db = getDb();
  db.exec(`INSERT INTO lexical_words (id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('w','你好','nǐ hǎo','hello','[]','[]',10,'now');
    INSERT INTO shared_content_publications VALUES ('pc','word_content','c','w','available','now','now');
    INSERT INTO shared_content_publications VALUES ('pt','teaching_package','t','w','available','now','now');`);
  const content = { schemaVersion: 1, id: 'c', word: { wordId: 'w', hanzi: '你好', traditional: null, pinyin: 'nǐ hǎo' }, uses: [{id:'u',label:'hello',notes:['Greeting'],exampleIds:['e']}], examples: [{id:'e',text:'你好！',translation:'Hello!',pronunciation:null}] };
  const teaching = {schemaVersion:1,id:'t',wordContentId:'c',beats:[{id:'b',parts:[{kind:'text',text:'Greeting'}]}],rehearsals:[{id:'r',responseMode:'hanzi_entry',contract:{kind:'target_rehearsal',wordId:'w'},instruction:'',stimulus:{kind:'direct_text',text:'Hello'},acceptedAnswers:[{wordId:'w',hanzi:'你好',traditional:null}]}]};
  db.prepare('INSERT INTO word_content_documents VALUES (?,?,?,?,?,?)').run('c','w',JSON.stringify(content),'fixture-model','now','pc');
  db.prepare('INSERT INTO word_teaching_packages VALUES (?,?,?,?,?,?,?)').run('t','w','c',JSON.stringify(teaching),'fixture-model','now','pt');
  server = createApp({ frontendDistPath: null }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); assert(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
const write = (route: string, body: unknown, method = 'POST') => fetch(`${base}/api/content-quality/${route}`, {method, headers: {'Content-Type':'application/json'},body:JSON.stringify(body)});

test('quality endpoints save, restore and clear standing votes without allowing client-selected ownership', async () => {
  const body = { target: {kind:'teaching_package',packageId:'t'}, encounterId:'encounter', learnerId:'forged' };
  let response = await write('encounters', body); assert.equal(response.status, 200);
  const original = await response.json() as {contentKey:string;rating:null}; assert.equal(original.rating,null);
  response = await write('ratings', {contentKey:original.contentKey,rating:'up'}, 'PUT'); assert.equal(response.status,200);
  response = await write('encounters', {...body,encounterId:'another'}); assert.equal((await response.json()).rating,'up');
  assert.equal((await write('ratings', {contentKey:'unseen',rating:'down'},'PUT')).status,400);
  assert.equal((await write('ratings', {contentKey:original.contentKey,rating:'good'},'PUT')).status,400);
  assert.equal((await write('encounters', {target:{kind:'rehearsal',packageId:'t',rehearsalId:'missing'},encounterId:'bad'})).status,400);
  response = await write('ratings', {contentKey:original.contentKey,rating:null},'PUT'); assert.equal((await response.json()).rating,null);
  const { getDb } = await import('../server/db/connection.ts');
  assert.deepEqual(getDb().prepare('SELECT DISTINCT learner_id FROM learner_content_quality_encounters').all().map(row=>row.learner_id),['quality-api']);
});

test('analytics requires operator access, validates filters and omits learner identity', async () => {
  const route = `${base}/api/operator/content-quality`;
  assert.equal((await fetch(route)).status,403);
  process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
  const response = await fetch(`${route}?kind=teaching_package&limit=1`); assert.equal(response.status,200);
  const payload = await response.json(); assert.equal(payload.totalItems,1); assert.equal(payload.totals.exposures,2);
  assert.equal(JSON.stringify(payload).includes('quality-api'),false);
  for (const query of ['kind=wrong','since=2026-02-31','since=2026-10-02&until=2026-10-01','limit=-1','kind=a&kind=b']) {
    assert.equal((await fetch(`${route}?${query}`)).status,400,query);
  }
});

test('date filters select exposures but intentionally report current standing votes', async () => {
  const { getDb } = await import('../server/db/connection.ts');
  const contentKey = String(getDb().prepare('SELECT content_key FROM content_quality_items LIMIT 1').get()!.content_key);
  getDb().prepare(`INSERT INTO learner_content_quality_encounters VALUES (?,?,?,?)`)
    .run('quality-api','historical',contentKey,'2001-02-03T23:59:59.000Z');
  await write('ratings',{contentKey,rating:'down'},'PUT');
  const route = `${base}/api/operator/content-quality?since=2001-02-03&until=2001-02-03`;
  let response = await fetch(route);
  let payload = await response.json();
  assert.equal(payload.totals.exposures,1);
  assert.equal(payload.totals.learnerContentPairs,1);
  assert.equal(payload.totals.down,1);
  await write('ratings',{contentKey,rating:null},'PUT');
  response = await fetch(route);
  payload = await response.json();
  assert.equal(payload.totals.exposures,1);
  assert.equal(payload.totals.ratedLearners,0);
  assert.equal(payload.totals.coverage,0);
});

test('definition fallback API accepts server-owned displayed material and rejects fabricated or malformed targets', async () => {
  const target = { kind: 'definition_fallback', wordId: 'w', expected: { promptText: 'hello', displayedMeanings: [] } };
  const response = await write('encounters', { target, encounterId: 'fallback' });
  assert.equal(response.status, 200);
  const state = await response.json() as { contentKey: string };
  assert.equal((await write('ratings', { contentKey: state.contentKey, rating: 'down' }, 'PUT')).status, 200);
  for (const expected of [null, { promptText: 'fabricated', displayedMeanings: [] },
    { promptText: 'hello', displayedMeanings: [7] }, { promptText: 'hello' }]) {
    assert.equal((await write('encounters', { target: { ...target, expected }, encounterId: 'invalid-fallback' })).status, 400);
  }
  const analytics = await fetch(`${base}/api/operator/content-quality?kind=definition_fallback`);
  assert.equal(analytics.status, 200);
  const payload = await analytics.json();
  assert.equal(payload.totalItems, 1);
  assert.equal(payload.totals.down, 1);
  assert.deepEqual(payload.items[0].content, { wordId: 'w', promptText: 'hello', displayedMeanings: [] });
  const { createImprovementCase } = await import('../server/db/content-improvements.ts');
  assert.throws(() => createImprovementCase({ kind: 'definition_fallback', sourceId: 'w' }, 'trusted_local'), /not supported/);
});
