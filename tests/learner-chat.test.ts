import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { appendChatEvent, chatTurnAssistantText, createChatCard, finishChatTurn, getChatCard, getChatTurn, getOrCreateChatConversation,
  listChatCards, listChatEvents, listChatTurns, listRecentChatTurns, listChatTurnCards, recoverInterruptedChatTurns, runChatCardCommand, startChatTurn, updateChatCard, withChatTransaction } from '../server/db/learner-chat.ts';
import { runConversationTurn } from '../server/chat/conversation.ts';
let sql: DatabaseSync;
const alice = <T>(operation: () => T) => runWithLearnerId('alice', operation);
const bob = <T>(operation: () => T) => runWithLearnerId('bob', operation);
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); setDb(sql);
  sql.exec("PRAGMA foreign_keys=ON; CREATE TABLE learners(learner_id TEXT PRIMARY KEY); INSERT INTO learners VALUES ('alice'),('bob'); CREATE TABLE effects(value TEXT);");
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0075_learner_chat.sql', import.meta.url), 'utf8'));
});
afterEach(() => sql.close());
function setup() {
  const conversation = getOrCreateChatConversation('add-word');
  const { turn } = startChatTurn(conversation, 'client1', { text: '你好' });
  const card = createChatCard(turn.id, { state: 'proposed' });
  return { conversation, turn, card };
}
test('new storage preserves existing rows and same-learner foreign keys reject cross-learner references', () => {
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM learners').get()!.n, 2);
  const { conversation, turn } = alice(setup);
  assert.throws(() => sql.prepare(`INSERT INTO learner_chat_turns VALUES ('bob','t',?,'client','{}','running','now',NULL,NULL)`).run(conversation), /FOREIGN KEY/);
  assert.throws(() => sql.prepare(`INSERT INTO learner_chat_events VALUES ('bob',?,1,'{}','now')`).run(turn.id), /FOREIGN KEY/);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
});
test('private context governs reads, card commands, events, and conversation reuse', () => {
  const { conversation, turn, card } = alice(setup);
  assert.equal(alice(() => getOrCreateChatConversation('add-word')), conversation);
  bob(() => {
    assert.notEqual(getOrCreateChatConversation('add-word'), conversation);
    assert.equal(getChatTurn(turn.id), null); assert.equal(getChatCard(card.id), null);
    assert.deepEqual(listChatCards('add-word'), []);
    assert.throws(() => startChatTurn(conversation, 'x', {}), /not found/);
    assert.throws(() => listChatEvents(turn.id), /not found/);
    assert.throws(() => updateChatCard(card.id, 1, {}), /unavailable/);
  });
});
test('client turn identity is idempotent and rejects changed input even after failure', () => alice(() => {
  const { conversation, turn } = setup();
  finishChatTurn(turn.id, 'failed', 'provider failed');
  const retry = startChatTurn(conversation, 'client1', { text: '你好' });
  assert.equal(retry.created, false); assert.equal(retry.turn.status, 'failed');
  assert.throws(() => startChatTurn(conversation, 'client1', { text: 'different' }), /different input/);
  assert.throws(() => appendChatEvent(turn.id, {}), /not running/);
}));
test('events and cards paginate without skipping identical timestamps', () => alice(() => {
  const { turn, conversation } = setup();
  for (let i = 0; i < 4; i++) { createChatCard(turn.id, { n: i }); appendChatEvent(turn.id, { text: String(i) }); }
  sql.exec("UPDATE learner_chat_cards SET created_at='2026-11-15T00:00:00.000Z'");
  const first = listChatCards('add-word', undefined, 2), second = listChatCards('add-word', first.at(-1), 2);
  assert.equal(new Set([...first, ...second].map(card => card.id)).size, 4);
  assert.equal(listChatTurns(conversation).length, 1);
  const events = listChatEvents(turn.id, 0, 3);
  assert.equal(listChatEvents(turn.id, events.at(-1)!.sequence, 3)[0]!.sequence, 4);
}));
test('card command receipts replay once and rollback both domain writes and card changes on failure', () => alice(() => {
  const { card } = setup();
  const input = { cardId: card.id, clientActionId: 'action', expectedVersion: 1, request: { action: 'add' }, apply: () => {
    sql.prepare('INSERT INTO effects VALUES (?)').run('added'); return { state: 'added' };
  } };
  const result = runChatCardCommand(input);
  assert.equal(result.version, 2); assert.deepEqual(runChatCardCommand(input), result);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM effects').get()!.n, 1);
  assert.throws(() => runChatCardCommand({ ...input, request: { action: 'undo' } }), /different input/);
  assert.throws(() => runChatCardCommand({ ...input, clientActionId: 'fail', expectedVersion: 2, apply: () => {
    sql.prepare('INSERT INTO effects VALUES (?)').run('must rollback'); throw new Error('failure');
  } }), /failure/);
  assert.equal(getChatCard(card.id)!.version, 2); assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM effects').get()!.n, 1);
  assert.throws(() => withChatTransaction(() => { updateChatCard(card.id, 2, {}); throw new Error('outer failure'); }), /outer failure/);
  assert.equal(getChatCard(card.id)!.version, 2);
}));
test('durable turn retains committed card despite disconnected observer; retry never repeats provider or effects', async () => alice(async () => {
  const conversationId = getOrCreateChatConversation('add-word');
  let calls = 0;
  const input: Parameters<typeof runConversationTurn>[0] = {
    conversationId, clientTurnId: 'client', userRequest: { text: 'word' }, config: { apiKey: '', baseUrl: null },
    request: { model: 'fixture', messages: [{ role: 'user', content: 'word' }], maxOutputTokens: 10, timeoutMs: 1000, reasoningEffort: null, provenance: {} },
    provider: { async stream() { calls++; return { invocationId: null, responseId: null, usage: null, message: {
      role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'present', arguments: '{}' }],
    } }; } }, reads: [],
    output: { name: 'present', description: '', parameters: { type: 'object' }, complete: (_value, turnId) => ({explanation:'Here it is.',card:createChatCard(turnId, { state: 'added' })}) },
    publish: () => { throw new Error('client disconnected'); },
  };
  const result = await runConversationTurn(input);
  assert.equal(result.status, 'completed'); assert.equal(listChatCards('add-word').length, 1);
  assert.equal((await runConversationTurn(input)).created, false); assert.equal(calls, 1);
}));

