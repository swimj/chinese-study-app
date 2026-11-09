import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bulkHash, generateBulkWord, verifyBulkWord, type BulkWordSnapshot } from '../server/vocabulary/bulk-repertoire.ts';
import { parseResponse } from '../server/llm/openai-compatible.ts';
import type { ProviderAdapter } from '../server/llm/types.ts';
import { reportBulkRepertoire } from '../scripts/lib/bulk-repertoire-report.ts';
import { costForBulkResult } from '../server/llm/bulk-repertoire-pricing.ts';
import { createBulkDispatcher } from '../scripts/lib/bulk-repertoire-dispatch.ts';
const exec=promisify(execFile);
const snapshot:BulkWordSnapshot={word:{wordId:'word',hanzi:'你好',traditional:null,pinyin:'nǐ hǎo',meanings:['hello']},
  catalog:{wordId:'word',version:1,establishedAt:'2026-01-01T00:00:00.000Z'},
  senses:[{wordId:'word',senseId:'sense',version:1,status:'active',description:{label:'greeting',notes:[]},createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}],
  coverage:{wordId:'word',version:1,defaultUsefulSenseIds:['sense'],excludedSenseIds:[]},hasBootstrap:false,fallbacks:[]};
const adapter:ProviderAdapter={id:'openai',defaultBaseUrl:'',apiKeyEnvironmentVariable:'',structuredOutputMode:'json_schema',async run(){
  return parseResponse('openai','json_schema',{id:'test-response',model:'gpt-6-sol',choices:[{message:{content:JSON.stringify({exercises:[{id:'one',sourceUseId:'s1',stimulus:{kind:'direct_text',text:'Hello.'},teachingNote:null}]})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}});
}};
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bulk-resume-')),directory=path.join(root,'run'),manifest={version:1,words:[{wordId:'word',snapshot}]};
  const configuration={version:1,inputHash:bulkHash(manifest),wordIds:['word'],model:'gpt-6-sol',reasoningEffort:'high'};
  const result=await generateBulkWord(snapshot,{model:'gpt-6-sol',reasoningEffort:'high',adapter,apiKey:'fake',baseUrl:null,workflowId:`bulk:${configuration.inputHash}:gpt-6-sol:high:word`});
  await fs.mkdir(path.join(directory,'0000'),{recursive:true});await fs.mkdir(path.join(directory,'attempts'));
  const save=async(file:string,value:unknown)=>fs.writeFile(path.join(directory,file),JSON.stringify(value));
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));await save('configuration.json',configuration);
  const run=()=>exec(process.execPath,['--import','tsx','scripts/bulk-repertoire.ts','generate',`--input=${root}/manifest.json`,`--out=${directory}`,'--limit=1','--allow-provider-calls'],
    {env:{...process.env,OPENAI_API_KEY:'fake',OPENAI_BASE_URL:'http://127.0.0.1:1',APP_USE_LOCAL_PROVIDER_PROXY:'false'}});
  return {root,directory,result,save,run};
}
test('resume recovers a retained paid success without a stage file or a network request',async()=>{
  const f=await fixture();try{
    await f.save('attempts/success.json',{...f.result.calls[0],attempt:1});
    const output=await f.run();assert.match(output.stdout,/"completed":1/);
    const saved=JSON.parse(await fs.readFile(path.join(f.directory,'0000/result.json'),'utf8'));await verifyBulkWord(saved);
    assert.equal(saved.calls[0].result.responseId,'test-response');
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('resume blocks an uncertain dispatched request rather than spending again',async()=>{
  const f=await fixture();try{
    await f.save('0000/call-0.json.started',{request:f.result.calls[0]!.request});
    await assert.rejects(f.run());
    assert.equal((await fs.readdir(path.join(f.directory,'attempts'))).length,0);
    await assert.rejects(fs.access(path.join(f.directory,'0000/result.json')));
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('resume does not repeat a paid response whose archive failed',async()=>{
  const f=await fixture();try{
    await fs.mkdir(path.join(f.directory,'starts'));
    const request=f.result.calls[0]!.request;let networkCalls=0;
    const dispatcher=createBulkDispatcher({
      fetchImplementation:async()=>{networkCalls++;return new Response(JSON.stringify(f.result.calls[0]!.result.rawResponse));},
      onStart:start=>f.save(`starts/${start.attemptId}.json`,start),
      onResponse:()=>{throw new Error('response archive unavailable');},
      onAttempt:attempt=>f.save(`attempts/${attempt.attemptId}.json`,attempt),
    });
    await assert.rejects(dispatcher.adapter.run(request,{apiKey:'fake',baseUrl:null}),/response archive unavailable/);
    assert.equal(networkCalls,1);await assert.rejects(f.run());
    assert.equal((await fs.readdir(path.join(f.directory,'attempts'))).length,1);
    await assert.rejects(fs.access(path.join(f.directory,'0000/result.json')));
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('completed results are bound to their manifest and provider raw source',async()=>{
  const f=await fixture();try{
    const wrong=structuredClone(f.result);wrong.model='gpt-6-astra';await f.save('0000/result.json',wrong);await assert.rejects(f.run());
    const changed=structuredClone(f.result);changed.calls[0]!.result.rawText='{}';await assert.rejects(verifyBulkWord(changed),/disagrees/);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('an active run lock excludes another process before dispatch',async()=>{
  const f=await fixture();try{
    await f.save('run.lock',{pid:process.pid,host:os.hostname()});await assert.rejects(f.run());
    assert.equal((await fs.readdir(path.join(f.directory,'attempts'))).length,0);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('an earlier 429 cannot hide an interrupted later network attempt',async()=>{
  const f=await fixture();try{
    const request=f.result.calls[0]!.request,startedAt=new Date().toISOString();
    await fs.mkdir(path.join(f.directory,'starts'));
    await f.save('starts/retry.json',{attemptId:'retry',attempt:2,request,startedAt});
    await f.save('attempts/429.json',{attemptId:'first',attempt:1,request,startedAt,finishedAt:startedAt,latencyMs:1,error:{name:'ProviderHttpError',httpStatus:429,outcomeUnknown:false}});
    await assert.rejects(f.run());assert.equal((await fs.readdir(path.join(f.directory,'attempts'))).length,1);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('cost report retains raw-only and malformed paid responses and counts complete evidence once',async()=>{
  const f=await fixture();try{
    const call=f.result.calls[0]!,expected=costForBulkResult(call.result).spendUsd!;
    await fs.mkdir(path.join(f.directory,'responses'));await fs.mkdir(path.join(f.directory,'starts'));
    const start={attemptId:'paid',attempt:1,request:call.request,startedAt:call.startedAt};
    await f.save('starts/paid.json',start);
    await f.save('responses/paid.json',{...start,receivedAt:call.finishedAt,responseStatus:200,body:call.result.rawResponse});
    assert.equal((await reportBulkRepertoire(f.directory)).knownCostUsd,expected);
    await f.save('attempts/paid.json',{...call,...start});
    const report=await reportBulkRepertoire(f.directory);assert.equal(report.calls.length,1);assert.equal(report.knownCostUsd,expected);
    const bad={...start,attemptId:'malformed'};
    await f.save('responses/malformed.json',{...bad,receivedAt:call.finishedAt,responseStatus:200,body:{model:'gpt-6-sol',usage:{prompt_tokens:100,completion_tokens:30}}});
    await f.save('attempts/malformed.json',{...bad,finishedAt:call.finishedAt,latencyMs:1,error:{name:'Error',httpStatus:200,outcomeUnknown:false},cost:{spendUsd:null,spendSource:'unknown',pricing:null}});
    assert.equal((await reportBulkRepertoire(f.directory)).knownCostUsd,expected*2);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('cost report exposes corrections without rewriting historical estimates',async()=>{
  const f=await fixture();try{
    const call=f.result.calls[0]!,previous={spendUsd:123,spendSource:'estimated',pricing:null};
    await f.save('attempts/old.json',{...call,attempt:1,cost:previous});
    const report=await reportBulkRepertoire(f.directory);
    assert.equal(report.knownCostUsd,costForBulkResult(call.result).spendUsd);
    assert.deepEqual(report.calls[0]!.costCorrection?.previous,previous);
    assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,'attempts/old.json'),'utf8')).cost.spendUsd,123);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
