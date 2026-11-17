import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const source=process.cwd();
const root=path.join(os.tmpdir(), 'custom-senses-live-teaching-2026-11-15');
if(!process.argv.includes('--execute')||!process.env.OPENAI_API_KEY)throw new Error('Explicit live execution and provider configuration required');
fs.mkdirSync(root,{mode:0o700});
process.env.APP_MODE='study';process.env.APP_AUTH_MODE='clerk';process.env.APP_DATA_DIR=path.join(root,'database');
const imp=(file:string)=>import(pathToFileURL(path.join(source,file)).href);
const {createBaselineFixture}=await imp('tests/helpers/baseline-database.ts');
createBaselineFixture(process.env.APP_DATA_DIR);
const db=new DatabaseSync(path.join(process.env.APP_DATA_DIR,'app.db'));
const {setDb}=await imp('server/db/connection.ts');setDb(db);
const {installLearnerContextSqlFunction,runWithLearnerId}=await imp('server/db/learner-context.ts');installLearnerContextSqlFunction();
const {migrateDatabase}=await imp('server/db/migrations.ts');migrateDatabase(db);db.exec('PRAGMA foreign_keys=ON');
const {createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog}=await imp('server/db/vocabulary-content.ts');
const {writeVocabularyDefaultUsefulSenses}=await imp('server/db/vocabulary-sense-coverage.ts');
const {enqueueWordPreparation}=await imp('server/db/preparation-work.ts');
const {createWordIntroductionProvider}=await imp('server/word-content/provider.ts');
const {createWordPreparationWorker}=await imp('server/word-content/preparation-worker.ts');
const {installModelInvocationLedger}=await imp('server/llm/invocation-ledger.ts');installModelInvocationLedger();
const {getSharedWordIntroductionContent,getWordIntroductionLibrary}=await imp('server/db/word-introductions.ts');
const actor={kind:'service',id:'synthetic-teaching-trial'};
db.exec(`INSERT INTO learners(learner_id,display_name,created_at) VALUES('trial','Synthetic trial','2026-11-15');
INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at,normalized_hanzi)
VALUES('distil','蒸馏','zhēngliú','distil a liquid','["distil a liquid"]','[]',10,'2026-11-15','蒸馏');`);
const senses=[{senseId:'chemical',label:'Distil a liquid',notes:['Separate or purify a liquid through vaporization and condensation. 蒸馏水 is distilled water.']},
{senseId:'model',label:'Distil a model into a smaller model',notes:['In AI, transfer a large model’s learned capabilities to a smaller model, as in 把大模型蒸馏成小模型. This technical verb is not limited to the noun phrase 知识蒸馏.']}];
for(const {senseId,label,notes} of senses)createVocabularySense({wordId:'distil',senseId,description:{label,notes}},actor);
establishVocabularySenseCatalog('distil',getVocabularySenseCatalog('distil').version,actor);writeVocabularyDefaultUsefulSenses('distil',0,['chemical'],actor);
const prompts=['bootstrap-enrichment.md','teaching.md'].map(file=>{const text=fs.readFileSync(path.join(source,'server/word-content/prompts',file),'utf8');fs.writeFileSync(path.join(root,file),text);return {file,sha256:createHash('sha256').update(text).digest('hex')};});
const ptext=fs.readFileSync(path.join(source,'server/word-content-lab/vocabulary-experiments/prompts/teaching-exercises-v2.md'),'utf8');fs.writeFileSync(path.join(root,'teaching-exercises-v2.md'),ptext);
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),source,senses,prompts,model:'gpt-6-luna',reasoning:'high',maxCalls:6,privateLearnerText:false},null,2));
let calls=0;
const provider=createWordIntroductionProvider({fetchImplementation:async(url:RequestInfo|URL,init?:RequestInit)=>{
 if(++calls>6)throw new Error('Teaching trial call limit');
 const number=String(calls).padStart(2,'0');const started=performance.now();
 fs.writeFileSync(path.join(root,number+'-request.json'),String(init?.body));
 const response=await fetch(url,init);
 if(response.ok){const body=await response.clone().text();fs.writeFileSync(path.join(root,number+'-response.json'),body);}
 fs.writeFileSync(path.join(root,number+'-transport.json'),JSON.stringify({status:response.status,latencyMs:performance.now()-started}));
 return response;
}});
const owner=<T>(work:()=>T)=>runWithLearnerId('trial',work);
owner(()=>{enqueueWordPreparation('distil','teaching');enqueueWordPreparation('distil','teaching',undefined,'["chemical","model"]');});
const worker=createWordPreparationWorker({provider,providerWork:async(work:()=>Promise<unknown>)=>work(),controls:()=>({maintenanceMode:false,providerWorkEnabled:true})});
try{await worker.drain();}finally{await worker.stop();}
const outcome=owner(()=>['default','["chemical","model"]'].map(key=>({key,source:getSharedWordIntroductionContent('distil',key),library:getWordIntroductionLibrary('distil',key)})));
fs.writeFileSync(path.join(root,'outcome.json'),JSON.stringify(outcome,null,2));
fs.writeFileSync(path.join(root,'work.json'),JSON.stringify(db.prepare('SELECT * FROM word_preparation_work').all(),null,2));
console.log(JSON.stringify({artifact:root,calls,sets:outcome.map((o:{key:string;library:{packages:unknown[]}|null})=>({key:o.key,packages:o.library?.packages.length}))}));
setDb(null);db.close();
