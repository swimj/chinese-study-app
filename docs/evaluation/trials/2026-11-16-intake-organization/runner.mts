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
const artifactPath = path.join(os.tmpdir(), `chinese-study-intake-live-2026-11-15-${variant}`);
const fixtureDate = '2026-11-15T00:00:00.000Z';
const copyFrom = (file: string) => import(pathToFileURL(path.join(source,file)).href);
const { createBaselineFixture } = await copyFrom('tests/helpers/baseline-database.ts');
const { migrateDatabase } = await copyFrom('server/db/migrations.ts');
const { setDb } = await copyFrom('server/db/connection.ts');
const { installLearnerContextSqlFunction, runWithLearnerId } = await copyFrom('server/db/learner-context.ts');
const { createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog } = await copyFrom('server/db/vocabulary-content.ts');
const { writeVocabularyDefaultUsefulSenses } = await copyFrom('server/db/vocabulary-sense-coverage.ts');
const { getVocabularyLearnerWord } = await copyFrom('server/db/vocabulary-learners.ts');
const { resolveVocabularyLearnerSenseScope } = await copyFrom('server/db/vocabulary-learner-senses.ts');
const { getVocabularyIntakeHistory, INTAKE_MODEL, intakePrompt, makeVocabularyIntakeProvider, sendVocabularyIntakeTurn } = await copyFrom('server/vocabulary/intake-chat.ts');
const { installModelInvocationLedger } = await copyFrom('server/llm/invocation-ledger.ts');

