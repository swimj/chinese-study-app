import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length+3);
const source = path.resolve(option('source') ?? process.cwd());
const live = process.argv.includes('--execute');
const dryRun = process.argv.includes('--dry-run');
if (live === dryRun) throw new Error('Select exactly one of --execute or --dry-run');
if (live && !process.env.OPENAI_API_KEY?.trim()) throw new Error('Load the local environment file before starting the live trial');
const variant = option('variant') ?? (dryRun ? 'dry-run' : null);
if (!variant || !/^[a-z0-9-]{1,64}$/.test(variant)) throw new Error('Supply a unique lowercase --variant=... name');
const artifactPath = `/private/tmp/chinese-study-intake-live-2026-11-15-${variant}`;
const fixtureDate = '2026-11-15T00:00:00.000Z';
const copyFrom = (file: string) => import(pathToFileURL(path.join(source,file)).href);
const { createBaselineFixture } = await copyFrom('tests/helpers/baseline-database.ts');
const { migrateDatabase } = await copyFrom('server/db/migrations.ts');
const { setDb } = await copyFrom('server/db/connection.ts');
const { installLearnerContextSqlFunction, runWithLearnerId } = await copyFrom('server/db/learner-context.ts');
const { createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog } = await copyFrom('server/db/vocabulary-content.ts');
const { writeVocabularyDefaultUsefulSenses } = await copyFrom('server/db/vocabulary-sense-coverage.ts');
const { addVocabularyWord, changeVocabularyMode, getVocabularyLearnerWord } = await copyFrom('server/db/vocabulary-learners.ts');
const { resolveVocabularyLearnerSenseScope } = await copyFrom('server/db/vocabulary-learner-senses.ts');
const { getVocabularyIntakeHistory, INTAKE_MODEL, intakePrompt, makeVocabularyIntakeProvider, sendVocabularyIntakeTurn } = await copyFrom('server/vocabulary/intake-chat.ts');
const { installModelInvocationLedger } = await copyFrom('server/llm/invocation-ledger.ts');

