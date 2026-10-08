import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { after, before, test } from 'node:test';
import type { ImprovementCase, ImprovementCheck } from '../src/domain/content-improvement.ts';

let dir: string, server: http.Server, base: string;
let db: ReturnType<typeof import('../server/db/connection.ts')['getDb']>;
let api: typeof import('../server/db/content-improvements.ts');
let appDb: typeof import('../server/db.ts');
const keys = ['APP_MODE','APP_DATA_DIR','APP_LEARNER_ID','APP_AUTH_MODE','APP_OPERATOR_CLERK_USER_IDS'] as const;
const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(),'content-improvement-'));
  Object.assign(process.env,{APP_MODE:'study',APP_DATA_DIR:dir,APP_LEARNER_ID:'editor',APP_AUTH_MODE:'trusted_local',APP_OPERATOR_CLERK_USER_IDS:'editor'});
  const {createApp} = await import('../server/index.ts');
  db = (await import('../server/db/connection.ts')).getDb();
  api = await import('../server/db/content-improvements.ts');
  appDb = await import('../server/db.ts');
  for (const [id,hanzi] of [['w1','考查'],['w2','考察']]) {
    db.prepare(`INSERT INTO lexical_words (id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES (?,?,?,'inspect','[]','[]',10,'now')`).run(id,hanzi,'kǎochá');
  }
  db.exec(`INSERT INTO scoped_contrast_clusters VALUES ('cluster','Contrast','', 'learner','editor');
    INSERT INTO scoped_contrast_cluster_members VALUES ('cluster','w1','',1),('cluster','w2','',2);`);
  server = createApp({frontendDistPath:null}).listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject) => {server.once('listening',resolve);server.once('error',reject);});
  const address = server.address(); assert(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/operator/content-improvements`;
});
after(async () => {
  if(server?.listening) await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  for(const key of keys) {if(previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];}
  if(dir) fs.rmSync(dir,{recursive:true,force:true});
});
function prompt(id:string) {
  db.prepare('INSERT INTO scoped_contrast_prompts VALUES (?,?,?,?,?)').run(id,'cluster','w1','老师要____学生。','Testing knowledge.');
}
async function request(route:string,body?:unknown,method=body === undefined ? 'GET' : 'POST') {
  return fetch(`${base}${route}`,{method,headers:{'Content-Type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)})});
}
function revised(item:ImprovementCase) {
  return {expectedRevision:item.revision,diagnosis:'The context does not specify what is being tested.',rationale:'The revision supplies a natural object and clearer distinction.',generalLesson:'Prefer meaningful context over a definition disguised as a cloze.',proposalOrigin:'agent',proposed:{...item.proposed,promptText:'老师要____学生对课文的理解。'}};
}

test('operator authorization protects reads, drafts, application and direct domain calls', async () => {
  process.env.APP_OPERATOR_CLERK_USER_IDS = '';
  for(const [route,body,method] of [['',undefined,'GET'],['',{kind:'contrast_prompt',sourceId:'p'},'POST'],['/missing/apply',{expectedRevision:1,approve:true,acceptAnswerSpaceChange:false},'POST']] as const) {
    assert.equal((await request(route,body,method)).status,403);
  }
  assert.throws(() => api.listImprovementCases({},'intruder'),/Operator access/);
  process.env.APP_OPERATOR_CLERK_USER_IDS = 'editor';
});

test('flagged correction retains evidence, requires approval, replaces future selection and preserves old content', async () => {
  prompt('flagged');
  const quality = await import('../server/db/content-quality.ts');
  const rating = quality.recordContentQualityEncounter({kind:'contrast_prompt',id:'flagged',expected:{promptText:'老师要____学生。',explanation:'Testing knowledge.',targetWordId:'w1'}},'seen');
  quality.setContentQualityRating(rating.contentKey,'down');
  const created = await request('',{kind:'contrast_prompt',sourceId:'flagged',contentKey:rating.contentKey,id:'case-fixed'});
  assert.equal(created.status,200);
  let item = await created.json() as ImprovementCase;
  assert.equal(item.source.scope,'private');
  assert.equal(item.flagged?.contentKey,rating.contentKey);
  assert.equal((await (await request('',{kind:'contrast_prompt',sourceId:'flagged',contentKey:rating.contentKey,id:'case-fixed'})).json()).revision,1);
  const saved = await request(`/${item.id}`,revised(item),'PUT'); assert.equal(saved.status,200);
  item = await saved.json() as ImprovementCase;
  assert.equal(item.revision,2);
  const checked = await (await request(`/${item.id}/validate`,{expectedRevision:2})).json() as ImprovementCheck;
  assert.deepEqual(checked.errors,[]);assert.equal(checked.sourceChanged,false);
  assert.equal((await request(`/${item.id}/apply`,{expectedRevision:2,approve:false,acceptAnswerSpaceChange:false})).status,400);
  const applied = await request(`/${item.id}/apply`,{expectedRevision:2,approve:true,acceptAnswerSpaceChange:false});
  assert.equal(applied.status,200,await applied.clone().text());
  const result = await applied.json() as ImprovementCase;
  assert.equal(result.status,'applied');assert(result.outcome?.replacementSourceId);
  assert.equal(db.prepare('SELECT prompt_text FROM scoped_contrast_prompts WHERE id=?').get('flagged')!.prompt_text,'老师要____学生。');
  const selected = appDb.getContrastPromptsForCluster('cluster');
  assert(!selected.some(p => p.id === 'flagged'));assert(selected.some(p => p.id === result.outcome!.replacementSourceId));
  assert.equal(db.prepare('SELECT rating FROM learner_content_quality_ratings WHERE content_key=?').get(rating.contentKey)!.rating,'down');
  const history = await (await request(`/${item.id}/history`)).json() as ImprovementCase[];
  assert.deepEqual(history.map(h=>h.revision),[1,2,3]);assert.equal(history[2].proposalOrigin,'agent');
  assert.equal(history[2].updatedBy,'editor');assert.equal(history[2].diagnosis,item.diagnosis);
  assert.equal((await request(`/${item.id}/apply`,{expectedRevision:2,approve:true,acceptAnswerSpaceChange:false})).status,409);
  assert.throws(()=>db.prepare('UPDATE content_improvement_revisions SET actor_id=?').run('forged'),/immutable/);
});

test('stale drafts and production changes are rejected without overwriting a proposal', async () => {
  prompt('stale');
  let item = api.createImprovementCase({kind:'contrast_prompt',sourceId:'stale'},'editor');
  item = api.saveImprovementCase(item.id,revised(item),'editor');
  assert.equal((await request(`/${item.id}`,{...revised(item),expectedRevision:1},'PUT')).status,409);
  db.prepare('UPDATE scoped_contrast_prompts SET explanation=? WHERE id=?').run('Updated elsewhere','stale');
  assert.equal(api.validateImprovementCase(item.id,{expectedRevision:2},'editor').sourceChanged,true);
  assert.equal((await request(`/${item.id}/apply`,{expectedRevision:2,approve:true,acceptAnswerSpaceChange:false})).status,409);
  assert.equal(api.getImprovementCase(item.id,'editor').status,'draft');
  assert.equal(db.prepare("SELECT count(*) n FROM content_improvement_replacements WHERE source_id='stale'").get()!.n,0);
});

test('answer-space changes require separate acknowledgement and unchanged resolution never mutates content', async () => {
  prompt('answers');
  let item = api.createImprovementCase({kind:'contrast_prompt',sourceId:'answers'},'editor');
  item = api.saveImprovementCase(item.id,{...revised(item),proposed:{...item.proposed,targetWordId:'w2'}},'editor');
  const checked = api.validateImprovementCase(item.id,{expectedRevision:item.revision},'editor');
  assert.equal(checked.answerSpaceChanged,true);assert.deepEqual(checked.errors,[]);
  assert.equal((await request(`/${item.id}/apply`,{expectedRevision:item.revision,approve:true,acceptAnswerSpaceChange:false})).status,400);
  const closed = api.closeImprovementCase(item.id,{expectedRevision:item.revision,resolution:'Keep original after reviewing the intended distinction.'},'editor');
  assert.equal(closed.status,'closed');assert.equal(db.prepare("SELECT target_word_id FROM scoped_contrast_prompts WHERE id='answers'").get()!.target_word_id,'w1');
});

test('failed application rolls back successor, content and evidence and can be retried after fixing the failure', () => {
  prompt('atomic');
  let item = api.createImprovementCase({kind:'contrast_prompt',sourceId:'atomic'},'editor');
  item = api.saveImprovementCase(item.id,revised(item),'editor');
  db.exec(`CREATE TRIGGER fail_improvement_evidence BEFORE INSERT ON content_improvement_revisions
    WHEN NEW.case_id = '${item.id}' AND NEW.revision = 3
    BEGIN SELECT RAISE(ABORT,'injected evidence failure'); END;`);
  try {
    assert.throws(() => api.applyImprovementCase(item.id,{expectedRevision:item.revision,approve:true,acceptAnswerSpaceChange:false},'editor'),/injected evidence failure/);
    assert.equal(api.getImprovementCase(item.id,'editor').status,'draft');
    assert.equal(api.getImprovementHistory(item.id,'editor').length,2);
    assert.equal(db.prepare("SELECT count(*) n FROM content_improvement_replacements WHERE source_id='atomic'").get()!.n,0);
    assert.equal(db.prepare("SELECT count(*) n FROM scoped_contrast_prompts WHERE prompt_text='老师要____学生对课文的理解。'").get()!.n,1);
  } finally { db.exec('DROP TRIGGER fail_improvement_evidence'); }
  assert.equal(api.applyImprovementCase(item.id,{expectedRevision:item.revision,approve:true,acceptAnswerSpaceChange:false},'editor').status,'applied');
});