test('invalid structured output leaves a failed turn and never publishes a card', async () => alice(async () => {
  const conversationId = getOrCreateChatConversation('add-word');
  const published: unknown[] = [];
  await assert.rejects(runConversationTurn({ conversationId, clientTurnId: 'bad-card', userRequest: { text: 'word' },
    config: { apiKey: '', baseUrl: null },
    request: { model: 'fixture', messages: [{ role: 'user', content: 'word' }], maxOutputTokens: 10, timeoutMs: 1000, reasoningEffort: null, provenance: {} },
    provider: { async stream(_request, _config, onText) {
      await onText('Considering the word.');
      return { invocationId: null, responseId: null, usage: null, message: { role: 'assistant', content: 'Considering the word.',
        toolCalls: [{ id: 'call', name: 'present', arguments: '{"word":"not-a-real-word"}' }] } };
    } }, reads: [], output: { name: 'present', description: '', parameters: { type: 'object' },
      complete: () => { throw new Error('Unknown word ID'); } }, publish: event => { published.push(event); },
  }), /Unknown word ID/);
  const turn = listChatTurns(conversationId)[0]!;
  assert.equal(turn.status, 'failed'); assert.equal(turn.error, 'Unknown word ID');
  assert.deepEqual(listChatCards('add-word'), []);
  assert.ok(published.length > 0); assert.ok(!JSON.stringify(published).includes('"kind":"completion"'));
}));

 test('recent history pages remain chronological and reject another learner cursor',()=>{
  const conversation=alice(()=>getOrCreateChatConversation('add-word'));
  const ids=alice(()=>Array.from({length:4},(_,i)=>startChatTurn(conversation,`page-${i}`,{text:String(i)}).turn.id));
  sql.exec("UPDATE learner_chat_turns SET created_at='2026-01-01'");
  alice(()=>{
    const newest=listRecentChatTurns(conversation,undefined,2);
    const earlier=listRecentChatTurns(conversation,newest.before!,2);
    assert.deepEqual([...earlier.turns,...newest.turns].map(t=>t.id),ids.sort());
    assert.equal(earlier.before,null);
  });
  bob(()=>{assert.deepEqual(listChatTurnCards(ids[0]!),[]);assert.throws(()=>listRecentChatTurns(getOrCreateChatConversation('add-word'),ids[0]),/cursor/);});
});
test('expiry recovery settles only old running turns on its surface and preserves committed cards',()=>alice(()=>{
  const saved=setup();
  const empty=startChatTurn(saved.conversation,'empty',{}).turn;
  const other=startChatTurn(getOrCreateChatConversation('other'),'other',{}).turn;
  sql.exec("UPDATE learner_chat_turns SET created_at='2026-01-01'");
  const fresh=startChatTurn(saved.conversation,'fresh',{}).turn;
  recoverInterruptedChatTurns('add-word','2026-02-01','2026-02-02');
  assert.equal(getChatTurn(saved.turn.id)?.status,'completed');
  assert.equal(getChatTurn(empty.id)?.status,'failed');
  assert.equal(getChatTurn(other.id)?.status,'running');
  assert.equal(getChatTurn(fresh.id)?.status,'running');
  assert.equal(getChatCard(saved.card.id)?.version,1);
}));