type Sense = [id: string, label: string, notes: string[], useByDefault: boolean];
type Lexical = {
  id: string; hanzi: string; traditional: string | null; pinyin: string; gloss: string; priority: number;
  senses?: Sense[];
};
const lexical: Lexical[] = [
  { id:'gang',hanzi:'帮派',traditional:'幫派',pinyin:'bāngpài',gloss:'gang; faction',priority:95,senses:[
    ['gang-crime','A gang or organized criminal group',['这些年轻人跟一个帮派有点关系.'],true],
    ['gang-faction','A faction or clique within a larger group',['Can refer to factions within a party or an organization, as in 党内帮派.'],true],
  ] },
  { id:'punk',hanzi:'混混',traditional:null,pinyin:'hùnhun',gloss:'punk; idler or petty troublemaker',priority:35,senses:[
    ['punk-petty','An idler or petty troublemaker',['Colloquial and disparaging.'],true],
  ] },
  { id:'lingering',hanzi:'绵长',traditional:'綿長',pinyin:'miáncháng',gloss:'long and continuous; lingering',priority:45 },
  { id:'return',hanzi:'接发球',traditional:'接發球',pinyin:'jiēfāqiú',gloss:'return serve; return of a serve',priority:24,senses:[
    ['return-serve','To return serve; the return of serve',['A tennis, table tennis or badminton term. 他的接发球很稳.'],true],
  ] },
  { id:'returner',hanzi:'接发球方',traditional:'接發球方',pinyin:'jiēfāqiúfāng',gloss:'the side receiving a serve',priority:20,senses:[
    ['returner-side','The receiving side in a serve',['The party that receives and returns the serve.'],true],
  ] },
  { id:'torn',hanzi:'纠结',traditional:'糾結',pinyin:'jiūjié',gloss:'torn; conflicted; tangled; to band together',priority:110,senses:[
    ['torn-conflicted','Torn or conflicted over a choice',['Natural in 我很纠结要不要去.'],true],
    ['torn-tangled','Entangled or knotted together',['Physical or figurative, as in 两股绳子纠结在一起.'],true],
    ['torn-band','To gather or band together',['Dated; usually written 纠集 in this meaning today.'],false],
  ] },
  { id:'dense',hanzi:'致密',traditional:null,pinyin:'zhìmì',gloss:'dense; compact; meticulous',priority:26,senses:[
    ['dense-compact','Dense and compact in texture or structure',['Used of rock, bone and other materials. 这种岩石的结构非常致密.'],false],
    ['dense-meticulous','Meticulous or tightly reasoned',['Literary or formal, of a tightly organized argument or composition.'],false],
  ] },
  { id:'doting',hanzi:'宠溺',traditional:'寵溺',pinyin:'chǒngnì',gloss:'to dote on; spoil; show indulgence',priority:64,senses:[
    ['doting-spoil','To spoil, dote on or indulge someone',['The verb can take a child or another person as its object.'],true],
    ['doting-look','Doting or indulgent in expression or manner',['Familiar in fiction, as in 宠溺的眼神 or 宠溺地笑了.'],false],
  ] },
  { id:'content',hanzi:'怡然自得',traditional:null,pinyin:'yírán zìdé',gloss:'contented and at ease; comfortable in one’s own enjoyment',priority:28,senses:[
    ['content-idiom','Contented and at ease',['A fixed four-character idiom describing someone absorbed in their enjoyment.'],true],
  ] },
  { id:'ease',hanzi:'怡然',traditional:null,pinyin:'yírán',gloss:'cheerful and at ease',priority:12,senses:[
    ['ease-literary','Cheerful and at ease',['Literary; often encountered inside 怡然自得.'],false],
  ] },
  { id:'pleased',hanzi:'自得',traditional:null,pinyin:'zìdé',gloss:'content in oneself; pleased with oneself',priority:25,senses:[
    ['pleased-self','Pleased or content in oneself',['Often in phrases, including 自得其乐 and 洋洋自得.'],true],
  ] },
  { id:'sponge',hanzi:'海绵',traditional:'海綿',pinyin:'hǎimián',gloss:'sponge; foam material; marine sponge',priority:75,senses:[
    ['sponge-cleaning','Sponge or resilient foam material',['Used for wiping, cleaning, padding or cushioning.'],true],
    ['sponge-animal','A sea sponge',['The aquatic animal.'],true],
  ] },
  { id:'asleep',hanzi:'睡眠',traditional:null,pinyin:'shuìmián',gloss:'sleep',priority:85,senses:[
    ['asleep-sleep','Sleep',['The state or duration of sleeping.'],true],
  ] },
  { id:'distil',hanzi:'蒸馏',traditional:'蒸餾',pinyin:'zhēngliú',gloss:'distill; distillation of liquids',priority:57,senses:[
    ['distil-liquid','To distil a liquid; chemical distillation',['Separate or purify using vaporization and condensation, as in 蒸馏酒.'],true],
  ] },
  { id:'outdated',hanzi:'过时',traditional:'過時',pinyin:'guòshí',gloss:'outdated; out of fashion',priority:79,senses:[
    ['outdated-fashion','Outdated or out of fashion',['Information, methods, styles or ideas that are no longer current.'],true],
  ] },
  { id:'deadline',hanzi:'过时不候',traditional:'過時不候',pinyin:'guòshí bù hòu',gloss:'late arrivals will not be waited for',priority:22,senses:[
    ['deadline-warning','Late arrivals will not be waited for',['A fixed warning that a deadline or departure time is firm.'],true],
  ] },
  { id:'foam',hanzi:'泡沫',traditional:null,pinyin:'pàomò',gloss:'foam; bubbles; economic bubble; foam material',priority:87,senses:[
    ['foam-bubbles','A mass of foam or bubbles',['As in the lather on top of a soapy liquid.'],true],
    ['foam-market','An economic bubble',['Inflated prices, as in 房地产泡沫.'],true],
    ['foam-material','Lightweight foam material',['Packaging or padding, as in 用泡沫垫着.'],true],
    ['foam-illusory','Something illusory or insubstantial',['A broader figurative use for something that lacks substance.'],false],
  ] },
];
const cases = [
  { id:'01-listed-context',text:'帮派 - came up in conversation discussing characters in a movie, young people who seem loosely tied to a criminal organization',
    expected:{ wordId:'gang',state:'preparing',target:'gang-crime',enrolled:true } },
  { id:'02-missing-inventory',text:'绵长 - in "用绵长、安静、不紧张的温柔..."',
    expected:{ wordId:'lingering',state:'preparing',enrolled:true,pending:true,context:'contains phrase verbatim' } },
  { id:'03-larger-expression',text:'接发 - specifically the word used in tennis broadcasts for the player receiving a serve',
    expected:{ wordId:'return',state:'proposed',enrolled:false,review:'Distinguish the return from the returner.' } },
  { id:'04-bare',text:'纠结',expected:{ wordId:'torn',state:'preparing',selected:['torn-conflicted','torn-tangled'],enrolled:true } },
  { id:'05-no-defaults',text:'致密',expected:{ wordId:'dense',state:'proposed',selected:['dense-compact'],enrolled:false } },
  { id:'06-already-studied',text:'宠溺',
    expected:{ wordId:'doting',state:'already-studying',selected:['doting-spoil'],enrolled:true,scheduleUnchanged:true } },
  { id:'07-phrase-components',text:'怡然自得 - not clear if this is best to study as a single phrase, or also its components?',
    expected:{ wordId:'content',state:'proposed',enrolled:false,review:'One phrase card and a reason for focusing on the unit.' } },
  { id:'08-character-correction',text:'海眠 - sponge',
    expected:{ wordId:'sponge',state:'proposed',enrolled:false,review:'Identify 绵 as the correct character.' } },
  { id:'09-new-sense',text:'蒸馏 - in the new context of AI model distillation',
    expected:{ wordId:'distil',state:'proposed',proposedSense:true,enrolled:false,sharedSenseCreated:false } },
  { id:'10-unsupported-context',text:'纠结 - can I use this to mean the scissors that I cut wrapping paper with?',
    expected:{ card:false,enrolled:false,review:'Explain the mismatch briefly.' } },
  { id:'11-fixed-expression-holdout',text:'过时 - in 过时不候 I want the deadline use. Is that a separate sense of 过时?',
    expected:{ wordId:'deadline',state:'proposed',enrolled:false,review:'Explain the deadline is carried by the warning as a unit.' } },
  { id:'12-material-holdout',text:'泡沫 - 包裹底下垫着泡沫',
    expected:{ wordId:'foam',state:'preparing',target:'foam-material',enrolled:true } },
] as const;

