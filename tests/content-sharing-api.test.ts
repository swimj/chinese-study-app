import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { after, before, test } from 'node:test';

const envKeys = ['APP_MODE','APP_DATA_DIR','APP_LEARNER_ID','APP_AUTH_MODE','APP_OPERATOR_CLERK_USER_IDS'] as const;
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let dir: string;
let server: http.Server;
let base: string;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(),'content-sharing-api-'));
  Object.assign(process.env,{APP_MODE:'study',APP_DATA_DIR:dir,APP_LEARNER_ID:'private-identity',APP_AUTH_MODE:'trusted_local',APP_OPERATOR_CLERK_USER_IDS:''});
  const {createApp} = await import('../server/index.ts');
  server = createApp({frontendDistPath:null}).listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject) => {server.once('listening',resolve);server.once('error',reject);});
  const address = server.address(); assert(address && typeof address === 'object'); base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  const {closeDbConnection} = await import('../server/db/connection.ts'); closeDbConnection();
  for (const key of envKeys) {if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];}
  if(dir) fs.rmSync(dir,{recursive:true,force:true});
});

test('operator report uses migrated schema, requires allowlist, validates date, and omits learner data',async () => {
  const route = `${base}/api/operator/content-sharing`;
  assert.equal((await fetch(route)).status,403);
  process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
  const response = await fetch(route); assert.equal(response.status,200);
  const payload = await response.json();
  assert.deepEqual(payload.newlyReused,{introductions:0,rehearsals:0,reviewCues:0});
  assert.equal(JSON.stringify(payload).includes('private-identity'),false);
  assert.equal((await fetch(`${route}?weekStart=2026-09-28`)).status,200);
  for(const query of ['weekStart=invalid','weekStart=2026-02-30','weekStart=2026-10-06','weekStart=9999-01-04','weekStart=2026-09-28&weekStart=2026-10-05','weekStart[x]=2026-10-05']) {
    assert.equal((await fetch(`${route}?${query}`)).status,400,query);
  }
});

test('real immutable published package and exact rehearsal reuse appear without private identities', async () => {
  const {getDb} = await import('../server/db/connection.ts');
  const {runWithLearnerId} = await import('../server/db/learner-context.ts');
  const {recordContentQualityEncounter} = await import('../server/db/content-quality.ts');
  const {currentSharingWeek} = await import('../server/db/content-sharing.ts');
  const db = getDb();
  const first = '2020-01-01T00:00:00.000Z';
  const second = `${currentSharingWeek(new Date())}T00:00:00.000Z`;
  db.exec(`INSERT INTO learners (learner_id,display_name,created_at) VALUES ('second-identity','Second','2020-01-01');
    INSERT INTO lexical_words (id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('w','滞后','zhì hòu','lag behind','[]','[]',10,'2020-01-01');
    INSERT INTO shared_content_publications VALUES ('pc','word_content','c','w','available','2020-01-01','2020-01-01');
    INSERT INTO shared_content_publications VALUES ('pt','teaching_package','t','w','available','2020-01-01','2020-01-01');`);
  const content = {schemaVersion:1,id:'c',word:{wordId:'w',hanzi:'滞后',traditional:null,pinyin:'zhì hòu'},uses:[{id:'u',label:'lag behind',notes:['Delay'],exampleIds:['e']}],examples:[{id:'e',text:'项目滞后了。',translation:'The project fell behind.',pronunciation:null}]};
  const teaching = {schemaVersion:1,id:'t',wordContentId:'c',beats:[{id:'b',parts:[{kind:'text',text:'Lagging behind'}]}],rehearsals:[{id:'r',responseMode:'hanzi_entry',contract:{kind:'target_rehearsal',wordId:'w'},instruction:'',stimulus:{kind:'direct_text',text:'Lag behind'},acceptedAnswers:[{wordId:'w',hanzi:'滞后',traditional:null}]}]};
  db.prepare('INSERT INTO word_content_documents VALUES (?,?,?,?,?,?)').run('c','w',JSON.stringify(content),'fixture-model',first,'pc');
  db.prepare('INSERT INTO word_teaching_packages VALUES (?,?,?,?,?,?,?)').run('t','w','c',JSON.stringify(teaching),'fixture-model',first,'pt');
  for (const [learner,time] of [['private-identity',first],['second-identity',second]]) {
    runWithLearnerId(learner,() => {
      db.prepare('INSERT INTO learner_word_introduction_events(event_id,learner_id,word_id,package_id,event_kind,occurred_at) VALUES (?,?,?,?,?,?)').run(`open-${learner}`,learner,'w','t','opened',time);
      recordContentQualityEncounter({kind:'rehearsal',packageId:'t',rehearsalId:'r'},`enc-${learner}`);
    });
  }
  const response = await fetch(`${base}/api/operator/content-sharing`);
  assert.equal(response.status,200);
  const report = await response.json();
  assert.equal(report.newlyReused.introductions,1); assert.equal(report.newlyReused.rehearsals,1);
  assert.equal(report.examples.find((example: {kind:string}) => example.kind === 'introduction').word.hanzi,'滞后');
  assert.equal(JSON.stringify(report).includes('private-identity'),false); assert.equal(JSON.stringify(report).includes('second-identity'),false);
});
