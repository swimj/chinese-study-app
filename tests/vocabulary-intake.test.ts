import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { setDb } from '../server/db/connection.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { installLearnerContextSqlFunction, runWithLearnerId } from '../server/db/learner-context.ts';
import { ChatConflictError, createChatCard, getChatTurn, getOrCreateChatConversation, startChatTurn, updateChatCard } from '../server/db/learner-chat.ts';
import { getVocabularyIntakeCard, intakeConversationId, listVocabularyIntakeCards, listVocabularyIntakeFindings,
  completeIntakeContextMatch, projectVocabularyIntakeCard, reviseVocabularyIntakeCard, runVocabularyIntakeCommand, type IntakeCardDraft, type IntakeCardRevision } from '../server/db/vocabulary-intake.ts';
import { vocabularyIntakeContext } from '../server/vocabulary/intake-context.ts';
import { hasPendingVocabularyIntakeMatch } from '../server/db/vocabulary-intake-pending.ts';
import { createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog, getVocabularySenses, updateVocabularySense } from '../server/db/vocabulary-content.ts';
import { getVocabularyWordSenseCoverage, writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { getVocabularyLearnerWord, getVocabularyWordSchedule, changeVocabularyMode, addVocabularyWord, dismissVocabularyWord } from '../server/db/vocabulary-learners.ts';
import { resolveVocabularyLearnerSenseScope, writeVocabularyLearnerSenseScope } from '../server/db/vocabulary-learner-senses.ts';
import { getVocabularyIntakeHistory, recoverVocabularyIntakeTurns, sendVocabularyIntakeTurn } from '../server/vocabulary/intake-chat.ts';
import { createVocabularyIntakeWorker } from '../server/vocabulary/intake-worker.ts';
import { composeVocabularyStudy } from '../server/vocabulary/composition.ts';
import type { ChatProvider } from '../server/llm/chat-types.ts';
import type { JsonValue } from '../server/llm/types.ts';
import type { VocabularyIntakeCard, VocabularyIntakeCommand, VocabularyIntakeStreamEvent } from '../src/domain/vocabulary-intake.ts';

let root: string, baseline: string, db: DatabaseSync;
const env: Record<string,string|undefined> = {};
const alice = <T>(run: () => T) => runWithLearnerId('alice',run);
const bob = <T>(run: () => T) => runWithLearnerId('bob',run);
const operator = { kind: 'operator', id: 'test' } as const;
const initial = '2026-01-01T00:00:00.000Z';
const words = [
  ['gang','帮派','gang'], ['lingering','绵长','lingering'], ['return','接发球','return serve'],
  ['torn','纠结','torn'], ['dense','致密','compact'], ['doting','宠溺','spoil'],
  ['content','怡然自得','contented'], ['ease','怡然','at ease'], ['sponge','海绵','sponge'],
  ['distil','蒸馏','distil'], ['other','具体','concrete'],
] as const;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-intake-'));
  const source = path.join(root,'base'); createBaselineFixture(source); baseline = path.join(source,'app.db');
  for (const key of ['APP_MODE','APP_DATA_DIR','APP_AUTH_MODE','VITE_STUDY_PROFILE']) env[key] = process.env[key];
  process.env.APP_MODE='study'; process.env.APP_DATA_DIR=root; process.env.APP_AUTH_MODE='clerk'; process.env.VITE_STUDY_PROFILE='mandarin';
});
after(() => {
  for (const [key,value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(root,{recursive:true,force:true});
});
beforeEach(() => {
  const file = path.join(root,`${Math.random()}.db`); fs.copyFileSync(baseline,file);
  db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON'); setDb(db); installLearnerContextSqlFunction(); migrateDatabase(db);
  db.prepare("INSERT INTO learners(learner_id,display_name,created_at) VALUES ('alice','Alice',?),('bob','Bob',?)").run(initial,initial);
  const lexical = db.prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at,normalized_hanzi)
    VALUES (?,?,?,?,'[]',1,?,?)`);
  for (const [id,hanzi,meaning] of words) lexical.run(id,hanzi,'pinyin',meaning,initial,hanzi);
  alice(() => {
    for (const id of ['gang','return','torn','dense','doting','content','sponge','distil','other']) {
      establish(id,id === 'dense' ? [] : id === 'gang' ? [`${id}-1`,`${id}-2`] : [`${id}-1`]);
    }
  });
});
afterEach(() => { db.close(); setDb(null); });
function establish(id: string, defaults: string[] | null): void {
  for (const ix of [1,2]) createVocabularySense({ wordId:id, senseId:`${id}-${ix}`, description: { label:`Use ${ix} for ${id}`, notes: [] } },operator);
  establishVocabularySenseCatalog(id,getVocabularySenseCatalog(id).version,operator);
  if (defaults !== null) writeVocabularyDefaultUsefulSenses(id,0,defaults,operator);
}
function select(...senseIds: string[]): IntakeCardDraft['selection'] {
  return { senseIds, includeProposedSense:false, targetSenseId:null };
}
type Call = { name: string; arguments: JsonValue };
const lookup = (hanzi: string): Call => ({ name:'lookup_word', arguments:{hanzi} });
function trace(calls: Call[], onCall = () => {}): ChatProvider {
  let index = 0, previous: Call | undefined;
  return { async stream(request,_config,onText) {
    onCall();
    // A scripted model that has nothing new to offer repeats a rejected call, so persistent invalid output still fails.
    const last = request.messages.at(-1);
    const rejected = last?.role === 'tool' && last.content.startsWith('{"rejected"');
    const planned = calls[index++] ?? (rejected ? previous : undefined);
    previous = planned;
    const call = !planned || planned.name === 'present_card' || planned.name === 'revise_card'
      ? {name:'complete_turn',arguments:{explanation:'A short explanation.',action:planned
        ? planned.name === 'revise_card' ? {kind:'revise_card',revision:planned.arguments} : {kind:'present_card',card:planned.arguments} : {kind:'answer'}}} : planned;
    await onText('Uncommitted prose must stay hidden.');
    return { invocationId:null, responseId:null, usage:null, message: {
      role:'assistant',content:'Uncommitted prose must stay hidden.',
      toolCalls:[{ id:`trace-${index}`,name:call.name,arguments:JSON.stringify(call.arguments) }],
    } };
  } };
}
function draft(wordId: string, decision: IntakeCardDraft['decision'], requestedLexeme: string | null,
  selection: IntakeCardDraft['selection'], extra: Partial<IntakeCardDraft> = {}): IntakeCardDraft {
  return { wordId,decision,requestedLexeme,selection,context:null,proposedSense:null,...extra };
}
async function send(text: string, calls: Call[], output?: IntakeCardDraft, clientTurnId = text) {
  const events: VocabularyIntakeStreamEvent[] = [];
  const provider = trace(output ? [...calls,{ name:'present_card',arguments:output as unknown as JsonValue }] : calls);
  const turnId = await sendVocabularyIntakeTurn({ clientTurnId,text,provider,publish:event=>events.push(event) });
  const card = events.find((event): event is Extract<VocabularyIntakeStreamEvent,{type:'completion'}> => event.type === 'completion')?.cards[0];
  return { turnId, card, events };
}
const getCard = (id: string) => projectVocabularyIntakeCard(getVocabularyIntakeCard(id));
function request(card: VocabularyIntakeCard, command: VocabularyIntakeCommand, action: string) {
  return { clientActionId:action, expectedVersion:card.version, versions:card.versions, command };
}
test('lookup results carry current senses, defaults and learner scope without secondary reads', async () => alice(async () => {
  const added = addVocabularyWord('gang');
  changeVocabularyMode('gang','practice',added.stateVersion);
  let inspected = false;
  const scripted = trace([lookup('帮派')]);
  const provider: ChatProvider = { async stream(request, config, onText) {
    const result = request.messages.findLast(message => message.role === 'tool');
    if (result) {
      const rows = JSON.parse(result.content) as Array<{
        wordId: string; inventoryEstablished: boolean; defaultsState: string; defaultSenseIds: string[];
        senses: Array<{senseId: string}>;
        learner: {enrolled: boolean; mode: string; includedSenseIds: string[]};
      }>;
      assert.equal(rows.length,1);
      const row = rows[0]!;
      assert.equal(row.wordId,'gang');
      assert.equal(row.inventoryEstablished,true);
      assert.equal(row.defaultsState,'set');
      assert.deepEqual(row.defaultSenseIds,['gang-1','gang-2']);
      assert.deepEqual(row.senses.map(sense=>sense.senseId),['gang-1','gang-2']);
      assert.deepEqual(row.learner,{enrolled:true,mode:'practice',includedSenseIds:['gang-1','gang-2']});
      inspected = true;
    }
    return scripted.stream(request,config,onText);
  } };
  await sendVocabularyIntakeTurn({clientTurnId:'combined-lookup',text:'帮派',provider,publish:()=>{}});
  assert.equal(inspected,true);
}));
test('lookup results state unknown and empty defaults and report no study senses before enrollment', async () => alice(async () => {
  const seen = new Map<string,{defaultsState:string;defaultSenseIds:string[]|null;learner:unknown}>();
  for (const hanzi of ['致密','怡然']) {
    const scripted = trace([lookup(hanzi)]);
    const provider: ChatProvider = { async stream(request, config, onText) {
      const result = request.messages.findLast(message => message.role === 'tool');
      if (result) for (const row of JSON.parse(result.content) as Array<{hanzi:string;defaultsState:string;defaultSenseIds:string[]|null;learner:unknown}>) seen.set(row.hanzi,row);
      return scripted.stream(request,config,onText);
    } };
    await sendVocabularyIntakeTurn({clientTurnId:`defaults-${hanzi}`,text:hanzi,provider,publish:()=>{}});
  }
  assert.equal(seen.get('致密')?.defaultsState,'empty'); assert.deepEqual(seen.get('致密')?.defaultSenseIds,[]);
  assert.equal(seen.get('怡然')?.defaultsState,'unknown'); assert.equal(seen.get('怡然')?.defaultSenseIds,null);
  for (const hanzi of ['致密','怡然']) assert.deepEqual(seen.get(hanzi)?.learner,{enrolled:false,mode:null,includedSenseIds:[]});
}));
test('a rejected completion is returned to the model, which can correct it without failing the turn', async () => alice(async () => {
  const invented = draft('gang','context_match','帮派',{...select('gang-1','gang-2'),targetSenseId:'gang-1'},{context:'a context the learner never wrote'});
  const corrected = await send('帮派 - gang members in a film',[lookup('帮派'),{name:'present_card',arguments:invented as unknown as JsonValue}],
    draft('gang','context_match','帮派',{...select('gang-1','gang-2'),targetSenseId:'gang-1'},{context:'gang members in a film'}));
  assert.equal(corrected.card?.hanzi,'帮派');
  assert.equal(getVocabularyLearnerWord('gang')?.intendedUseText,'gang members in a film');
  assert.equal(getVocabularyIntakeHistory().turns.at(-1)?.status,'complete');
}));
test('repeat lookups show Added for unstudied words and Already studying after study begins', async () => alice(async () => {
  const first = await send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2')));
  const again = await send('帮派',[lookup('帮派')],draft('gang','existing','帮派',select('gang-1','gang-2')),'repeat-gang');
  assert.ok(first.card && again.card);
  assert.equal(getCard(first.card.id).state,'added');
  assert.equal(getCard(first.card.id).defaultsEstablished,true);
  assert.ok(listVocabularyIntakeCards(true).some(card => card.id === first.card!.id));
  assert.equal(again.card.state,getCard(first.card.id).state);
  const word = getVocabularyLearnerWord('gang')!;
  changeVocabularyMode('gang','practice',word.stateVersion);
  assert.equal(getCard(first.card.id).state,'already-studying');
  assert.equal(getCard(again.card.id).state,'already-studying');
}));

test('the ten intake traces preserve fixed add and proposal boundaries', async () => alice(async () => {
  const gang = await send('帮派 - gang members in a film',[lookup('帮派')],
    draft('gang','context_match','帮派',{...select('gang-1','gang-2'),targetSenseId:'gang-1'},{context:'gang members in a film'}));
  assert.equal(gang.card?.state,'added'); assert.deepEqual(gang.card?.selection.senseIds,['gang-1','gang-2']);
  assert.equal(resolveVocabularyLearnerSenseScope('gang').choices[0]?.senseId,'gang-1');
  assert.equal(getVocabularyLearnerWord('gang')?.intendedUseText,'gang members in a film');
  const pending = await send('绵长 - 用绵长、安静、不紧张的温柔',[lookup('绵长')],
    draft('lingering','inventory_pending','绵长',select(),{context:'用绵长、安静、不紧张的温柔'}));
  assert.equal(pending.card?.state,'added'); assert.equal(hasPendingVocabularyIntakeMatch('lingering'),true);
  const redirect = await send('接发 - return serve',[lookup('接发'),{name:'find_expressions_containing',arguments:{hanzi:'接发'}}],
    draft('return','larger_expression','接发',select('return-1')));
  assert.equal(redirect.card?.state,'proposed'); assert.equal(getVocabularyLearnerWord('return'),null);
  assert.equal(listVocabularyIntakeFindings().length,1);
  const bare = await send('纠结',[lookup('纠结')],draft('torn','bare','纠结',select('torn-1')));
  assert.ok(bare.card?.actions.includes('undo')); assert.equal(getVocabularyLearnerWord('torn')?.inStash,true);
  const dense = await send('致密',[lookup('致密')],draft('dense','proposal','致密',select('dense-1')));
  assert.equal(dense.card?.state,'proposed'); assert.deepEqual(dense.card?.selection.senseIds,['dense-1']);
  const earlier = addVocabularyWord('doting'); changeVocabularyMode('doting','practice',earlier.stateVersion);
  const before = getVocabularyLearnerWord('doting');
  const studied = await send('宠溺',[lookup('宠溺')],draft('doting','existing','宠溺',select('doting-1')));
  assert.equal(studied.card?.state,'already-studying'); assert.deepEqual(getVocabularyLearnerWord('doting'),before);
  const phrase = await send('怡然自得 - should I study the parts?',[lookup('怡然自得'),lookup('怡然')],
    draft('content','proposal','怡然自得',select('content-1')));
  assert.equal(phrase.card?.state,'proposed'); assert.equal(getVocabularyLearnerWord('ease'),null);
  const misspelled = await send('海眠 - sponge',[lookup('海眠'),{name:'find_similar',arguments:{hanzi:'海眠',gloss:'sponge'}}],
    draft('sponge','correction','海眠',select('sponge-1')));
  assert.equal(misspelled.card?.state,'proposed'); assert.equal(getVocabularyLearnerWord('sponge'),null);
  const novel = await send('蒸馏 - model distillation',[lookup('蒸馏')],
    draft('distil','proposal','蒸馏',{...select('distil-1'),includeProposedSense:true},
      {context:'model distillation',proposedSense:{label:'Distil a model',notes:['The technical verb in 把大模型蒸馏成小模型.']}}));
  assert.equal(novel.card?.state,'proposed'); assert.equal(getVocabularySenses('distil').length,2);
  const offBase = await send('纠结 - scissors',[lookup('纠结')]);
  assert.equal(offBase.card,undefined);
  assert.equal(getVocabularyIntakeHistory().turns.length,10);
  assert.equal(listVocabularyIntakeCards(true).find(card => card.id === redirect.card?.id)?.state,'proposed');
  assert.equal(db.prepare("SELECT status FROM vocabulary_sense_readiness WHERE word_id='ease'").get()?.status,'queued');
}));
test('card commands bind active owned IDs, learner/catalog versions, and action receipts; undo keeps shared content', async () => alice(async () => {
  const { card } = await send('蒸馏 - model distillation',[lookup('蒸馏')],
    draft('distil','proposal','蒸馏',{...select('distil-1'),includeProposedSense:true},
      {context:'model distillation',proposedSense:{label:'Distil a model',notes:['The technical verb in 把大模型蒸馏成小模型.']}}));
  assert.ok(card);
  assert.throws(() => runVocabularyIntakeCommand(card.id,request(card,{type:'add',selection:select('other-1')},'bad')),/active senses/);
  assert.equal(getVocabularyLearnerWord('distil'),null);
  assert.throws(() => runVocabularyIntakeCommand(card.id,{...request(card,{type:'add',selection:card.selection},'stale'),
    versions:{...card.versions,catalog:0}}),ChatConflictError);
  const add = request(card,{type:'add',selection:card.selection},'add');
  const added = runVocabularyIntakeCommand(card.id,add);
  assert.deepEqual(runVocabularyIntakeCommand(card.id,add),added);
  assert.equal(getVocabularyLearnerWord('distil')?.intendedUseText,'model distillation');
  const created = added.selection.targetSenseId!;
  assert.equal(added.senses.find(sense=>sense.senseId===created)?.isDefault,false);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_owned_user_word_priority WHERE word_id='distil'").get()?.n,1);
  assert.equal(listVocabularyIntakeFindings().length,1);
  bob(() => {
    assert.throws(() => getVocabularyIntakeCard(card.id),/not found/);
    assert.deepEqual(getVocabularyIntakeHistory().turns,[]);
    assert.equal(getVocabularyLearnerWord('distil'),null);
    assert.equal(getVocabularySenses('distil').length,3);
  });
  const undone = runVocabularyIntakeCommand(card.id,request(added,{type:'undo'},'undo'));
  assert.equal(undone.state,'proposed');
  assert.equal(getVocabularyLearnerWord('distil'),null);
  assert.equal(getVocabularyWordSchedule('distil'),null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_owned_user_word_priority WHERE word_id='distil'").get()?.n,0);
  assert.equal(getVocabularySenses('distil').length,3);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}));
test('malformed model IDs, cards and quoted contexts fail before publication', async () => alice(async () => {
  await assert.rejects(send('纠结',[lookup('纠结')],draft('other','bare','纠结',select('other-1'))),/looked up/);
  await assert.rejects(send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('other-1'))),/active senses/);
  await assert.rejects(send('蒸馏',[lookup('蒸馏')],draft('distil','context_match','蒸馏',
    {...select('distil-1'),targetSenseId:'distil-1'},{context:'invented learner sentence'})),/quoted/);
  assert.equal(getVocabularyIntakeHistory().cards.length,0);
  assert.ok(getVocabularyIntakeHistory().turns.every(turn => turn.status === 'failed'));
}));
test('retries replay latest card state after disconnect or provider stand-down', async () => alice(async () => {
  const first = await send('纠结',[lookup('纠结')],draft('torn','bare','纠结',select('torn-1')));
  const { card } = first; assert.ok(card);
  const updated = runVocabularyIntakeCommand(card.id,request(card,{type:'set_senses',selection:select('torn-2')},'select'));
  const events: VocabularyIntakeStreamEvent[] = [];
  db.exec("UPDATE service_controls SET enabled=0 WHERE control_key='provider_work_enabled'");
  const replay = await sendVocabularyIntakeTurn({ clientTurnId:'纠结',text:'纠结',provider:trace([],() => assert.fail('unexpected provider retry')),
    publish:event=>events.push(event) });
  assert.equal(replay,first.turnId); assert.deepEqual(events.at(-1),{type:'completion',assistantText:'A short explanation.',cards:[updated]});
  assert.equal(getVocabularyIntakeHistory().cards[0]?.id,card.id);
}));
test('Undo protects a later manual change and a retained session that already admitted the word', async () => alice(async () => {
  const {card} = await send('纠结',[lookup('纠结')],draft('torn','bare','纠结',select('torn-1'))); assert.ok(card);
  db.prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,status)
    VALUES ('held','alice',1,?,?,'active')`).run(JSON.stringify({words:[{wordId:'torn'}]}),new Date().toISOString());
  assert.equal(getCard(card.id).actions.includes('undo'),false);
  assert.throws(() => runVocabularyIntakeCommand(card.id,request(card,{type:'undo'},'held')),ChatConflictError);
  const {card:gang} = await send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2'))); assert.ok(gang);
  const word = getVocabularyLearnerWord('gang')!; changeVocabularyMode('gang','solidify',word.stateVersion);
  const latest = getCard(gang.id);
  assert.equal(latest.actions.includes('undo'),false);
  assert.throws(() => runVocabularyIntakeCommand(gang.id,request(latest,{type:'undo'},'practised')),ChatConflictError);
  assert.equal(getVocabularyLearnerWord('gang')?.mode,'solidify');
}));
test('Undo restores a prior dismissed row and schedule instead of deleting its private history', async () => alice(async () => {
  const before = dismissVocabularyWord(addVocabularyWord('torn','earlier context').wordId);
  const schedule = getVocabularyWordSchedule('torn');
  const {card} = await send('纠结 - picking a plan',[lookup('纠结')],draft('torn','context_match','纠结',
    {...select('torn-1'),targetSenseId:'torn-1'},{context:'picking a plan'}));
  assert.ok(card); assert.equal(getVocabularyLearnerWord('torn')?.dismissedAt,null);
  runVocabularyIntakeCommand(card.id,request(card,{type:'undo'},'undo'));
  const restored = getVocabularyLearnerWord('torn')!;
  assert.equal(restored.dismissedAt,before.dismissedAt); assert.equal(restored.intendedUseText,before.intendedUseText);
  assert.deepEqual(getVocabularyWordSchedule('torn'),schedule);
}));
test('a deferred successful match releases admission and preserves Undo after the worker scope write', async () => alice(async () => {
  const { card } = await send('绵长 - sustained tenderness',[lookup('绵长')],draft('lingering','inventory_pending','绵长',select(),{context:'sustained tenderness'}));
  assert.ok(card);
  establish('lingering',['lingering-1']);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO learner_word_preparation_reserve(learner_id,word_id,added_at,ready_at,checked_at)
    VALUES ('alice','lingering',?,?,?)`).run(initial,now,now);
  const held = composeVocabularyStudy({now,teachingReady:()=>true});
  assert.equal(held.newWordIds.includes('lingering'),false);
  assert.equal(held.preparationPending,true);
  await createVocabularyIntakeWorker({ match: async work => {
    assert.equal(work.context,'sustained tenderness');
    assert.equal(hasPendingVocabularyIntakeMatch('lingering'),true);
    return 'lingering-2';
  } }).stepMatch();
  const updated = getCard(card.id);
  assert.equal(updated.state,'added');
  assert.equal(updated.attention,null);
  assert.deepEqual(updated.selection,{senseIds:['lingering-1','lingering-2'],targetSenseId:'lingering-2',includeProposedSense:false});
  assert.equal(hasPendingVocabularyIntakeMatch('lingering'),false);
  assert.equal(composeVocabularyStudy({now,teachingReady:()=>true}).newWordIds.includes('lingering'),true);
  runVocabularyIntakeCommand(card.id,request(updated,{type:'undo'},'undo'));
  assert.equal(getVocabularyLearnerWord('lingering'),null); assert.equal(getVocabularySenses('lingering').length,2);
}));
for (const outcome of ['ambiguous','provider error','bad reference','inventory failure'] as const) {
  test(`deferred ${outcome} keeps the enrollment and falls back to defaults with attention`, async () => alice(async () => {
    const { card } = await send('绵长 - sustained tenderness',[lookup('绵长')],draft('lingering','inventory_pending','绵长',select(),{context:'sustained tenderness'}));
    assert.ok(card);
    if (outcome === 'inventory failure') db.exec("UPDATE vocabulary_sense_readiness SET status='failed' WHERE word_id='lingering'");
    else establish('lingering',['lingering-1']);
    await createVocabularyIntakeWorker({ match: async () => {
      if (outcome === 'provider error') throw new Error('provider unavailable');
      if (outcome === 'inventory failure') assert.fail('do not call match without inventory');
      return outcome === 'bad reference' ? 'other-1' : null;
    } }).stepMatch();
    const updated = getCard(card.id);
    assert.ok(updated.attention); assert.equal(updated.state,'added');
    assert.equal(hasPendingVocabularyIntakeMatch('lingering'),false);
    assert.equal(getVocabularyLearnerWord('lingering')?.intendedUseText,'sustained tenderness');
    assert.deepEqual(resolveVocabularyLearnerSenseScope('lingering').choices,[]);
    assert.equal(listVocabularyIntakeCards(true)[0]?.id,card.id);
  }));
}
test('a completed deferred provider result cannot restore an enrollment the learner already undid', async () => alice(async () => {
  const { card } = await send('绵长 - sustained tenderness',[lookup('绵长')],draft('lingering','inventory_pending','绵长',select(),{context:'sustained tenderness'}));
  assert.ok(card);
  establish('lingering',['lingering-1']);
  await createVocabularyIntakeWorker({ match: async () => {
    const claimed = getCard(card.id);
    runVocabularyIntakeCommand(card.id,request(claimed,{type:'undo'},'undo'));
    return 'lingering-2';
  } }).stepMatch();
  assert.equal(getVocabularyLearnerWord('lingering'),null);
  assert.equal(getCard(card.id).state,'proposed');
}));
test('lookup of an established unknown-default word queues selection but holds edited choices until ready', async () => alice(async () => {
  establish('ease',null);
  const { card } = await send('怡然',[lookup('怡然')],draft('ease','proposal','怡然',select('ease-2')));
  assert.ok(card);
  assert.equal(card.defaultsEstablished,false); assert.equal(card.actions.includes('add'),false);
  assert.equal(db.prepare("SELECT status FROM vocabulary_default_selection_readiness WHERE word_id='ease'").get()?.status,'queued');
  assert.throws(() => runVocabularyIntakeCommand(card.id,request(card,{type:'add',selection:card.selection},'premature')),/Wait for the shared/);
  await createVocabularyIntakeWorker({ defaults: async wordId => {
    assert.equal(wordId,'ease');
    writeVocabularyDefaultUsefulSenses(wordId,0,['ease-1'],operator);
    return getVocabularyWordSenseCoverage(wordId);
  } }).stepPrerequisite();
  const refreshed = getCard(card.id);
  assert.equal(refreshed.defaultsEstablished,true);
  assert.deepEqual(refreshed.selection.senseIds,['ease-2']);
  assert.equal(refreshed.actions.includes('add'),true);
  assert.throws(() => runVocabularyIntakeCommand(card.id,request(card,{type:'add',selection:card.selection},'stale')),ChatConflictError);
}));
test('recovery settles expired interrupted turns without replaying an already committed card', async () => alice(async () => {
  const conversation = intakeConversationId();
  const { turn: empty } = startChatTurn(conversation,'crashed',{text:'crashed'});
  const { turn: saved } = startChatTurn(conversation,'saved',{text:'saved'});
  createChatCard(saved.id,{ wordId:'torn',proposal:true,enrollmentAddedAt:null,selection:select('torn-1'),proposedSense:null,context:null,pending:null,undo:null,attention:null });
  db.exec("UPDATE learner_chat_turns SET created_at='2026-01-01T00:00:00.000Z'");
  recoverVocabularyIntakeTurns();
  assert.equal(getChatTurn(empty.id)?.status,'failed'); assert.equal(getChatTurn(saved.id)?.status,'completed');
  const events: VocabularyIntakeStreamEvent[] = [];
  assert.equal(await sendVocabularyIntakeTurn({ clientTurnId:'saved',text:'saved',provider:trace([],() => assert.fail('unexpected replay')),
    publish:event=>events.push(event) }),saved.id);
  assert.equal(events.at(-1)?.type,'completion');
}));

test('terminal explanation failure rolls back enrollment and cards and never exposes raw provider prose',async()=>alice(async()=>{
  db.exec(`CREATE TRIGGER reject_intake_completion BEFORE INSERT ON learner_chat_events
    WHEN json_extract(NEW.event_json,'$.kind')='completion' BEGIN SELECT RAISE(ABORT,'completion unavailable'); END`);
  await assert.rejects(send('纠结',[lookup('纠结')],draft('torn','bare','纠结',select('torn-1'))),/completion unavailable/);
  assert.equal(getVocabularyLearnerWord('torn'),null);
  const history=getVocabularyIntakeHistory();assert.equal(history.cards.length,0);
  assert.equal(history.turns[0]?.assistantText,'');assert.equal(history.turns[0]?.status,'failed');
}));

function revision(card: VocabularyIntakeCard, action: IntakeCardRevision['action'],
  selection: IntakeCardRevision['selection'] = null, extra: Partial<IntakeCardRevision> = {}): IntakeCardRevision {
  return { cardId:card.id,action,selection,context:null,proposedSense:null,...extra };
}
const reviseCall = (value: IntakeCardRevision): Call => ({ name:'revise_card',arguments:value as unknown as JsonValue });

test('follow-up uses recent prose and current card state, never another learner or old tool authority', async () => {
  const first = await alice(()=>send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2'))));
  alice(()=>runVocabularyIntakeCommand(first.card!.id,request(first.card!,{type:'set_senses',selection:select('gang-2')},'manual')));
  await bob(()=>send('私人说明',[lookup('具体')],draft('other','proposal',null,select('other-1'))));
  await alice(async()=>{
    let seen = false;
    await sendVocabularyIntakeTurn({ clientTurnId:'why',text:'Why that meaning?',publish:()=>{},provider:{async stream(input) {
      const serialized=JSON.stringify(input.messages);
      assert.ok(serialized.includes('帮派'));assert.ok(serialized.includes('A short explanation.'));
      assert.ok(!serialized.includes('私人说明'));assert.ok(!serialized.includes('providerOutput'));
      const context=vocabularyIntakeContext(intakeConversationId());
      assert.deepEqual(context.cards.get(first.card!.id)?.selection.senseIds,['gang-2']);
      assert.equal(input.messages.at(-1)?.content,'Why that meaning?');seen=true;
      return {invocationId:null,responseId:null,usage:null,message:{role:'assistant',content:'Ignored unfinished prose.',toolCalls:[{id:'answer',name:'complete_turn',arguments:JSON.stringify({explanation:'An explanation.',action:{kind:'answer'}})}]}};
    }}});
    assert.ok(seen);assert.deepEqual(getCard(first.card!.id).selection.senseIds,['gang-2']);
    assert.equal(listVocabularyIntakeCards(false).length,1);
  });
});

test('a conversational sense edit updates the same card in history and replays without another mutation', async()=>alice(async()=>{
  const first=await send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2')));
  const next=await send('Only the second meaning',[reviseCall(revision(first.card!,'set_senses',select('gang-2')))]);
  assert.equal(next.card?.id,first.card?.id);assert.deepEqual(next.card?.selection.senseIds,['gang-2']);
  assert.equal(next.card?.version,first.card!.version+1);assert.equal(listVocabularyIntakeCards(false).length,1);
  const history=getVocabularyIntakeHistory();
  assert.equal(history.turns.filter(turn=>turn.cardIds.includes(first.card!.id)).length,2);
  assert.ok(history.cards.every(card=>card.selection.senseIds.join(',')==='gang-2'));
  const replay=await send('Only the second meaning',[]);
  assert.equal(replay.card?.version,next.card?.version);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learner_chat_commands').get()!.n,1);
}));

test('proposal selections and revised sense descriptions stay private until explicit Add', async()=>alice(async()=>{
  const first=await send('蒸馏 in AI',[lookup('蒸馏')],draft('distil','proposal','蒸馏',select('distil-1'),{
    proposedSense:{label:'Distil a model',notes:['Transfer capabilities into a smaller model.']}}));
  const count=getVocabularySenses('distil').length;
  const selected=await send('Only the AI meaning',[reviseCall(revision(first.card!,'set_senses',{
    senseIds:[],targetSenseId:null,includeProposedSense:true}))]);
  assert.equal(selected.card?.state,'proposed');assert.equal(getVocabularyLearnerWord('distil'),null);
  const clarified=await send('I mean knowledge transfer in model training',[reviseCall(revision(selected.card!,'revise_proposal',{
    senseIds:[],targetSenseId:null,includeProposedSense:true},{proposedSense:{label:'Transfer knowledge into a smaller model',notes:['技术上称为模型蒸馏。']}}))]);
  assert.equal(clarified.card?.id,first.card?.id);assert.equal(clarified.card?.state,'proposed');
  assert.equal(getVocabularySenses('distil').length,count);assert.equal(getVocabularyLearnerWord('distil'),null);
  runVocabularyIntakeCommand(clarified.card!.id,request(clarified.card!,{type:'add',selection:clarified.card!.selection},'explicit-add'));
  assert.equal(getVocabularySenses('distil').length,count+1);
}));

test('explicit conversational Undo has the same learner-only effects and invalidation as the button', async()=>alice(async()=>{
  const first=await send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2')));
  const count=getVocabularySenses('gang').length;
  const undone=await send('Undo that add',[reviseCall(revision(first.card!,'undo'))]);
  assert.equal(undone.card?.id,first.card?.id);assert.equal(undone.card?.state,'proposed');
  assert.equal(getVocabularyLearnerWord('gang'),null);assert.equal(getVocabularySenses('gang').length,count);
  await assert.rejects(send('Undo it again',[reviseCall(revision(undone.card!,'undo'))]),/cannot be undone/);
}));

test('a card edited while the model responds cannot be overwritten by the conversational revision', async()=>alice(async()=>{
  const first=await send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2')));
  const provider=trace([reviseCall(revision(first.card!,'set_senses',select('gang-2')))],()=>{
    runVocabularyIntakeCommand(first.card!.id,request(first.card!,{type:'set_senses',selection:select('gang-1')},'concurrent'));
  });
  await assert.rejects(sendVocabularyIntakeTurn({clientTurnId:'stale-reply',text:'Only the second sense',provider,publish:()=>{}}),/changed while/);
  assert.deepEqual(getCard(first.card!.id).selection.senseIds,['gang-1']);
  assert.equal(getVocabularyIntakeHistory().turns.find(turn=>turn.userText==='Only the second sense')?.cardIds.length,0);
}));

test('follow-up card IDs and unsupported Add actions cannot bypass ownership or confirmation', async()=>{
  const first=await alice(()=>send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2'))));
  await bob(async()=>{
    await assert.rejects(send('Undo that add',[reviseCall(revision(first.card!,'undo'))]),/supplied recent context/);
    assert.equal(listVocabularyIntakeCards(false).length,0);
  });
  await alice(async()=>{
    const bad={...revision(first.card!,'undo'),action:'add'};
    await assert.rejects(send('Yes add it',[{name:'revise_card',arguments:bad as unknown as JsonValue}]),/Invalid complete_turn/);
    assert.ok(getVocabularyLearnerWord('gang'));
    await assert.rejects(send('Use an invented sense',[reviseCall(revision(first.card!,'set_senses',select('other-1')))]),/active senses/);
  });
});

test('revision and durable turn attachment roll back together if the turn is from another surface', async()=>alice(async()=>{
  const first=await send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2')));
  const turn=startChatTurn(getOrCreateChatConversation('other-surface'),'wrong-surface',{}).turn;
  assert.throws(()=>reviseVocabularyIntakeCard(turn.id,first.card!,revision(first.card!,'set_senses',select('gang-2'))),/running conversation/);
  assert.deepEqual(getCard(first.card!.id).selection.senseIds,['gang-1','gang-2']);
  assert.equal(getCard(first.card!.id).version,first.card!.version);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learner_chat_commands').get()!.n,0);
}));

test('recovery recognizes a committed revision and reconnect returns its original card identity', async()=>alice(async()=>{
  const first=await send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2')));
  const turn=startChatTurn(intakeConversationId(),'crashed-revision',{text:'Only the second meaning'}).turn;
  reviseVocabularyIntakeCard(turn.id,first.card!,revision(first.card!,'set_senses',select('gang-2')));
  db.prepare("UPDATE learner_chat_turns SET created_at='2026-01-01' WHERE id=?").run(turn.id);
  recoverVocabularyIntakeTurns();assert.equal(getChatTurn(turn.id)?.status,'completed');
  const replay=await send('Only the second meaning',[],undefined,'crashed-revision');
  assert.equal(replay.card?.id,first.card?.id);assert.deepEqual(replay.card?.selection.senseIds,['gang-2']);
}));

test('retained follow-up context has bounded recent messages and live card count',async()=>alice(async()=>{
  for(let i=0;i<9;i++){
    const result=await send(`message-${i}`,[lookup('帮派')],draft('gang','proposal',null,select('gang-1')),`bounded-${i}`);
    db.prepare('UPDATE learner_chat_turns SET created_at=? WHERE id=?').run(`2026-01-${String(i+1).padStart(2,'0')}`,result.turnId);
  }
  const context=vocabularyIntakeContext(intakeConversationId());
  assert.equal(context.cards.size,4);
  const text=JSON.stringify(context.messages);
  assert.ok(!text.includes('message-0'));assert.ok(text.includes('message-8'));
  assert.ok(text.length<34_000);
}));


test('clarifications can quote recent learner spelling and context without gaining automatic add authority', async()=>alice(async()=>{
  await send('接发 — tennis',[]);
  const clarified = await send('The return itself',[lookup('接发球')],
    draft('return','larger_expression','接发',select('return-1'),{context:'tennis'}));
  assert.equal(clarified.card?.state,'proposed'); assert.equal(getVocabularyLearnerWord('return'),null);
  await send('纠结',[]);
  const fragment = await send('Yes, that word',[lookup('纠结')],draft('torn','bare','纠结',select('torn-1')));
  assert.equal(fragment.card?.state,'proposed'); assert.equal(getVocabularyLearnerWord('torn'),null);
  await assert.rejects(send('Invented earlier spelling',[lookup('具体')],draft('other','proposal','具体',select('other-1'))),/quoted from the learner/);
}));


test('failed final persistence rolls back a conversational revision, its receipt and turn attachment', async()=>alice(async()=>{
  const first=await send('帮派',[lookup('帮派')],draft('gang','bare','帮派',select('gang-1','gang-2')));
  db.exec(`CREATE TRIGGER reject_revision_completion BEFORE INSERT ON learner_chat_events
    WHEN json_extract(NEW.event_json,'$.kind')='completion' BEGIN SELECT RAISE(ABORT,'completion rejected'); END`);
  await assert.rejects(send('Only the second meaning',[reviseCall(revision(first.card!,'set_senses',select('gang-2')))]),/completion rejected/);
  assert.equal(getCard(first.card!.id).version,first.card!.version);
  assert.deepEqual(getCard(first.card!.id).selection.senseIds,['gang-1','gang-2']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learner_chat_commands').get()!.n,0);
  const failed=getVocabularyIntakeHistory().turns.find(turn=>turn.userText==='Only the second meaning')!;
  assert.equal(failed.status,'failed'); assert.equal(failed.assistantText,''); assert.deepEqual(failed.cardIds,[]);
}));

async function existingSenseProposal(clientTurnId = 'existing-sense') {
  return send('蒸馏 in AI model distillation',[lookup('蒸馏')],draft('distil','proposal','蒸馏',
    {...select('distil-1'),includeProposedSense:true},
    {proposedSense:{label:'Distil a model',notes:['Transfer a larger model’s knowledge to a smaller model, as in 把大模型蒸馏成小模型。']}}),clientTurnId);
}
function practiceDistil() {
  const word=addVocabularyWord('distil');
  changeVocabularyMode('distil','practice',word.stateVersion);
}

test('a new sense can repair an enrolled word with an established empty active inventory',async()=>alice(async()=>{
  practiceDistil();
  for(const sense of getVocabularySenses('distil'))updateVocabularySense(sense.senseId,sense.version,
    {description:sense.description,status:'retired'},operator);
  const scope=resolveVocabularyLearnerSenseScope('distil');
  writeVocabularyDefaultUsefulSenses('distil',scope.selectionVersion,[],operator);
  const {card}=await send('蒸馏 in AI model distillation',[lookup('蒸馏')],draft('distil','proposal','蒸馏',
    {...select(),includeProposedSense:true},{proposedSense:{label:'Distil a model',notes:['Transfer a larger model’s knowledge to a smaller model.']}}));
  assert.ok(card);assert.equal(card.attention,null);assert.ok(card.actions.includes('add_sense'));
  const added=runVocabularyIntakeCommand(card.id,request(card,{type:'add_sense'},'repair-empty'));
  assert.equal(added.selection.senseIds.length,1);assert.equal(added.state,'already-studying');
}));

test('an existing-word proposal creates nothing until Add sense, then preserves progress and all prior choices',async()=>alice(async()=>{
  practiceDistil();
  db.prepare("INSERT INTO learner_senses VALUES ('alice','distil','distil-1','active'),('alice','distil','distil-2','excluded')").run();
  const beforeWord=getVocabularyLearnerWord('distil')!, beforeSchedule=getVocabularyWordSchedule('distil');
  const beforeDefaults=getVocabularyWordSenseCoverage('distil'), beforeCount=getVocabularySenses('distil').length;
  const {card}=await existingSenseProposal(); assert.ok(card);
  assert.equal(card.state,'sense-proposed'); assert.deepEqual(card.actions,['add_sense']);
  assert.ok(listVocabularyIntakeCards(true).some(entry=>entry.id===card.id));
  assert.deepEqual(getVocabularyLearnerWord('distil'),beforeWord); assert.equal(getVocabularySenses('distil').length,beforeCount);
  const confirmation=request(card,{type:'add_sense'},'confirm-sense');
  const added=runVocabularyIntakeCommand(card.id,confirmation);
  assert.equal(added.state,'already-studying'); assert.equal(added.proposedSense,null);
  assert.equal(added.selection.targetSenseId,null);assert.ok(added.addedSenseId);
  assert.deepEqual(added.actions,['change_senses']);
  const addedSense=getVocabularySenses('distil').find(s=>s.description && typeof s.description==='object' && !Array.isArray(s.description) && s.description.label==='Distil a model')!;
  assert.ok(addedSense); assert.equal(getVocabularySenses('distil').length,beforeCount+1);
  const afterScope=resolveVocabularyLearnerSenseScope('distil');
  assert.deepEqual(afterScope.choices,[{senseId:'distil-1',disposition:'active'},{senseId:'distil-2',disposition:'excluded'},
    {senseId:addedSense.senseId,disposition:'active'}].sort((a,b)=>a.senseId.localeCompare(b.senseId)));
  const {stateVersion:beforeVersion,scopeEstablishedAt:_beforeAt,...beforeRest}=beforeWord;
  const {stateVersion:afterVersion,scopeEstablishedAt:_afterAt,...afterRest}=getVocabularyLearnerWord('distil')!;
  assert.deepEqual(afterRest,beforeRest); assert.equal(afterVersion,beforeVersion+1);
  assert.deepEqual(getVocabularyWordSchedule('distil'),beforeSchedule);
  assert.deepEqual(getVocabularyWordSenseCoverage('distil'),beforeDefaults);
  assert.ok(db.prepare("SELECT 1 FROM vocabulary_practice_preparation WHERE word_id='distil'").get());
  assert.deepEqual(runVocabularyIntakeCommand(card.id,confirmation),added);
  assert.equal(getVocabularySenses('distil').length,beforeCount+1);
  assert.equal(runWithLearnerId('bob',()=>resolveVocabularyLearnerSenseScope('distil').includedSenseIds.includes(addedSense.senseId)),false);
  assert.throws(()=>runVocabularyIntakeCommand(card.id,request(added,{type:'undo'},'no-enrollment-undo')),/cannot be undone/);
}));

test('Add sense rejects stale choices and applies only the addition after a current reload',async()=>alice(async()=>{
  practiceDistil();const {card}=await existingSenseProposal();assert.ok(card);
  const scope=resolveVocabularyLearnerSenseScope('distil');
  writeVocabularyLearnerSenseScope('distil',{senseIds:['distil-2'],expectedStateVersion:scope.stateVersion!,
    expectedCatalogVersion:scope.catalogVersion,expectedSelectionVersion:scope.selectionVersion,surface:'other-control'});
  assert.throws(()=>runVocabularyIntakeCommand(card.id,request(card,{type:'add_sense'},'stale-sense')),/changed/);
  assert.equal(getVocabularySenses('distil').length,2);
  const current=getCard(card.id);assert.deepEqual(current.selection.senseIds,['distil-2']);
  const added=runVocabularyIntakeCommand(card.id,request(current,{type:'add_sense'},'fresh-sense'));
  assert.ok(!added.selection.senseIds.includes('distil-1'));assert.ok(added.selection.senseIds.includes('distil-2'));
  assert.equal(added.selection.senseIds.length,2);
}));

test('new-sense confirmation cannot reenroll a dismissed word or cross proposal kinds',async()=>alice(async()=>{
  practiceDistil();const {card}=await existingSenseProposal();assert.ok(card);
  assert.throws(()=>runVocabularyIntakeCommand(card.id,request(card,{type:'add',selection:card.selection},'wrong-add')),/no longer available/);
  const word=getVocabularyLearnerWord('distil')!;dismissVocabularyWord('distil',word.stateVersion);
  const dismissed=getCard(card.id);assert.ok(!dismissed.actions.includes('add_sense'));assert.match(dismissed.attention!,/no longer/);
  assert.throws(()=>runVocabularyIntakeCommand(card.id,request(dismissed,{type:'add_sense'},'dismissed-sense')),/no longer available/);
  assert.equal(getVocabularySenses('distil').length,2);
  assert.ok(getVocabularyLearnerWord('distil')?.dismissedAt);
}));

test('duplicate shared senses and failed learner writes leave no partial sense publication',async()=>alice(async()=>{
  practiceDistil();const {card}=await existingSenseProposal();assert.ok(card);
  const beforeCatalog=getVocabularySenseCatalog('distil');
  db.exec(`CREATE TEMP TRIGGER fail_new_take_up BEFORE INSERT ON learner_senses
    WHEN NEW.sense_id NOT IN ('distil-1','distil-2') BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
  assert.throws(()=>runVocabularyIntakeCommand(card.id,request(card,{type:'add_sense'},'failed-write')),/fixture failure/);
  assert.equal(getVocabularySenses('distil').length,2);assert.deepEqual(getVocabularySenseCatalog('distil'),beforeCatalog);
  assert.equal(getCard(card.id).version,card.version);
  db.exec('DROP TRIGGER fail_new_take_up');
  createVocabularySense({wordId:'distil',description:{label:'Distil a model',notes:['Existing elsewhere.']}},operator);
  const duplicate=getCard(card.id);assert.ok(!duplicate.actions.includes('add_sense'));assert.match(duplicate.attention!,/already in the inventory/);
  assert.throws(()=>runVocabularyIntakeCommand(card.id,request(duplicate,{type:'add_sense'},'duplicate')),/already in the inventory/);
  assert.equal(getVocabularySenses('distil').length,3);
}));

