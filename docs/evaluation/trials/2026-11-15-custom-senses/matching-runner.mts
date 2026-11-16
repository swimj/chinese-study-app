import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {pathToFileURL} from 'node:url';
const root='/private/tmp/custom-senses-live-matching-2026-11-15';
if(!process.argv.includes('--execute')||!process.env.OPENAI_API_KEY)throw new Error('Explicit live execution required');
fs.mkdirSync(root,{mode:0o700});fs.copyFileSync('/private/tmp/chinese-study-intake-live-2026-11-15-full-sol-low/database/app.db',path.join(root,'app.db'));
process.env.APP_MODE='study';process.env.APP_AUTH_MODE='clerk';process.env.APP_DATA_DIR=root;
const imp=(p:string)=>import(pathToFileURL(path.join(process.cwd(),p)).href);
const db=new DatabaseSync(path.join(root,'app.db'));const {setDb}=await imp('server/db/connection.ts');setDb(db);
const {runWithLearnerId,installLearnerContextSqlFunction}=await imp('server/db/learner-context.ts');installLearnerContextSqlFunction();
const {createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog}=await imp('server/db/vocabulary-content.ts');
const {writeVocabularyDefaultUsefulSenses}=await imp('server/db/vocabulary-sense-coverage.ts');
const {startChatTurn}=await imp('server/db/learner-chat.ts');
const {intakeConversationId,saveVocabularyIntakeCard,getVocabularyIntakeCard,projectVocabularyIntakeCard}=await imp('server/db/vocabulary-intake.ts');
const {createVocabularyIntakeWorker}=await imp('server/vocabulary/intake-worker.ts');
const {installModelInvocationLedger}=await imp('server/llm/invocation-ledger.ts');installModelInvocationLedger();
const actor={kind:'service',id:'matching-fixture'},cases=[['specific','她打了我一拳。'],['ambiguous','打'],['unsupported','这里打表示一种红色。']];
const results=[];
for(const [id,context] of cases){
 db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES(?,?,?)').run(id,'Synthetic matching','2026-11-15');
 db.prepare("INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at,normalized_hanzi) VALUES(?,'打','dǎ','hit; make a phone call','[]','[]',1,'2026-11-15','打')").run(id);
 const card=runWithLearnerId(id,()=>{const turn=startChatTurn(intakeConversationId(),id,{text:context}).turn;return saveVocabularyIntakeCard(turn.id,{wordId:id,decision:'inventory_pending',requestedLexeme:'打',context,selection:{senseIds:[],includeProposedSense:false,targetSenseId:null},proposedSense:null},true)});
 for(const [suffix,label,notes] of [['hit','Hit or strike',['打人; 打了一拳.']],['call','Make a phone call',['打电话; 给朋友打个电话.']]])createVocabularySense({wordId:id,senseId:id+'-'+suffix,description:{label,notes}},actor);
 establishVocabularySenseCatalog(id,getVocabularySenseCatalog(id).version,actor);writeVocabularyDefaultUsefulSenses(id,0,[id+'-hit',id+'-call'],actor);
 await createVocabularyIntakeWorker().stepMatch();
 results.push(runWithLearnerId(id,()=>({id,context,card:projectVocabularyIntakeCard(getVocabularyIntakeCard(card.id))})));
}
fs.writeFileSync(path.join(root,'outcomes.json'),JSON.stringify(results,null,2));
const invocations=db.prepare("SELECT * FROM model_invocations WHERE prompt_name='vocabulary-intake-context-match'").all();fs.writeFileSync(path.join(root,'invocations.json'),JSON.stringify(invocations,null,2));
console.log(JSON.stringify({calls:invocations.length,results:results.map(r=>({id:r.id,target:r.card.selection.targetSenseId,attention:r.card.attention}))}));
setDb(null);db.close();
