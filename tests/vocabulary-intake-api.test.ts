import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { after, before, test } from 'node:test';
import type { ChatProvider } from '../server/llm/chat-types.ts';
import type { VocabularyIntakeStreamEvent } from '../src/domain/vocabulary-intake.ts';

const keys = ['APP_MODE','APP_DATA_DIR','APP_AUTH_MODE','APP_STUDY_PROFILE','APP_OPERATOR_CLERK_USER_IDS'] as const;
const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
let directory: string, server: http.Server, endpoint: string, providerCalls = 0;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-intake-api-'));
  Object.assign(process.env,{ APP_MODE:'study',APP_DATA_DIR:directory,APP_AUTH_MODE:'clerk',APP_STUDY_PROFILE:'mandarin',APP_OPERATOR_CLERK_USER_IDS:'' });
  const { createApp } = await import('../server/index.ts');
  const { getDb } = await import('../server/db/connection.ts');
  const { createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog } = await import('../server/db/vocabulary-content.ts');
  const { writeVocabularyDefaultUsefulSenses } = await import('../server/db/vocabulary-sense-coverage.ts');
  getDb().prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at,normalized_hanzi)
    VALUES ('torn','纠结','jiūjié','torn','[]',1,'2026-01-01T00:00:00.000Z','纠结')`).run();
  const actor = { kind:'operator', id:'test' } as const;
  createVocabularySense({ wordId:'torn',senseId:'torn-1',description:{label:'Torn',notes:[]} },actor);
  establishVocabularySenseCatalog('torn',getVocabularySenseCatalog('torn').version,actor);
  writeVocabularyDefaultUsefulSenses('torn',0,['torn-1'],actor);
  const provider: ChatProvider = { async stream(request,_config,emit) {
    providerCalls++;
    if (request.messages.at(-1)?.content === 'Force terminal failure') throw new Error('Simulated provider failure');
    if (request.messages.at(-1)?.content === 'Undo that add') {
      const context = request.messages.find(message => message.role === 'user' && message.content.startsWith('{"contextOnly"'));
      assert.ok(context);
      const cardId = JSON.parse(context.content).cards[0].id;
      await emit('I’ll undo that add.');
      return { invocationId:null,responseId:null,usage:null,message:{role:'assistant',content:'I’ll undo that add.',
        toolCalls:[{id:'revision',name:'complete_turn',arguments:JSON.stringify({explanation:'The add can be undone.',action:{kind:'revise_card',revision:{cardId,action:'undo',selection:null,proposedSense:null,context:null}}})}] } };
    }
    const lookedUp = request.messages.some(message => message.role === 'tool');
    if (lookedUp) await emit('纠结 means feeling torn.');
    return { invocationId:null,responseId:null,usage:null,message:{role:'assistant',content:lookedUp ? '纠结 means feeling torn.' : '',
      toolCalls:[lookedUp
        ? { id:'card',name:'complete_turn',arguments:JSON.stringify({explanation:'纠结 means feeling torn.',action:{kind:'present_card',card:{ wordId:'torn',decision:'bare',requestedLexeme:'纠结',
          selection:{senseIds:['torn-1'],targetSenseId:null,includeProposedSense:false},context:null,proposedSense:null }}}) }
        : { id:'lookup',name:'lookup_word',arguments:JSON.stringify({hanzi:'纠结'}) }],
    } };
  } };
  server = createApp({ frontendDistPath:null, vocabularyIntakeProvider:provider,
    resolveClerkProviderSubject:req=>req.header('X-Test-Subject') ?? null }).listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject) => { server.once('listening',resolve); server.once('error',reject); });
  const address = server.address();
  assert(address && typeof address === 'object');
  endpoint = `http://127.0.0.1:${address.port}/api/vocabulary/intake`;
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  const { closeDbConnection } = await import('../server/db/connection.ts'); closeDbConnection();
  for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  fs.rmSync(directory,{ recursive:true,force:true });
});
test('HTTP requires auth, streams public events, replays and isolates learners',async () => {
  const fixture = { method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ clientTurnId:'same',text:'纠结' }) };
  assert.equal((await fetch(`${endpoint}/turns`,fixture)).status,401);
  assert.equal(providerCalls,0);
  const alice = { 'X-Test-Subject':'user_alice' }, bob = { 'X-Test-Subject':'user_bob' };
  const post = { ...fixture,headers:{...fixture.headers,...alice} };
  const invalid = await fetch(`${endpoint}/turns`,{...post,body:JSON.stringify({clientTurnId:'invalid',text:'字'.repeat(4001)})});
  assert.equal(invalid.status,400);
  const response = await fetch(`${endpoint}/turns`,post);
  assert.match(response.headers.get('Content-Type') ?? '',/text\/event-stream/);
  const payload = await response.text();
  assert.doesNotMatch(payload,/"undo":|"lease":|"body":/u);
  const events = payload.split('\n\n').filter(Boolean).map(line => JSON.parse(line.slice(6)) as VocabularyIntakeStreamEvent);
  assert.deepEqual(events.map(event=>event.type),['progress','progress','progress','completion','done']);
  assert.doesNotMatch(JSON.stringify(events),/Uncommitted/);
  const completion = events.find(event=>event.type==='completion');
  assert.ok(completion); const card=completion.cards[0]; assert.ok(card);
  assert.equal((await fetch(`${endpoint}/cards/${card.id}`,{headers:bob})).status,404);
  assert.deepEqual((await (await fetch(endpoint,{headers:bob})).json()).turns,[]);
  assert.deepEqual((await (await fetch(endpoint,{headers:alice})).json()).turns[0].cardIds,[card.id]);
  const replay = await (await fetch(`${endpoint}/turns`,post)).text();
  assert.deepEqual(replay.split('\n\n').filter(Boolean).map(line=>JSON.parse(line.slice(6))),events.filter(event=>event.type!=='progress'));
  assert.equal(providerCalls,2);
  const followup = { ...post, body:JSON.stringify({clientTurnId:'followup',text:'Undo that add'}) };
  const followupPayload = await (await fetch(`${endpoint}/turns`,followup)).text();
  const followupEvents = followupPayload.split('\n\n').filter(Boolean).map(line=>JSON.parse(line.slice(6)) as VocabularyIntakeStreamEvent);
  assert.deepEqual(followupEvents.map(event=>event.type),['progress','completion','done']);
  const revision = followupEvents[1];
  if (revision.type !== 'completion') assert.fail('missing revised card');
  const revised = revision.cards[0]; assert.ok(revised);
  assert.equal(revised.id,card.id); assert.equal(revised.state,'proposed');
  assert.equal(revised.version,card.version+1);
  assert.deepEqual((await (await fetch(`${endpoint}/turns`,followup)).text()).split('\n\n').filter(Boolean).map(line=>JSON.parse(line.slice(6))),followupEvents.filter(event=>event.type!=='progress'));
  assert.equal(providerCalls,3);
  const history = await (await fetch(endpoint,{headers:alice})).json();
  assert.equal(history.turns.length,2);
  assert.ok(history.turns.every((turn: {cardIds:string[]})=>turn.cardIds[0]===card.id));
  assert.deepEqual((await (await fetch(endpoint,{headers:bob})).json()).turns,[]);
  const operatorPath = endpoint.replace('/api/vocabulary/','/api/operator/vocabulary/')+'/findings';
  assert.equal((await fetch(operatorPath,{headers:alice})).status,403);
  process.env.APP_OPERATOR_CLERK_USER_IDS = 'user_alice';
  const allowed = await fetch(operatorPath,{headers:alice});
  assert.equal(allowed.status,200);
  assert.deepEqual(await allowed.json(),{findings:[]});
});


test('a confirmed terminal failure allows a fresh retry while a lost completion replays its identity',async()=>{
  const send = (clientTurnId: string) => fetch(`${endpoint}/turns`,{method:'POST',headers:{'Content-Type':'application/json','X-Test-Subject':'user_alice'},
    body:JSON.stringify({clientTurnId,text:'Force terminal failure'})}).then(response=>response.text());
  const count=providerCalls;
  const first=await send('failure-id');
  assert.match(first, /"retryWithNewId":true/);
  assert.equal(providerCalls,count+1);
  assert.match(await send('failure-id'), /"retryWithNewId":true/);
  assert.equal(providerCalls,count+1,'failed identity must not rerun provider');
  assert.match(await send('new-failure-id'), /"retryWithNewId":true/);
  assert.equal(providerCalls,count+2,'new attempt can execute provider');
});