const model = option('model') ?? INTAKE_MODEL;
if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) throw new Error('Invalid --model name');
const reasoning = option('reasoning') ?? 'low';
if (!['omit','none','minimal','low','medium','high'].includes(reasoning)) throw new Error('Invalid --reasoning effort');
const requestedCases = option('cases') ?? 'screen';
const screen = new Set(['01-listed-context','03-larger-expression','09-new-sense','10-unsupported-context']);
const requestedIds = new Set(requestedCases.split(','));
const selectedCases = requestedCases === 'full' ? cases : requestedCases === 'screen' ? cases.filter(entry=>screen.has(entry.id)) : cases.filter(entry=>requestedIds.has(entry.id));
if (!selectedCases.length) throw new Error('Use --cases=screen or --cases=full');
const maxCalls = option('max-calls') === undefined ? (requestedCases === 'screen' ? 20 : 60) : Number(option('max-calls'));
if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 60) throw new Error('Use --max-calls between 1 and 60');
const revision = execFileSync('git',['rev-parse','HEAD'],{ cwd:source,encoding:'utf8' }).trim();
const sourceStatus = execFileSync('git',['status','--porcelain','--untracked-files=no'],{ cwd:source,encoding:'utf8' }).trim();
const promptHash = createHash('sha256').update(intakePrompt).digest('hex');
const root = live ? artifactPath : fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-intake-live-dry-run-'));
if (live) {
  try { fs.mkdirSync(root,{ mode:0o700 }); }
  catch (cause) { throw new Error('Live trial already started or the one-shot artifact directory is unavailable', { cause }); }
}
function write(name: string, value: unknown): void {
  const target = path.join(root,name), tmp = `${target}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{ mode:0o600 });
  fs.renameSync(tmp,target);
}
const manifest = { source,revision,sourceStatus,promptHash,variant,model,reasoning,requestedCases,maxCalls,
  scheduledCases:selectedCases.map(({id})=>id), createdAt:new Date().toISOString(),
  status:'started', providerCalls:0, completedCases:0, stopReason:null as string | null };
write('manifest.json',manifest);
write('fixture-input.json',{ date:fixtureDate,lexical,cases:selectedCases });
fs.writeFileSync(path.join(root,'rendered-intake-prompt.md'),intakePrompt,{ mode:0o600 });
const local = path.join(root,'database');
process.env.APP_MODE='study'; process.env.APP_DATA_DIR=local; process.env.APP_AUTH_MODE='clerk'; process.env.APP_STUDY_PROFILE='mandarin';
createBaselineFixture(local);
const db = new DatabaseSync(path.join(local,'app.db'));
db.exec('PRAGMA foreign_keys=ON');
setDb(db); installLearnerContextSqlFunction(); migrateDatabase(db);
const word = db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at,normalized_hanzi)
  VALUES (?,?,?,?,?,?,'[]',?,?,?)`);
