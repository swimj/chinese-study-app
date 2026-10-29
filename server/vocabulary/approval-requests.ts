import fs from 'node:fs';
import path from 'node:path';
import type { VocabularyApprovalRequest } from '../../src/domain/vocabulary-reflection.ts';
import { config } from '../db/connection.ts';
import { completeVocabularyApprovalRequest, getVocabularyProposal, VocabularyReflectionConflict } from '../db/vocabulary-reflection.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';

type Authorization = Pick<VocabularyApprovalRequest,'requestId'|'proposalId'|'expectedVersion'|'actorId'|'notes'>;
const sameAuthorization = (left:Authorization,right:Authorization) => left.requestId===right.requestId
  &&left.proposalId===right.proposalId&&left.expectedVersion===right.expectedVersion
  &&left.actorId===right.actorId&&JSON.stringify(left.notes)===JSON.stringify(right.notes);

/** A single writer owns this journal. Memory is only its replayed scheduling index. */
export function createVocabularyApprovalRequests(options:{
  filePath:string; now?:()=>number; controls?:()=>{maintenanceMode:boolean}; pollMs?:number;
  complete?:(input:Authorization)=>VocabularyApprovalRequest['application']; onError?:(error:unknown)=>void;
}) {
  const now=options.now??Date.now,controls=options.controls??getHostedServiceControls;
  const complete=options.complete??completeVocabularyApprovalRequest;
  const items=new Map<string,VocabularyApprovalRequest>();
  let loaded=false,stopped=false,timer:ReturnType<typeof setTimeout>|undefined,lastCompacted=now();
  const iso=()=>new Date(now()).toISOString();
  function load():void {
    if(loaded)return;
    fs.mkdirSync(path.dirname(options.filePath),{recursive:true});
    if(fs.existsSync(options.filePath)) {
      const bytes=fs.readFileSync(options.filePath);
      const end=bytes.lastIndexOf(10)+1;
      // Only newline-terminated records are committed; a torn final append is discarded.
      for(const line of bytes.subarray(0,end).toString('utf8').split('\n').filter(Boolean)) {
        const item=JSON.parse(line) as VocabularyApprovalRequest;
        if(!item||typeof item.requestId!=='string'||!item.requestId||typeof item.proposalId!=='string'
          ||!Number.isSafeInteger(item.expectedVersion)||item.expectedVersion<1||typeof item.actorId!=='string'
          ||!['queued','running','succeeded','attention'].includes(item.status)||!Number.isSafeInteger(item.attempts)
          ||!Number.isFinite(Date.parse(item.createdAt))||!Number.isFinite(Date.parse(item.updatedAt))
          ||!('notes' in item)||!('error' in item)||!('application' in item)) {
          throw new Error('Invalid committed vocabulary approval journal record');
        }
        const previous=items.get(item.requestId);
        if(previous&&!sameAuthorization(previous,item))throw new Error('Vocabulary approval journal authorization changed');
        items.set(item.requestId,item);
      }
      if(end!==bytes.length)fs.truncateSync(options.filePath,end);
    }
    loaded=true;
  }
  function append(item:VocabularyApprovalRequest):VocabularyApprovalRequest {
    const previous=items.get(item.requestId);
    if(previous&&item.updatedAt<=previous.updatedAt)item={...item,updatedAt:new Date(Date.parse(previous.updatedAt)+1).toISOString()};
    // A failed append leaves the in-memory index unchanged and prevents acknowledgement.
    const start=fs.existsSync(options.filePath)?fs.statSync(options.filePath).size:0;
    try { fs.appendFileSync(options.filePath,`${JSON.stringify(item)}\n`,{encoding:'utf8',mode:0o600}); }
    catch(error) { if(fs.existsSync(options.filePath))fs.truncateSync(options.filePath,start);throw error; }
    items.set(item.requestId,item);
    return structuredClone(item);
  }
  function list():VocabularyApprovalRequest[] {
    load();return [...items.values()].map(item=>structuredClone(item));
  }
  function enqueue(input:Authorization):VocabularyApprovalRequest {
    load();
    const previous=items.get(input.requestId);
    if(previous) {
      if(!sameAuthorization(previous,input))throw new VocabularyReflectionConflict('Request ID belongs to another approval');
      return structuredClone(previous);
    }
    // Admission checks the exact revision, but preview, validation, and all writes wait for the worker.
    const proposal=getVocabularyProposal(input.proposalId,input.actorId);
    if(proposal.version!==input.expectedVersion)throw new VocabularyReflectionConflict('Proposal version changed; review the current preview');
    const active=[...items.values()].find(item=>item.proposalId===input.proposalId&&item.expectedVersion===input.expectedVersion
      &&['queued','running'].includes(item.status));
    if(active)throw new VocabularyReflectionConflict('This proposal revision already has a queued approval');
    const at=iso();
    return append({...input,status:'queued',attempts:0,createdAt:at,updatedAt:at,error:null,application:null});
  }
  function retry(requestId:string,actorId:string):VocabularyApprovalRequest {
    load();const item=items.get(requestId);
    if(!item)throw new VocabularyReflectionConflict('Unknown approval request');
    if(item.actorId!==actorId)throw new VocabularyReflectionConflict('Approval request belongs to another operator');
    if(item.status!=='attention')throw new VocabularyReflectionConflict('Only attention requests can be retried');
    return append({...item,status:'queued',attempts:0,updatedAt:iso(),error:null});
  }
  function compact():void {
    load();
    const succeeded=[...items.values()].filter(item=>item.status==='succeeded');
    const retained=new Set(succeeded.slice(-1000).map(item=>item.requestId));
    const tail=[...items.values()].filter(item=>{
      if(item.status==='succeeded')return retained.has(item.requestId);
      if(item.status!=='attention')return true;
      const current=getVocabularyProposal(item.proposalId,item.actorId);
      return current.version===item.expectedVersion&&!['closed','applied'].includes(current.status);
    });
    const temporary=`${options.filePath}.compact`;
    fs.writeFileSync(temporary,tail.map(item=>JSON.stringify(item)+'\n').join(''),{encoding:'utf8',mode:0o600});
    fs.renameSync(temporary,options.filePath);
    items.clear();for(const item of tail)items.set(item.requestId,item);
    lastCompacted=now();
  }
  function step():boolean {
    load();if(stopped||controls().maintenanceMode)return false;
    const item=[...items.values()].find(item=>item.status==='queued'||item.status==='running');
    if(!item) {if(now()-lastCompacted>=60_000)compact();return false;}
    const running=append({...item,status:'running',attempts:item.attempts+1,updatedAt:iso()});
    let application:VocabularyApprovalRequest['application'];
    try {
      application=complete(running);
      if(!application)throw new Error('Approval application returned no receipt');
    }catch(error) {
      const code=error!==null&&typeof error==='object'&&'code' in error?String(error.code):'';
      const sqliteCode=error!==null&&typeof error==='object'&&'errcode' in error?Number(error.errcode)&255:0;
      const transient=[5,6].includes(sqliteCode)
        ||['SQLITE_BUSY','SQLITE_LOCKED','EIO','ENOSPC','EMFILE','ENFILE'].some(value=>code.startsWith(value));
      const message=error instanceof Error?error.message:'Approval failed';
      // Replay always calls complete first, including after a committed application whose log append failed.
      append({...running,status:transient&&running.attempts<3?'queued':'attention',updatedAt:iso(),error:message});
      if(!transient&&!(error instanceof VocabularyReflectionConflict)&&!(error instanceof TypeError))options.onError?.(error);
      return true;
    }
    // Journal failure after SQLite commit must leave this running for receipt reconciliation.
    append({...running,status:'succeeded',updatedAt:iso(),error:null,application});
    if(now()-lastCompacted>=60_000)compact();
    return true;
  }
  function wake():void {
    if(stopped||timer)return;
    // Never execute work in the admission request; yield between individual applications.
    timer=setTimeout(()=>{
      timer=undefined;
      try{step();}catch(error){options.onError?.(error);}
      wake();
    },options.pollMs??250);timer.unref();
  }
  return {enqueue,list,retry,compact,step,wake,stop(){stopped=true;if(timer)clearTimeout(timer);}};
}

let runtime:ReturnType<typeof createVocabularyApprovalRequests>|undefined,runtimePath:string|undefined;
export function getVocabularyApprovalRequests() {
  const filePath=path.join(config.dataDir,'vocabulary-approval-requests.jsonl');
  if(runtimePath!==filePath) {
    runtime?.stop();runtime=createVocabularyApprovalRequests({filePath,onError:error=>console.error('Vocabulary approval worker failed',error)});
    runtimePath=filePath;
  }
  return runtime!;
}
