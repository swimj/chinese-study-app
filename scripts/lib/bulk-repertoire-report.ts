import fs from 'node:fs/promises';
import path from 'node:path';
import { bulkHash } from '../../server/vocabulary/bulk-repertoire.ts';
import { costForBulkResult, costForBulkResponse } from '../../server/llm/bulk-repertoire-pricing.ts';
import type { BulkAttempt, BulkResponse, BulkStart } from './bulk-repertoire-dispatch.ts';

async function records<T>(directory:string):Promise<Array<T&{file:string}>>{
  let files:string[];try{files=await fs.readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  return Promise.all(files.filter(file=>file.endsWith('.json')).map(async file=>({...JSON.parse(await fs.readFile(path.join(directory,file),'utf8')) as T,file})));
}
type Cost=ReturnType<typeof costForBulkResult>;
/** Union transport evidence by attempt identity so a crash cannot erase a paid response from reporting. */
export async function reportBulkRepertoire(directory:string){
  const [starts,responses,attempts]=await Promise.all([records<BulkStart>(path.join(directory,'starts')),records<BulkResponse&{cost?:Cost}>(path.join(directory,'responses')),records<BulkAttempt&{cost?:Cost}>(path.join(directory,'attempts'))]);
  const rows=new Map<string,{start?:BulkStart;response?:BulkResponse&{cost?:Cost};attempt?:BulkAttempt&{cost?:Cost}}>();
  for(const start of starts)rows.set(start.attemptId,{start});
  for(const attempt of attempts){const key=attempt.attemptId??`legacy:${attempt.file}`;rows.set(key,{...rows.get(key),attempt});}
  for(const response of responses){
    const legacy=attempts.find(attempt=>!attempt.attemptId&&attempt.attempt===response.attempt&&bulkHash(attempt.request)===bulkHash(response.request)
      &&attempt.startedAt<=response.receivedAt&&attempt.finishedAt>=response.receivedAt);
    const key=response.attemptId??(legacy?`legacy:${legacy.file}`:`response:${response.file}`);
    rows.set(key,{...rows.get(key),response});
  }
  const calls=[...rows].map(([attemptId,row])=>{
    const evidence=row.attempt??row.response??row.start!;
    const calculated=row.response?costForBulkResponse(evidence.request.model,row.response.body):row.attempt?.result?costForBulkResult(row.attempt.result):{spendUsd:null,spendSource:'unknown' as const,pricing:null};
    const retained=row.response?row.response.cost:row.attempt?.cost;
    // Preserve historical estimates while accounting from the complete retained response.
    const costCorrection=retained&&bulkHash(retained)!==bulkHash(calculated)
      ? {previous:retained,reason:'Recomputed from retained provider usage with current pinned accounting'}:null;
    const wire=JSON.parse(evidence.request.userPrompt) as {word?:{hanzi?:string};content?:{word?:{hanzi?:string}}};
    return {attemptId,model:evidence.request.model,word:wire.word?.hanzi??wire.content?.word?.hanzi??'',workflowId:evidence.request.provenance?.workflowId,
      stage:evidence.request.provenance?.stepName,startedAt:evidence.startedAt,
      latencyMs:row.attempt?.latencyMs??(row.response?Date.parse(row.response.receivedAt)-Date.parse(row.response.startedAt):null),
      usage:row.attempt?.result?.usage??null,...calculated,costCorrection};
  });
  function aggregate(key:(call:typeof calls[number])=>string){
    const groups=new Map<string,typeof calls>();for(const call of calls){const id=key(call),list=groups.get(id)??[];list.push(call);groups.set(id,list);}
    return [...groups].map(([key,items])=>({key,calls:items.length,knownCostUsd:items.reduce((sum,item)=>sum+(item.spendUsd??0),0),
      unknownCostCalls:items.filter(item=>item.spendUsd===null).length,totalLatencyMs:items.reduce((sum,item)=>sum+(item.latencyMs??0),0)}));
  }
  return {calls,perWord:aggregate(call=>`${call.model}:${call.word}`),perModel:aggregate(call=>call.model),
    knownCostUsd:calls.reduce((sum,call)=>sum+(call.spendUsd??0),0),unknownCostCalls:calls.filter(call=>call.spendUsd===null).length};
}