const learner = db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)');
const actor = {kind:'operator',id:'intake-live-fixture'};
for (const entry of lexical) {
  word.run(entry.id,entry.hanzi,entry.traditional,entry.pinyin,entry.gloss,JSON.stringify([entry.gloss]),entry.priority,fixtureDate,entry.hanzi);
  if (!entry.senses) continue;
  for (const [id,label,notes] of entry.senses) createVocabularySense({wordId:entry.id,senseId:id,description:{label,notes}},actor);
  establishVocabularySenseCatalog(entry.id,getVocabularySenseCatalog(entry.id).version,actor);
  writeVocabularyDefaultUsefulSenses(entry.id,0,entry.senses.filter(entry=>entry[3]).map(entry=>entry[0]),actor);
}
for (const entry of cases) learner.run(entry.id,entry.id,fixtureDate);
runWithLearnerId('06-already-studied',()=>{
  const word = addVocabularyWord('doting');
  changeVocabularyMode('doting','practice',word.stateVersion);
});
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
if (dryRun) {
  db.close(); setDb(null);
  fs.rmSync(root,{ recursive:true, force:true });
  process.stdout.write(`Validated ${selectedCases.length} ${requestedCases} fixture cases at ${revision.slice(0,8)} for ${model}/${reasoning} without provider calls.\n`);
  process.exit(0);
}