function completionInput(clientTurnId: string, complete: Parameters<typeof runConversationTurn>[0]['output']['complete']): Parameters<typeof runConversationTurn>[0] {
  return {conversationId:getOrCreateChatConversation('add-word'),clientTurnId,userRequest:{text:'word'},config:{apiKey:'',baseUrl:null},
    request:{model:'fixture',messages:[{role:'user',content:'word'}],maxOutputTokens:200,timeoutMs:1000,reasoningEffort:null,provenance:{}},
    provider:{async stream(_request,_config,onText){await onText('Uncommitted model text');return {invocationId:null,responseId:null,usage:null,
      message:{role:'assistant',content:'Uncommitted model text',toolCalls:[{id:'complete',name:'complete_turn',arguments:'{}'}]}};}},
    reads:[],output:{name:'complete_turn',description:'',parameters:{type:'object'},complete}};
}
test('answers commit final explanation and status together and replay without provider work',async()=>alice(async()=>{
  const input=completionInput('answer',()=>({explanation:'A language answer.',card:null}));
  const result=await runConversationTurn(input);
  assert.equal(getChatTurn(result.turnId)?.status,'completed');
  assert.equal(chatTurnAssistantText(result.turnId),'A language answer.');
  assert.equal(listChatTurnCards(result.turnId).length,0);
  assert.ok(!listChatEvents(result.turnId).some(({event})=>(event as {kind:string}).kind==='progress'));
  input.provider={stream:async()=>assert.fail('replayed provider')};
  assert.equal((await runConversationTurn(input)).created,false);
}));
test('failure saving terminal event rolls back card and domain effects; raw prose stays hidden',async()=>alice(async()=>{
  sql.exec(`CREATE TRIGGER reject_completion BEFORE INSERT ON learner_chat_events
    WHEN json_extract(NEW.event_json,'$.kind')='completion' BEGIN SELECT RAISE(ABORT,'final write failed'); END`);
  const input=completionInput('rollback',(_value,turnId)=>{
    sql.prepare('INSERT INTO effects VALUES (?)').run('enrolled');
    return {explanation:'Ready.',card:createChatCard(turnId,{state:'added'})};
  });
  await assert.rejects(runConversationTurn(input),/final write failed/);
  const turn=listChatTurns(input.conversationId)[0]!;
  assert.equal(turn.status,'failed');assert.equal(chatTurnAssistantText(turn.id),'');
  assert.equal(listChatTurnCards(turn.id).length,0);assert.equal(sql.prepare('SELECT count(*) n FROM effects').get()!.n,0);
}));
test('legacy prose remains readable and recovery requires completion for new-format attempts',()=>alice(()=>{
  const conversation=getOrCreateChatConversation('add-word');
  const legacy=startChatTurn(conversation,'legacy',{}).turn;
  appendChatEvent(legacy.id,{kind:'text_delta',text:'Old streamed answer.'});
  assert.equal(chatTurnAssistantText(legacy.id),'Old streamed answer.');
  const fresh=startChatTurn(conversation,'new',{}).turn;
  appendChatEvent(fresh.id,{kind:'completion_required',version:1});
  appendChatEvent(fresh.id,{kind:'assistant',message:{content:'Unfinished answer'}});
  createChatCard(fresh.id,{}); // Simulate corrupt/incomplete new-format evidence; a card alone is not completion.
  const answer=startChatTurn(conversation,'new-answer',{}).turn;
  appendChatEvent(answer.id,{kind:'completion_required',version:1});
  appendChatEvent(answer.id,{kind:'completion',version:1,explanation:'Saved answer.',cardId:null});
  sql.exec("UPDATE learner_chat_turns SET created_at='2026-01-01'");
  recoverInterruptedChatTurns('add-word','2026-02-01');
  assert.equal(getChatTurn(fresh.id)?.status,'failed');assert.equal(chatTurnAssistantText(fresh.id),'');
  assert.equal(getChatTurn(answer.id)?.status,'completed');assert.equal(chatTurnAssistantText(answer.id),'Saved answer.');
}));
