import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { ChatProvider } from '../../../../server/llm/chat-types.ts';
import type { IntakeCardDraft } from '../../../../server/db/vocabulary-intake.ts';
import type { VocabularyIntakeStreamEvent } from '../../../../src/domain/vocabulary-intake.ts';
const option=(name:string)=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const variant=option('variant'),model=option('model')??'gpt-6-sol';
if(!process.argv.includes('--execute')||!process.env.OPENAI_API_KEY||!variant||!/^[a-z0-9-]+$/.test(variant))throw Error('Require --execute, --variant and private provider configuration');
const root=path.join(os.tmpdir(), `existing-word-sense-${variant}`),source=process.cwd();
fs.mkdirSync(root,{mode:0o700});
const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
const imp=(name:string)=>import(pathToFileURL(path.join(source,name)).href);
const {createBaselineFixture}=await imp('tests/helpers/baseline-database.ts');
process.env.APP_MODE='study';process.env.APP_AUTH_MODE='clerk';process.env.APP_DATA_DIR=path.join(root,'database');process.env.APP_STUDY_PROFILE='mandarin';
createBaselineFixture(process.env.APP_DATA_DIR);
const db=new DatabaseSync(path.join(process.env.APP_DATA_DIR,'app.db'));
const {setDb}=await imp('server/db/connection.ts');setDb(db);
const {installLearnerContextSqlFunction,runWithLearnerId}=await imp('server/db/learner-context.ts');installLearnerContextSqlFunction();
const {migrateDatabase}=await imp('server/db/migrations.ts');migrateDatabase(db);
const {createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog}=await imp('server/db/vocabulary-content.ts');
const {writeVocabularyDefaultUsefulSenses}=await imp('server/db/vocabulary-sense-coverage.ts');
const {startChatTurn,appendChatEvent,finishChatTurn}=await imp('server/db/learner-chat.ts');
const {intakeConversationId,saveVocabularyIntakeCard,projectVocabularyIntakeCard,listVocabularyIntakeCards,runVocabularyIntakeCommand}=await imp('server/db/vocabulary-intake.ts');
const {sendVocabularyIntakeTurn,makeVocabularyIntakeProvider,intakePrompt}=await imp('server/vocabulary/intake-chat.ts');
const {addVocabularyWord,changeVocabularyMode,getVocabularyLearnerWord,getVocabularyWordSchedule}=await imp('server/db/vocabulary-learners.ts');
const {installModelInvocationLedger}=await imp('server/llm/invocation-ledger.ts');installModelInvocationLedger();
type Lexical={id:string;hanzi:string;traditional:string|null;pinyin:string;gloss:string;priority:number;senses?:Array<[string,string,string[],boolean]>};
const lexical:Lexical[]=JSON.parse(fs.readFileSync(new URL('../2026-11-15-intake-followups/fixture.json',import.meta.url),'utf8')).lexical;
for(const word of lexical){
 db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at,normalized_hanzi)
 VALUES(?,?,?,?,?,?,'[]',?,'2026-11-15',?)`).run(word.id,word.hanzi,word.traditional,word.pinyin,word.gloss,JSON.stringify([word.gloss]),word.priority,word.hanzi);
 if(!word.senses)continue;
 const actor={kind:'operator',id:'synthetic-followup-fixture'};
 for(const [senseId,label,notes] of word.senses)createVocabularySense({wordId:word.id,senseId,description:{label,notes}},actor);
 establishVocabularySenseCatalog(word.id,getVocabularySenseCatalog(word.id).version,actor);
 writeVocabularyDefaultUsefulSenses(word.id,0,word.senses.filter(s=>s[3]).map(s=>s[0]),actor);
}
function seed(wordId:string,kind:'added'|'proposal',text?:string,assistant?:string){
 const word=lexical.find(word=>word.id===wordId)!;
 const defaults=word.senses?.filter(s=>s[3]).map(s=>s[0])??[];
 const turn=startChatTurn(intakeConversationId(),`seed-${wordId}`,{text:text??word.hanzi}).turn;
 const draft:IntakeCardDraft={wordId,requestedLexeme:word.hanzi,decision:kind==='added'?'bare':'proposal',context:null,
  selection:{senseIds:defaults,targetSenseId:null,includeProposedSense:wordId==='distil'&&kind==='proposal'},
  proposedSense:wordId==='distil'&&kind==='proposal'?{label:'Distil a model into a smaller model',notes:['Transfer a larger model’s learned capabilities to a smaller model, as in 把大模型蒸馏成小模型。']}:null};
 const card=saveVocabularyIntakeCard(turn.id,draft,kind==='added');
 appendChatEvent(turn.id,{kind:'assistant',message:{role:'assistant',content:assistant??`${word.hanzi}: these are its uses.`,toolCalls:[]},invocationId:null});
 finishChatTurn(turn.id,'completed');return projectVocabularyIntakeCard(card);
}
function enrolled(wordId='distil') {const word=addVocabularyWord(wordId);changeVocabularyMode(wordId,'practice',word.stateVersion);}
type Case={id:string;text:string;setup:()=>void;expectation:string};
const cases:Case[]=[
 {id:'existing-new',text:'蒸馏 — I already study the chemistry meaning. I also want the AI model-distillation meaning.',setup:()=>enrolled(),expectation:'New sense-proposed card; no state/shared write until button confirmation'},
 {id:'existing-followup',text:'I also want its AI model-distillation meaning.',setup:()=>{enrolled();seed('distil','added');},expectation:'Look up 蒸馏; new additive sense proposal, preserve current selection'},
 {id:'clarify-proposal',text:'Clarify the new sense as transferring a large model’s knowledge into a smaller model.',setup:()=>{enrolled();seed('distil','proposal');},expectation:'Revise same private sense proposal, no canonical change'},
 {id:'confirmation-boundary',text:'Yes, add that sense.',setup:()=>{enrolled();seed('distil','proposal');},expectation:'Direct to Add sense button; no mutation'},
 {id:'only-new',text:'Only the AI sense, please.',setup:()=>{enrolled();seed('distil','proposal');},expectation:'Explain confirm Add sense first, then adjust selected set; no mutation'},
 {id:'unsupported',text:'蒸馏 — please add a new sense meaning a red color.',setup:()=>enrolled(),expectation:'Reject unsupported meaning; no card or new sense'},
 {id:'bound-component',text:'过时 — I want a separate sense meaning a deadline, from 过时不候.',setup:()=>enrolled('outdated'),expectation:'Explain larger expression ownership; no invented sense'},
 {id:'new-enrollment-control',text:'蒸馏 — AI model distillation',setup:()=>{},expectation:'Ordinary enrollment proposal still requires Add'},
 {id:'canonical-existing',text:'泡沫 — I already study it, and also want its economic-bubble meaning.',setup:()=>enrolled('foam'),expectation:'Use existing inventory; no newly invented sense proposal'},
];
write('manifest.json',{source,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),diff:execFileSync('git',['diff'],{encoding:'utf8'}),model,reasoning:'low',promptHash:createHash('sha256').update(intakePrompt).digest('hex'),maxCalls:40,cases:cases.map(({id,text,expectation})=>({id,text,expectation}))});
fs.writeFileSync(path.join(root,'prompt.md'),intakePrompt);
const base=makeVocabularyIntakeProvider();let calls=0;
const provider:ChatProvider={async stream(request,config,onText){if(++calls>40)throw Error('Trial call limit');return base.stream({...request,model,reasoningEffort:'low'},config,onText);}};
const outcomes=[];
for(const entry of cases){
 db.prepare("INSERT INTO learners(learner_id,display_name,created_at) VALUES(?,?,'2026-11-15')").run(entry.id,'Synthetic follow-up');
 await runWithLearnerId(entry.id,async()=>{
  entry.setup();const before=listVocabularyIntakeCards(false),events:VocabularyIntakeStreamEvent[]=[];const started=performance.now(),beforeCalls=calls;
  const beforeWord=getVocabularyLearnerWord('distil'),beforeSchedule=getVocabularyWordSchedule('distil');
  let error:string|null=null;
  try{await sendVocabularyIntakeTurn({clientTurnId:'live',text:entry.text,provider,publish:(event:VocabularyIntakeStreamEvent)=>events.push(event)});}catch(e){error=e instanceof Error?e.message:'Failed';}
  const result={id:entry.id,text:entry.text,expectation:entry.expectation,calls:calls-beforeCalls,elapsedMs:performance.now()-started,before,after:listVocabularyIntakeCards(false),events,error};
  outcomes.push(result);write('outcomes.json',outcomes);
  write('invocations.json',db.prepare('SELECT * FROM model_invocations').all());
  console.log(JSON.stringify({id:entry.id,calls:result.calls,elapsedMs:Math.round(result.elapsedMs),error,text:events.filter(e=>e.type==='completion').map(e=>e.assistantText).join(''),cards:result.after.map((c: {hanzi:string;state:string;selection:unknown;version:number})=>({hanzi:c.hanzi,state:c.state,selection:c.selection,version:c.version}))}));
 });
}
const invocations=db.prepare('SELECT * FROM model_invocations').all();write('invocations.json',invocations);
const bytes=Buffer.concat(fs.readdirSync(root).filter(n=>fs.statSync(path.join(root,n)).isFile()).map(n=>fs.readFileSync(path.join(root,n))));
if(bytes.includes(Buffer.from(process.env.OPENAI_API_KEY!)))throw Error('Credential found in evidence');
console.log(JSON.stringify({artifact:root,calls,spendUsd:invocations.reduce((sum:number,row:{spend_usd?:number})=>sum+(row.spend_usd??0),0)}));
setDb(null);db.close();
