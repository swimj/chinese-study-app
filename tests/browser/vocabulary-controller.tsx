import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useVocabularyStudy} from '../../src/features/vocabulary-study/useVocabularyStudy';
import {projectVocabularySession,type VocabularySessionAction,type VocabularySessionInitialContext} from '../../src/domain/vocabulary-session';
import type {VocabularyStudy} from '../../src/domain/vocabulary-study-api';
import type {VocabularySessionCompletion} from '../../src/domain/vocabulary-session-api';

const context:VocabularySessionInitialContext={sessionId:'fixture',words:[{wordId:'word',mode:'practice'}]};
const time=()=>new Date().toISOString();
const initial:VocabularySessionAction[]=[
  {kind:'presentation',payload:{encounterId:'encounter',wordId:'word',snapshot:{contentId:'content',contentVersion:1,kind:'production',role:'general',body:{prompt:'A prepared cue'},assessment:{acceptedAnswers:['字']}}}},
  {kind:'response',payload:{encounterId:'encounter',response:'字',outcome:'accepted'}},
  {kind:'finish_for_now',payload:{}},
  {kind:'finish_immediately',payload:{}},
].map((action,index)=>({...action,actionId:`action-${index+1}`,clientActionId:`client-${index+1}`,protocolVersion:1,sequence:index+1,occurredAt:time()} as VocabularySessionAction));
let actions=[...initial],completion:VocabularySessionCompletion|null=null,status:'active'|'finalizing'|'closed'='active';
let stageCalls=0,cancelCalls=0,resumeCalls=0,undoCalls=0;
const mode=new URLSearchParams(location.search).get('mode')??'resume';
function study():VocabularyStudy {
  const projection=projectVocabularySession(context,actions);
  return {session:{sessionId:'fixture',status,context,actions,projection,completion},words:[{wordId:'word',hanzi:'字',traditional:null,pinyin:'zì',meaning:'character'}],
    currentWordId:'word',currentEncounter:projection.encounters.at(-1)??null,
    controls:{canNext:true,canSkip:true,canEnough:true,canMore:false,canUndo:projection.latestUndoableActionId!==null,canFinishForNow:projection.phase==='active',canFinishImmediately:projection.phase==='finishing',canChangeMode:true},notice:null};
}
const pause=(milliseconds:number)=>new Promise<void>((resolve)=>setTimeout(resolve,milliseconds));
window.fetch=async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/api/vocabulary/completion/current'))return Response.json(null);
  if(url.endsWith('/api/vocabulary/sessions'))return Response.json(study());
  if(url.endsWith('/completion/cancel')){
    cancelCalls++;if(!completion)throw new Error('Missing completion');
    completion={...completion,status:'cancelled',canUndo:false};status='active';await pause(20);return Response.json(completion);
  }
  if(url.endsWith('/completion')&&init?.method==='POST'){
    stageCalls++;
    const now=time();completion={completionId:`completion-${stageCalls}`,sessionId:'fixture',revisionNumber:stageCalls,throughSequence:actions.length,
      stagedAt:now,closeAt:new Date(Date.now()+15000).toISOString(),serverNow:now,status:'pending',closedAt:null,report:projectVocabularySession(context,actions),error:null,canUndo:true,metadata:{activeDurationMs:0,source:'client_visibility_and_focus'}};
    status='finalizing';await pause(10);return Response.json(completion);
  }
  if(url.endsWith('/completion'))return Response.json(completion);
  if(url.endsWith('/commands')){
    const body=JSON.parse(String(init?.body)) as {clientActionId:string;command:{type:string}};
    await pause(60); // Let any unsafe auto-stage effect run between cancellation and this command.
    if(status!=='active')return Response.json({error:'Cancel the completion revision before resuming study'},{status:409});
    const projection=projectVocabularySession(context,actions);
    const payload=body.command.type==='undo'?{undoesActionId:projection.latestUndoableActionId!}:{};
    if(body.command.type==='resume')resumeCalls++;else if(body.command.type==='undo')undoCalls++;
    actions.push({kind:body.command.type,payload,actionId:`action-${actions.length+1}`,clientActionId:body.clientActionId,sequence:actions.length+1,protocolVersion:1,occurredAt:time()} as VocabularySessionAction);
    return Response.json(study());
  }
  if(url.endsWith('/sessions/fixture')){await pause(20);return Response.json(study());}
  throw new Error(`Unexpected fixture request ${url}`);
};
function Fixture(){
  const [result,setResult]=useState('Running');const begun=useRef(false),transitioned=useRef(false),checked=useRef(false);
  const controller=useVocabularyStudy();
  useEffect(()=>{if(!begun.current){begun.current=true;void controller.start();}},[]);
  useEffect(()=>{
    if(controller.completion?.status==='pending'&&!transitioned.current){transitioned.current=true;void(mode==='undo'?controller.undo():controller.resume());}
  },[controller.completion]);
  useEffect(()=>{
    const phase=controller.study?.session.projection.phase;
    if(transitioned.current&&!controller.busy&&phase&&phase!=='completed'&&!checked.current){
      checked.current=true;
      const valid=stageCalls===1&&cancelCalls===1&&(mode==='undo'?undoCalls===1&&phase==='finishing':resumeCalls===1&&phase==='active')
        &&controller.study?.session.projection.encounters[0].responses.length===1&&!controller.error;
      setResult(valid?'PASS':`FAIL stage=${stageCalls} cancel=${cancelCalls} resume=${resumeCalls} undo=${undoCalls} phase=${phase}`);
    }
    if(controller.error)setResult(`FAIL ${controller.error}`);
  },[controller.study,controller.busy,controller.error]);
  return <main><h1>Vocabulary controller: {mode}</h1><p id="result" data-result={result}>{result}</p><p>Real hook, delayed server responses, fixed deadline, no active-session recovery.</p></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