type Sense = [id: string, label: string, notes: string[], useByDefault: boolean];
type Lexical = {
  id: string; hanzi: string; traditional: string | null; pinyin: string; gloss: string; priority: number;
  senses?: Sense[];
};
// --fixture=<file> replaces the built-in words and cases, for example with the holdout set.
const fixtureOverride = option('fixture') ? JSON.parse(fs.readFileSync(path.resolve(option('fixture')!),'utf8')) as { lexical: Lexical[]; cases: Array<{id:string;text:string;expected:Record<string,unknown>}> } : null;
const builtInLexical: Lexical[] = [
  {id:'memory',hanzi:'念念不忘',traditional:null,pinyin:'niànniàn bù wàng',gloss:'keep thinking of; never forget',priority:40,senses:[['memory-idiom','Keep thinking of; never forget',['多年后他仍对那次旅行念念不忘。'],true]]},
  {id:'ferment',hanzi:'发酵',traditional:'發酵',pinyin:'fājiào',gloss:'ferment; develop',priority:55,senses:[['ferment-food','To ferment',['面团正在发酵。'],true],['ferment-story','Develop or intensify (of public discussion or an incident)',['消息在网上继续发酵。'],false]]},
  {id:'no-news',hanzi:'音信全无',traditional:'音信全無',pinyin:'yīnxìn quán wú',gloss:'no news at all',priority:30},
  {id:'weigh',hanzi:'斟酌',traditional:null,pinyin:'zhēnzhuó',gloss:'consider carefully; pour wine',priority:40,senses:[['weigh-consider','Weigh or consider carefully',['这个措辞还要斟酌。'],false],['weigh-pour','Pour wine',['Literary or classical use connected with pouring wine.'],false]]},
  {id:'warm-up',hanzi:'升温',traditional:'升溫',pinyin:'shēngwēn',gloss:'rise in temperature',priority:45,senses:[['warm-temperature','Rise in temperature',['这杯水正在升温。'],true]]},
  {id:'decline',hanzi:'下滑',traditional:null,pinyin:'xiàhuá',gloss:'decline; slide downward',priority:45,senses:[['decline-level','Decline or slip to a lower level',['成绩明显下滑；销量也可能下滑。'],true]]},
  {id:'fragile',hanzi:'脆弱',traditional:null,pinyin:'cuìruò',gloss:'fragile; vulnerable',priority:50,senses:[['fragile-vulnerable','Fragile or vulnerable',['脆弱的关系。'],true]]},
  {id:'slight',hanzi:'微',traditional:null,pinyin:'wēi',gloss:'tiny; slight',priority:35,senses:[['slight-small','Tiny, slight, or subtle',['微光。'],true]]},
  {id:'smile',hanzi:'微笑',traditional:null,pinyin:'wēixiào',gloss:'smile',priority:60,senses:[['smile-act','To smile; a smile',['她微笑着点头。'],true]]},
  {id:'aircon',hanzi:'空调',traditional:'空調',pinyin:'kōngtiáo',gloss:'air conditioner; air conditioning',priority:70,senses:[['aircon-device','Air conditioner; air conditioning system',['把空调关了。'],true]]},
  {id:'visa',hanzi:'签证',traditional:'簽證',pinyin:'qiānzhèng',gloss:'visa',priority:60,senses:[['visa-document','A visa',['申请签证。'],true]]},
  {id:'xing',hanzi:'行',traditional:null,pinyin:'xíng',gloss:'to do; okay; go',priority:55,senses:[['xing-okay','Okay; acceptable',['这样做也行。'],true]]},
  {id:'hang',hanzi:'行',traditional:null,pinyin:'háng',gloss:'row; line; trade',priority:50,senses:[['hang-row','A row or line',['一行字。'],true],['hang-trade','A trade or line of work',['各行各业。'],true]]},
  {id:'twinkle',hanzi:'闪烁',traditional:'閃爍',pinyin:'shǎnshuò',gloss:'twinkle; flicker',priority:55,senses:[['twinkle-light','Twinkle or flicker (of light)',['夜空中的星星在闪烁。'],true]]},
  {id:'overlook',hanzi:'俯瞰',traditional:null,pinyin:'fǔkàn',gloss:'look down over',priority:45,senses:[['overlook-view','Look down over a place from above',['从山顶俯瞰村庄。'],true]]},
  {id:'shelve',hanzi:'搁置',traditional:'擱置',pinyin:'gēzhì',gloss:'shelve; put aside',priority:50,senses:[['shelve-plan','Put a matter or plan aside for now',['这个计划先搁置吧。'],true]]},
  {id:'gaze',hanzi:'凝视',traditional:'凝視',pinyin:'níngshì',gloss:'gaze steadily at',priority:60,senses:[['gaze-fixedly','Look steadily or intently at someone or something',['他凝视着窗外。'],true]]},
];
const builtInCases = [
  {id:'h01-bare',text:'念念不忘',expected:{wordId:'memory',state:'preparing',selected:['memory-idiom'],enrolled:true}},
  {id:'h02-nondefault-context',text:'发酵 — 这条消息在网上继续发酵',expected:{wordId:'ferment',state:'preparing',target:'ferment-story',selected:['ferment-food','ferment-story'],enrolled:true,context:'这条消息在网上继续发酵'}},
  {id:'h03-missing-inventory',text:'音信全无 — 三个月过去了，仍然音信全无',expected:{wordId:'no-news',state:'preparing',pending:true,enrolled:true,context:'三个月过去了，仍然音信全无'}},
  {id:'h04-no-defaults',text:'斟酌 — which use should I start with for everyday writing?',expected:{wordId:'weigh',state:'proposed',selected:['weigh-consider'],enrolled:false}},
  {id:'h05-missing-sense',text:'升温 — 两人的关系慢慢升温',expected:{wordId:'warm-up',state:'proposed',selected:['warm-temperature'],proposedSense:true,enrolled:false,review:'Distinct established figurative rise in closeness; one private proposal; no shared write.'}},
  {id:'h06-paraphrase',text:'下滑 — 这家店的销量下滑了. Is this a new sense compared with falling grades?',expected:{card:false,enrolled:false,review:'Language question: same decline sense, no mutation or new-sense proposal.'}},
  {id:'h07-unsupported',text:'脆弱 — I want this to mean crunchy, like a cracker',expected:{card:false,enrolled:false,review:'Crunchy belongs to 脆, not 脆弱; explain without substituting a fragile card.'}},
  {id:'h08-compound',text:'微 — I want the word for smile, as in 微笑',expected:{wordId:'smile',state:'proposed',selected:['smile-act'],enrolled:false,review:'larger_expression with requestedLexeme 微; no smile sense under 微.'}},
  {id:'h09-short-form',text:'空调 — 把空调关了',expected:{wordId:'aircon',state:'preparing',target:'aircon-device',selected:['aircon-device'],enrolled:true,review:'Shortened noun functions independently; no redirect to 空气调节器.'}},
  {id:'h10-correction',text:'签正 — I mean a visa for travel',expected:{wordId:'visa',state:'proposed',selected:['visa-document'],enrolled:false,review:'correction with requestedLexeme 签正; await Add.'}},
  {id:'h11-identity',text:'行',expected:{card:false,enrolled:false,review:'Ask whether xíng or háng before adding.'}},
  {id:'c01-meaning-question',text:'闪烁 — 星星在夜空中闪烁. Does it mean twinkling here?',expected:{card:false,enrolled:false,review:'Answer meaning question without card or enrollment.'}},
  {id:'c02-hypothetical',text:'If I added 俯瞰 for 从山顶俯瞰村庄 tomorrow, what would the card mean?',expected:{card:false,enrolled:false,review:'Explain hypothetical meaning without state change.'}},
  {id:'c03-explicit-add-plus-question',text:'搁置 — 这个计划先搁置吧. Does it mean put the plan on hold? Please add 搁置 for this use.',expected:{wordId:'shelve',state:'preparing',target:'shelve-plan',selected:['shelve-plan'],enrolled:true,review:'Clear accompanying add request authorizes context_match with verbatim context.'}},
  {id:'c04-direct-context-add',text:'凝视 — 他凝视着窗外',expected:{wordId:'gaze',state:'preparing',target:'gaze-fixedly',selected:['gaze-fixedly'],enrolled:true,review:'Direct context add.'}},
] as const;
const lexical: Lexical[] = fixtureOverride?.lexical ?? builtInLexical;
const cases: ReadonlyArray<{id:string;text:string;expected:Record<string,unknown>}> = fixtureOverride?.cases ?? builtInCases;