test('sense-proposal clarification remains private and chat cannot confirm or silently select it',async()=>alice(async()=>{
  practiceDistil();const {card}=await existingSenseProposal();assert.ok(card);
  const clarified=await send('Clarify knowledge transfer',[reviseCall(revision(card,'revise_proposal',card.selection,
    {proposedSense:{label:'Transfer knowledge into a smaller model',notes:['把大模型蒸馏成小模型。']}}))]);
  assert.equal(clarified.card?.id,card.id);assert.equal(clarified.card?.state,'sense-proposed');
  assert.equal(getVocabularySenses('distil').length,2);
  await assert.rejects(send('Only the new sense',[reviseCall(revision(clarified.card!,'set_senses',{
    senseIds:[],targetSenseId:null,includeProposedSense:true}))]),/Confirm Add sense/);
  await assert.rejects(send('Yes add sense',[{name:'revise_card',arguments:{...revision(clarified.card!,'undo'),action:'add_sense'} as unknown as JsonValue}]),/Invalid complete_turn/);
  const added=runVocabularyIntakeCommand(card.id,request(clarified.card!,{type:'add_sense'},'confirmed-clarification'));
  assert.equal(added.proposedSense,null);assert.equal(getVocabularySenses('distil').length,3);
}));

test('a stashed unstudied word waits for teaching covering the newly confirmed sense set',async()=>alice(async()=>{
  await send('蒸馏',[lookup('蒸馏')],draft('distil','bare','蒸馏',select('distil-1')));
  const {card}=await existingSenseProposal();assert.ok(card);
  const added=runVocabularyIntakeCommand(card.id,request(card,{type:'add_sense'},'unstudied-confirm'));
  assert.equal(added.state,'added');assert.equal(getVocabularyLearnerWord('distil')?.mode,'unstudied');
  assert.ok(!added.actions.includes('undo'));
}));