installModelInvocationLedger();
const provider = makeVocabularyIntakeProvider();
type Stream = typeof provider.stream;
let transportFailure: { name: string; status?: number } | null = null;
const deadline = AbortSignal.timeout(8*60_000);
const boundedProvider = { stream: async (...[request,config,publish]: Parameters<Stream>) => {
  if (manifest.providerCalls >= maxCalls || deadline.aborted) {
    manifest.stopReason='trial bound';
    throw new Error('Live trial bound reached');
  }
  ++manifest.providerCalls;
  write('manifest.json',manifest);
  try {
    return await provider.stream({ ...request, model, reasoningEffort:reasoning === 'omit' ? null : reasoning, signal:AbortSignal.any([deadline,...(request.signal?[request.signal]:[])]) },config,publish);
  } catch (error) {
    transportFailure = { name:error instanceof Error?error.name:'Error',
      ...(error && typeof error==='object' && 'status' in error && typeof error.status==='number'?{status:error.status}:{}) };
    throw error;
  }
} };
const dump = (table: string, where: string, parameter: string) =>
  db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(parameter);
const asError = (error: unknown) => {
  if (!(error instanceof Error)) return { name:'Error',message:'Failed' };
  const secret = process.env.OPENAI_API_KEY;
  return { name:error.name,message:secret ? error.message.replaceAll(secret,'[redacted]') : error.message };
};
function learnerState(learnerId: string) {
  const words = dump('learner_words','learner_id=?',learnerId);
  return { words, priority:dump('learner_owned_user_word_priority','learner_id=?',learnerId),
    senses:dump('learner_senses','learner_id=?',learnerId), schedule:dump('learner_word_schedules','learner_id=?',learnerId),
    activeScopes:words.map(row=>resolveVocabularyLearnerSenseScope(String(row.word_id))) };
}
function usageTotals(invocations: ReturnType<typeof dump>) {
  const source = invocations.map(({usage_json}) => typeof usage_json === 'string' ? JSON.parse(usage_json) as {
    prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number }; input_tokens_details?: {cached_tokens?:number}; output_tokens_details?: {reasoning_tokens?:number};
  } : null);
  const sum = (values: Array<number | undefined | null>) => {
    const known = values.filter((value): value is number => typeof value === 'number');
    return known.length ? known.reduce((total,value)=>total+value,0) : null;
  };
  return {
    inputTokens:sum(source.map(row=>row?.prompt_tokens ?? row?.input_tokens)), cachedInputTokens:sum(source.map(row=>row?.prompt_tokens_details?.cached_tokens ?? row?.input_tokens_details?.cached_tokens)),
    outputTokens:sum(source.map(row=>row?.completion_tokens ?? row?.output_tokens)), reasoningTokens:sum(source.map(row=>row?.completion_tokens_details?.reasoning_tokens ?? row?.output_tokens_details?.reasoning_tokens)),
    totalTokens:sum(source.map(row=>row?.total_tokens)), invocationsWithUsage:source.filter(Boolean).length,
    providerLatencyMs:sum(invocations.map(row=>typeof row.latency_ms === 'number'?row.latency_ms:null)),
    spendUsdKnown:sum(invocations.map(row=>typeof row.spend_usd === 'number'?row.spend_usd:null)),
    invocationsWithKnownSpend:invocations.filter(row=>typeof row.spend_usd === 'number').length,
  };
}
const summary: unknown[] = [];
try {
  for (const entry of selectedCases) {
    if (manifest.providerCalls >= maxCalls || deadline.aborted) { manifest.stopReason='trial bound'; break; }
    const outcome = await runWithLearnerId(entry.id,async () => {
      const before = learnerState(entry.id), events: unknown[] = [];
      const callsBefore = manifest.providerCalls, started = performance.now();
      let progressMs: number | null = null, completionMs: number | null = null, cardMs: number | null = null;
      let failure: ReturnType<typeof asError> | undefined;
      try {
        await sendVocabularyIntakeTurn({ clientTurnId:entry.id,text:entry.text,provider:boundedProvider,publish:(event:{type:string;cards?:unknown[]})=>{
          const elapsed = performance.now()-started;
          if (event.type === 'progress') progressMs ??= elapsed;
          if (event.type === 'completion') completionMs ??= elapsed;
          if (event.type === 'completion' && event.cards?.length) cardMs ??= elapsed;
          events.push(event);
        } });
      } catch (error) { failure=asError(error); }
      const latency = { progressMs, completionMs, cardMs, turnMs:performance.now()-started };
      const history = getVocabularyIntakeHistory();
      const row = history.turns.at(-1);
      const saved = row ? dump('model_invocations','workflow_id=? ORDER BY attempt_number',row.id) : [];
      const after = learnerState(entry.id), card = history.cards[0];
      const resultingWord = card ? getVocabularyLearnerWord(card.wordId) : null;
      const rawCards = row?dump('learner_chat_cards','turn_id=? ORDER BY created_at,id',row.id):[];
      const rawBody = typeof rawCards[0]?.body_json === 'string' ? JSON.parse(rawCards[0].body_json) : null;
      const expected = entry.expected;
      const checks: Record<string,boolean> = {};
      if ('wordId' in expected) checks.wordId = card?.wordId === expected.wordId;
      if ('state' in expected) checks.state = card?.state === expected.state;
      if ('target' in expected) checks.target = card?.selection.targetSenseId === expected.target;
      if ('selected' in expected) checks.selected = JSON.stringify([...card?.selection.senseIds??[]].sort()) === JSON.stringify([...expected.selected].sort());
      if ('pending' in expected) checks.pending = !!rawBody?.pending === expected.pending;
      if ('context' in expected) checks.context = resultingWord?.intendedUseText?.includes('用绵长、安静、不紧张的温柔') === true;
      if ('card' in expected) checks.card = !!card === expected.card;
      if ('proposedSense' in expected) checks.proposedSense = !!card?.proposedSense === expected.proposedSense;
      if ('sharedSenseCreated' in expected) checks.sharedSenseCreated = Boolean(db.prepare("SELECT 1 FROM senses WHERE word_id='distil' AND sense_id<>'distil-liquid'").get()) === expected.sharedSenseCreated;
      if ('scheduleUnchanged' in expected) checks.scheduleUnchanged = (JSON.stringify(before.schedule) === JSON.stringify(after.schedule)) === expected.scheduleUnchanged;
      checks.enrolled = (!!resultingWord || after.words.length > 0) === expected.enrolled;
      return { expected,checks,events,history,before,after,resultingWord,latency,usage:usageTotals(saved),
        calls:manifest.providerCalls-callsBefore, invocations:saved,
        turn:row?dump('learner_chat_turns','id=?',row.id):[],
        toolTrace:row?dump('learner_chat_events','turn_id=? ORDER BY sequence',row.id):[],
        rawCards,
        queuedReadiness:db.prepare('SELECT * FROM vocabulary_sense_readiness ORDER BY word_id').all(),
        sharedFindings:db.prepare("SELECT * FROM backend_events WHERE name='vocabulary.intake.finding' ORDER BY occurred_at,event_id").all(),
        failure };
    });
    write(`${entry.id}.json`,outcome);
    const state = outcome.history.cards[0]?.state ?? (outcome.failure?'failed':'no card');
    summary.push({ case:entry.id,state,latency:outcome.latency,usage:outcome.usage,calls:outcome.calls,checks:outcome.checks,
      structuralPass:!outcome.failure && Object.values(outcome.checks).every(Boolean) });
    write('summary.json',summary);
    ++manifest.completedCases;
    write('manifest.json',manifest);
    process.stdout.write(`${entry.id}: ${state}, ${outcome.calls} calls, ${Math.round(outcome.latency.turnMs)} ms\n`);
    if (manifest.stopReason) break;
    if (transportFailure) { manifest.stopReason=`provider failure: ${JSON.stringify(transportFailure)}`; break; }
  }
} finally {
  manifest.status=manifest.completedCases===selectedCases.length && !manifest.stopReason?'completed':'stopped';
  write('manifest.json',manifest);
  db.close(); setDb(null);
  process.stdout.write(`Evidence saved to ${root} (used ${manifest.providerCalls}/${maxCalls} calls).\n`);
}
