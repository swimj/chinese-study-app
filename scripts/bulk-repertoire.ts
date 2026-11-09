import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setDb } from '../server/db/connection.ts';
import { assertSchemaCurrent } from '../server/db/migrations.ts';
import { selectBulkRepertoireWords } from '../server/db/bulk-repertoire-selection.ts';
import { snapshotBulkRepertoireWord } from '../server/db/bulk-repertoire-snapshot.ts';
import { bulkHash, generateBulkWord, verifyBulkWord, type BulkWordSnapshot, type BulkCall, type BulkWordResult } from '../server/vocabulary/bulk-repertoire.ts';
import { createBulkDispatcher, costForBulkResult, costForBulkResponse, type BulkAttempt, type BulkResponse, type BulkStart } from './lib/bulk-repertoire-dispatch.ts';
import { reportBulkRepertoire } from './lib/bulk-repertoire-report.ts';
import { parseResponse } from '../server/llm/openai-compatible.ts';
import { hostname } from 'node:os';
import { applyBulkRepertoireWord } from '../server/db/bulk-repertoire-apply.ts';
import type { ProviderAdapter } from '../server/llm/types.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  database: {type:'string'}, out: {type:'string'}, input: {type:'string'}, limit: {type:'string',default:'500'},
  model: {type:'string',default:'gpt-6-sol'}, effort: {type:'string',default:'high'}, concurrency: {type:'string',default:'100'},
  'allow-provider-calls': {type:'boolean',default:false}, 'source-revision': {type:'string'},
  'recover-run-lock': {type:'boolean',default:false}, 'retry-uncertain': {type:'boolean',default:false},
  actor: {type:'string'}, 'operation-id': {type:'string'}, 'expected-sha256': {type:'string'}, 'confirm-app-stopped': {type:'boolean',default:false},
} });
const required = (value:string|undefined,name:string):string => {if(!value?.trim())throw new Error(`Expected --${name}`);return value;};
const read = async <T>(file:string):Promise<T> => JSON.parse(await fs.readFile(file,'utf8')) as T;
async function save(file:string,value:unknown):Promise<void> {
  const handle=await fs.open(file,'wx',0o600);
  try {await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();} finally {await handle.close();}
}
async function exists(file:string):Promise<boolean>{try{await fs.access(file);return true;}catch{return false;}}
type Manifest = { version:1; createdAt:string; sourceRevision:string; selection:ReturnType<typeof selectBulkRepertoireWords>;
  words:Array<{wordId:string;snapshot:BulkWordSnapshot}> };