const trialPrompt = option('prompt') ? fs.readFileSync(path.resolve(option('prompt')!), 'utf8') : intakePrompt;
const model = option('model') ?? INTAKE_MODEL;
if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) throw new Error('Invalid --model name');
const reasoning = option('reasoning') ?? 'low';
if (!['omit','none','minimal','low','medium','high'].includes(reasoning)) throw new Error('Invalid --reasoning effort');
const requestedCases = option('cases') ?? 'screen';
const screen = new Set(['h01-bare','h05-missing-sense','h07-unsupported','h10-correction']);
const requestedIds = new Set(requestedCases.split(','));
const selectedCases = requestedCases === 'full' ? cases : requestedCases === 'screen' ? cases.filter(entry=>screen.has(entry.id)) : cases.filter(entry=>requestedIds.has(entry.id));
if (!selectedCases.length) throw new Error('Use --cases=screen or --cases=full');
const maxCalls = option('max-calls') === undefined ? (requestedCases === 'screen' ? 20 : 60) : Number(option('max-calls'));
if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 60) throw new Error('Use --max-calls between 1 and 60');
const revision = execFileSync('git',['rev-parse','HEAD'],{ cwd:source,encoding:'utf8' }).trim();
const sourceStatus = execFileSync('git',['status','--porcelain','--untracked-files=no'],{ cwd:source,encoding:'utf8' }).trim();
const promptHash = createHash('sha256').update(trialPrompt).digest('hex');
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
const manifest = { source,revision,sourceStatus,sourceDiff:execFileSync('git',['diff'],{cwd:source,encoding:'utf8'}),promptHash,variant,model,reasoning,requestedCases,maxCalls,
  scheduledCases:selectedCases.map(({id})=>id), createdAt:new Date().toISOString(),
  status:'started', providerCalls:0, completedCases:0, stopReason:null as string | null };
write('manifest.json',manifest);
write('fixture-input.json',{ date:fixtureDate,lexical,cases:selectedCases });
fs.writeFileSync(path.join(root,'rendered-intake-prompt.md'),trialPrompt,{ mode:0o600 });
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
    return await provider.stream({ ...request, messages:request.messages.map((message,index)=>index===0?{...message,content:trialPrompt}:message), provenance:{...request.provenance,promptVersion:option('prompt-version')??'9.3'}, model, reasoningEffort:reasoning === 'omit' ? null : reasoning, signal:AbortSignal.any([deadline,...(request.signal?[request.signal]:[])]) },config,publish);
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
      const sharedBefore = db.prepare('SELECT * FROM senses ORDER BY sense_id').all();
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
      if ('context' in expected) checks.context = resultingWord?.intendedUseText?.includes(expected.context) === true;
      if ('card' in expected) checks.card = !!card === expected.card;
      if ('proposedSense' in expected) checks.proposedSense = !!card?.proposedSense === expected.proposedSense;
      checks.sharedSensesUnchanged = JSON.stringify(sharedBefore) === JSON.stringify(db.prepare('SELECT * FROM senses ORDER BY sense_id').all());
      checks.enrolled = (!!resultingWord || after.words.length > 0) === expected.enrolled;
      return { expected,checks,explanationWithCard: cardMs === null || (completionMs !== null && completionMs <= cardMs),events,history,before,after,resultingWord,latency,usage:usageTotals(saved),
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
    summary.push({ case:entry.id,state,latency:outcome.latency,usage:outcome.usage,calls:outcome.calls,checks:outcome.checks,explanationWithCard:outcome.explanationWithCard,
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