test('a new-sense confirmation waits for an earlier deferred context match instead of invalidating it',async()=>alice(async()=>{
  await send('蒸馏',[lookup('蒸馏')],draft('distil','bare','蒸馏',select('distil-1')));
  const scope=resolveVocabularyLearnerSenseScope('distil');
  const turn=startChatTurn(intakeConversationId(),'deferred-fixture',{text:'蒸馏 - a saved context'}).turn;
  const pending=createChatCard(turn.id,{wordId:'distil',proposal:false,enrollmentAddedAt:getVocabularyLearnerWord('distil')!.addedAt,
    selection:select('distil-1'),proposedSense:null,context:'a saved context',pending:{expectedLearnerVersion:scope.stateVersion,lease:null},undo:null,attention:null});
  const {card}=await existingSenseProposal();assert.ok(card);
  assert.ok(!card.actions.includes('add_sense'));assert.match(card.attention!,/earlier context match/);
  assert.throws(()=>runVocabularyIntakeCommand(card.id,request(card,{type:'add_sense'},'while-pending')),/earlier context match/);
  assert.equal(getVocabularySenses('distil').length,2);assert.equal(hasPendingVocabularyIntakeMatch('distil'),true);
  const finished=completeIntakeContextMatch(pending,'distil-2');
  updateChatCard(pending.id,pending.version,finished as unknown as JsonValue);
  const ready=getCard(card.id);assert.ok(ready.actions.includes('add_sense'));assert.equal(ready.attention,null);
  const result=runVocabularyIntakeCommand(card.id,request(ready,{type:'add_sense'},'after-match'));
  assert.ok(result.selection.senseIds.includes('distil-2'));assert.equal(result.selection.senseIds.length,3);
}));