type Bundle={version:1;operationId:string;actorId:string;results:BulkWordResult[]};
if(positionals.length!==1)throw new Error('Use plan, generate, report, bundle, or apply');
if(positionals[0]==='plan') {
  const database=required(values.database,'database');
  const db=new DatabaseSync(database,{readOnly:true});setDb(db);
  try {
    db.exec('BEGIN');assertSchemaCurrent(db);
    const createdAt=new Date().toISOString(),selection=selectBulkRepertoireWords(db,Number(values.limit),createdAt);
    const manifest:Manifest={version:1,createdAt,sourceRevision:required(values['source-revision'],'source-revision'),selection,
      words:selection.words.map(item=>({...item,snapshot:snapshotBulkRepertoireWord(item.wordId)}))};
    await save(required(values.out,'out'),manifest);
    console.log(JSON.stringify({selected:manifest.words.length,eligible:selection.eligibleWordCount,exclusions:selection.excludedWordCounts}));
    db.exec('ROLLBACK');
  }finally{db.close();setDb(null);}
}else if(positionals[0]==='generate') {
  const manifest=await read<Manifest>(required(values.input,'input'));
  const limit=Number(values.limit);
  if(manifest.version!==1||!Number.isSafeInteger(limit)||limit<1||!Array.isArray(manifest.words))throw new Error('Invalid cohort');
  const words=manifest.words.slice(0,limit);
  const directory=path.resolve(required(values.out,'out'));await fs.mkdir(directory,{recursive:true,mode:0o700});
  const configuration={version:1,inputHash:bulkHash(manifest),wordIds:words.map(w=>w.wordId),model:values.model!,reasoningEffort:values.effort!};
  const configFile=path.join(directory,'configuration.json');
  if(await exists(configFile)){if(bulkHash(await read(configFile))!==bulkHash(configuration))throw new Error('Run directory belongs to different inputs');}
  else await save(configFile,configuration);
  if(!values['allow-provider-calls']){console.log(JSON.stringify({planned:words.length,...configuration}));process.exit(0);}
  const lockFile=path.join(directory,'run.lock');
  if(await exists(lockFile)){
    const owner=await read<{pid:number;host:string}>(lockFile);
    if(!values['recover-run-lock']||owner.host!==hostname())throw new Error('Run lock exists; inspect its process before recovery');
    let alive=true;try{process.kill(owner.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}
    if(alive)throw new Error('Run is still active');await fs.unlink(lockFile);
  }
  await save(lockFile,{pid:process.pid,host:hostname(),startedAt:new Date().toISOString()});
  try {
  const apiKey=process.env.OPENAI_API_KEY?.trim();if(!apiKey)throw new Error('OPENAI_API_KEY is required');
  const attemptsDirectory=path.join(directory,'attempts');await fs.mkdir(attemptsDirectory,{recursive:true,mode:0o700});
  const responsesDirectory=path.join(directory,'responses');await fs.mkdir(responsesDirectory,{recursive:true,mode:0o700});
  const startsDirectory=path.join(directory,'starts');await fs.mkdir(startsDirectory,{recursive:true,mode:0o700});
  const oldStarts=await Promise.all((await fs.readdir(startsDirectory)).map(name=>read<BulkStart>(path.join(startsDirectory,name))));
  const oldAttempts=await Promise.all((await fs.readdir(attemptsDirectory)).map(name=>read<BulkAttempt>(path.join(attemptsDirectory,name))));
  const oldResponses=await Promise.all((await fs.readdir(responsesDirectory)).map(name=>read<BulkResponse>(path.join(responsesDirectory,name))));
  const dispatcher=createBulkDispatcher({concurrency:Number(values.concurrency),probeLimits:true,onStart:async start=>{
    await save(path.join(startsDirectory,`${start.attemptId}.json`),start);
  },onResponse:async response=>{
    await save(path.join(responsesDirectory,`${randomUUID()}.json`),{...response,cost:costForBulkResponse(response.request.model,response.body)});
  },onAttempt:async attempt=>{
    await save(path.join(attemptsDirectory,`${randomUUID()}.json`),{...attempt,cost:attempt.result?costForBulkResult(attempt.result):{spendUsd:null,spendSource:'unknown',pricing:null}});
  }});
  const outcomes=await Promise.allSettled(words.map(async ({wordId,snapshot},index)=>{
    const folder=path.join(directory,String(index).padStart(4,'0'));await fs.mkdir(folder,{recursive:true,mode:0o700});
    const finalFile=path.join(folder,'result.json');
    const workflowId=`bulk:${configuration.inputHash}:${values.model}:${values.effort}:${wordId}`;
    if(await exists(finalFile)){
      const retained=await read<BulkWordResult>(finalFile);
      if(retained.snapshotHash!==bulkHash(snapshot)||retained.model!==values.model||retained.reasoningEffort!==values.effort
        ||retained.calls.some(call=>call.request.provenance?.workflowId!==workflowId))throw new Error('Completed result belongs to a different cohort entry');
      await verifyBulkWord(retained);return;
    }
    let callIndex=0;
    const adapter:ProviderAdapter={...dispatcher.adapter,async run(request,config){
      const file=path.join(folder,`call-${callIndex++}.json`);
      if(await exists(file)){
        const saved=await read<BulkCall>(file);
        if(bulkHash(saved.request)!==bulkHash(request))throw new Error('Cached request contract changed');
        return saved.result;
      }
      const prior=oldAttempts.filter(attempt=>bulkHash(attempt.request)===bulkHash(request));
      const success=prior.find(attempt=>attempt.result);
      if(success?.result){await save(file,{...success,cost:costForBulkResult(success.result)});return success.result;}
      const response=oldResponses.find(response=>response.responseStatus===200&&bulkHash(response.request)===bulkHash(request));
      if(response){
        const parsed=parseResponse('openai','json_schema',response.body as import('../server/llm/types.ts').JsonValue);
        await save(file,{request,result:parsed,startedAt:response.startedAt,finishedAt:response.receivedAt,latencyMs:Date.parse(response.receivedAt)-Date.parse(response.startedAt),cost:costForBulkResult(parsed)});
        return parsed;
      }
      const startedFile=file+'.started';
      const unmatchedStart=oldStarts.some(start=>bulkHash(start.request)===bulkHash(request)&&!prior.some(attempt=>attempt.attemptId===start.attemptId));
      const legacyUncertain=await exists(startedFile)&&!oldStarts.some(start=>bulkHash(start.request)===bulkHash(request));
      if((prior.some(attempt=>attempt.error?.outcomeUnknown)||unmatchedStart||legacyUncertain)&&!values['retry-uncertain'])
        throw new Error('Previous provider outcome is uncertain; inspect retained evidence before --retry-uncertain');
      if(!await exists(startedFile))await save(startedFile,{request,startedAt:new Date().toISOString()});
      const startedAt=new Date().toISOString(),start=performance.now();
      const result=await dispatcher.adapter.run(request,config);
      await save(file,{request,result,startedAt,finishedAt:new Date().toISOString(),latencyMs:performance.now()-start,cost:costForBulkResult(result)});
      return result;
    }};
    console.log(JSON.stringify({event:'started',wordId,hanzi:snapshot.word.hanzi,model:values.model}));
    const result=await generateBulkWord(snapshot,{model:values.model!,reasoningEffort:values.effort!,adapter,apiKey,
      baseUrl:process.env.OPENAI_BASE_URL?.trim()||null,workflowId});
    // Preserve original timing when resuming cached outputs.
    result.calls=await Promise.all(result.calls.map((_call,i)=>read<BulkCall>(path.join(folder,`call-${i}.json`))));
    await verifyBulkWord(result);await save(finalFile,result);
    console.log(JSON.stringify({event:'finished',wordId,hanzi:snapshot.word.hanzi,status:result.status,calls:result.calls.length}));
  }));
  const failures=outcomes.flatMap((outcome,index)=>outcome.status==='rejected'?[{wordId:words[index]!.wordId,error:outcome.reason instanceof Error?outcome.reason.name:'UnknownError'}]:[]);
  await save(path.join(directory,`completion-${randomUUID()}.json`),{completed:words.length-failures.length,failures,dispatcher:dispatcher.stats()});
  console.log(JSON.stringify({completed:words.length-failures.length,failures}));if(failures.length)process.exitCode=1;
  }finally{await fs.unlink(lockFile);}
}else if(positionals[0]==='bundle') {
  const directory=path.resolve(required(values.input,'input'));
  const configuration=await read<{model:string;reasoningEffort:string;wordIds:string[]}>(path.join(directory,'configuration.json'));
  const results:BulkWordResult[]=[];
  for(const name of (await fs.readdir(directory)).filter(name=>/^\d{4}$/.test(name)).sort()){
    const file=path.join(directory,name,'result.json');if(!await exists(file))continue;
    const result=await read<BulkWordResult>(file);await verifyBulkWord(result);
    if(result.snapshot.word.wordId!==configuration.wordIds[Number(name)]||result.model!==configuration.model||result.reasoningEffort!==configuration.reasoningEffort)throw new Error('Result does not belong to the run');
    if(result.status==='ready')results.push(result);
  }
  if(!results.length)throw new Error('No ready results');
  const bundle:Bundle={version:1,operationId:required(values['operation-id'],'operation-id'),actorId:required(values.actor,'actor'),results};
  await save(required(values.out,'out'),bundle);console.log(JSON.stringify({words:results.length,sha256:bulkHash(bundle)}));
}else if(positionals[0]==='apply') {
  const bundle=await read<Bundle>(required(values.input,'input'));
  if(bundle.version!==1||!Array.isArray(bundle.results)||!bundle.results.length||new Set(bundle.results.map(result=>result.snapshot.word.wordId)).size!==bundle.results.length
    ||bulkHash(bundle)!==required(values['expected-sha256'],'expected-sha256'))throw new Error('Invalid bundle or digest');
  if(!values['confirm-app-stopped'])throw new Error('Stop application writers and verify a backup before --confirm-app-stopped');
  const database=required(values.database,'database');
  if(!path.isAbsolute(database)||!(await fs.stat(database)).isFile())throw new Error('Database must be an existing absolute file');
  const receipt=await fs.open(required(values.out,'out'),'wx',0o600);
  const db=new DatabaseSync(database);setDb(db);db.function('current_learner_id',()=>{throw new Error('Bulk operations require explicit learner identity');});
  try{
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');assertSchemaCurrent(db);
    const outcomes=[];
    for(const result of bundle.results){
      try{outcomes.push({status:'applied',...await applyBulkRepertoireWord(result,{operationId:bundle.operationId,actorId:bundle.actorId,confirmAppStopped:true})});}
      catch(error){outcomes.push({status:'blocked',wordId:result.snapshot.word.wordId,reason:error instanceof Error?error.message:'Unknown error'});}
      await receipt.write(JSON.stringify(outcomes[outcomes.length-1])+'\n');await receipt.sync();
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok')throw new Error('Post-application integrity check failed; keep service closed');
    const blocked=outcomes.filter(item=>item.status==='blocked').length;
    console.log(JSON.stringify({applied:outcomes.length-blocked,blocked,integrity:'ok'}));if(blocked)process.exitCode=1;
  }finally{db.close();setDb(null);await receipt.close();}
}else if(positionals[0]==='report') {
  const directory=path.resolve(required(values.input,'input'));
  const report=await reportBulkRepertoire(directory);
  if(values.out)await save(values.out,report);else console.log(JSON.stringify(report,null,2));
}else throw new Error('Use plan, generate, report, bundle, or apply');
