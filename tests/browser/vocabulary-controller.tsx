import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useVocabularyStudy} from '../../src/features/vocabulary-study/useVocabularyStudy';
import {projectVocabularySession,type VocabularySessionAction,type VocabularySessionInitialContext} from '../../src/domain/vocabulary-session';
import type {VocabularyStudy} from '../../src/domain/vocabulary-study-api';
import type {VocabularySessionCompletion} from '../../src/domain/vocabulary-session-api';

const mode=new URLSearchParams(location.search).get('mode')??'resume';
const ending=mode==='enough'||mode==='skip';
const continuing=mode==='enough-active';
const moreFinishing=mode==='more-finishing';
const context:VocabularySessionInitialContext={sessionId:'fixture',words:[{wordId:'word',mode:'practice'},...(moreFinishing?[{wordId:'other',mode:'practice' as const}]:[])]};
const time=()=>new Date().toISOString();
const initial:VocabularySessionAction[]=[
  {kind:'presentation',payload:{encounterId:'encounter',wordId:'word',snapshot:{contentId:'content',contentVersion:1,kind:'production',role:'general',body:{prompt:'A prepared cue'},assessment:{acceptedAnswers:['字']}}}},
  {kind:'response',payload:{encounterId:'encounter',response:'字',outcome:'accepted'}},
  {kind:'finish_for_now',payload:{}},
  {kind:'finish_immediately',payload:{}},
].map((action,index)=>({...action,actionId:`action-${index+1}`,clientActionId:`client-${index+1}`,protocolVersion:1,sequence:index+1,occurredAt:time()} as VocabularySessionAction));
let actions=ending?initial.filter((action)=>action.kind==='presentation'||action.kind==='finish_for_now').map((action,index)=>({...action,sequence:index+1,actionId:`action-${index+1}`,clientActionId:`client-${index+1}`})):continuing?initial.slice(0,1):[...initial],completion:VocabularySessionCompletion|null=null,status:'active'|'finalizing'|'closed'='active';
if(moreFinishing) {
  const presentation=initial[0];if(presentation.kind!=='presentation')throw new Error('Expected presentation');
  actions=[{...presentation,payload:{...presentation.payload,wordId:'other',encounterId:'other'}},...initial.slice(0,2),
    {...initial[2],kind:'word_wrap',payload:{wordId:'word',reason:'policy'}},initial[2]]
    .map((action,index)=>({...action,sequence:index+1,actionId:`action-${index+1}`,clientActionId:`client-${index+1}`})) as VocabularySessionAction[];
}
let stageCalls=0,cancelCalls=0,resumeCalls=0,undoCalls=0,nextCalls=0,endCalls=0;
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
  if(url.endsWith('/next')){
    nextCalls++;
    if(status!=='active'||study().session.projection.phase==='completed')return Response.json({error:'Session is not accepting new work'},{status:409});
    return Response.json(study());
  }
  if(url.endsWith('/completion/close')){
    if(!completion)throw new Error('Missing completion');
    completion={...completion,status:'closed',closedAt:time(),canUndo:false};status='closed';return Response.json(completion);
  }
  if(url.endsWith('/words'))return Response.json({words:[]});
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
    const end=body.command.type==='enough'||body.command.type==='skip';
    const kind=body.command.type==='more'?'word_more':body.command.type==='enough'?'word_wrap':body.command.type==='skip'?'word_skip':body.command.type;
    const payload=end||body.command.type==='more'?{wordId:'word',...(kind==='word_wrap'?{reason:'enough'}:{})}:body.command.type==='undo'?{undoesActionId:projection.latestUndoableActionId!}:{};
    if(end)endCalls++;
    if(body.command.type==='resume')resumeCalls++;else if(body.command.type==='undo')undoCalls++;
    actions.push({kind,payload,actionId:`action-${actions.length+1}`,clientActionId:body.clientActionId,sequence:actions.length+1,protocolVersion:1,occurredAt:time()} as VocabularySessionAction);
    return Response.json(study());
  }
  if(url.endsWith('/sessions/fixture')){await pause(20);return Response.json(study());}
  throw new Error(`Unexpected fixture request ${url}`);
};
function Fixture(){
  const [result,setResult]=useState('Running');const begun=useRef(false),transitioned=useRef(false),checked=useRef(false);
  const controller=useVocabularyStudy();
  useEffect(()=>{
    if(moreFinishing&&controller.study&&!controller.busy&&!transitioned.current){transitioned.current=true;void controller.resume('word');}
    if(moreFinishing&&transitioned.current&&!controller.busy&&nextCalls===1){
      setResult(resumeCalls===0&&stageCalls===0&&controller.study?.session.projection.phase==='finishing'&&controller.study.session.projection.words.word.workNumber===2&&!controller.error?'PASS':'FAIL More changed wrap-up');
    }
    if((ending||continuing)&&controller.study&&!controller.busy&&!transitioned.current){
      transitioned.current=true;controller.keepSummaryOpenNow();void controller.endWord(mode!=='skip');
    }
    if(ending&&controller.completion?.status==='pending'&&!controller.busy&&!checked.current){
      checked.current=true;void controller.retrySave();
    }
    if(ending&&controller.completion?.status==='closed'&&!controller.busy){
      const word=controller.study?.session.projection.words.word;
      setResult(stageCalls===1&&nextCalls===0&&endCalls===1&&!controller.saving&&!controller.error&&word?.covered===(mode==='enough')?'PASS':`FAIL stage=${stageCalls} next=${nextCalls} end=${endCalls}`);
    }
    if(continuing&&endCalls===1&&!controller.busy)setResult(nextCalls===1&&stageCalls===0&&!controller.error?'PASS':'FAIL active advancement');
  },[controller.study,controller.busy,controller.completion]);
  useEffect(()=>{if(!begun.current){begun.current=true;void controller.start();}},[]);
  useEffect(()=>{
    if(!ending&&!continuing&&!moreFinishing&&controller.completion?.status==='pending'&&!transitioned.current){transitioned.current=true;void(mode==='undo'?controller.undo():controller.resume());}
  },[controller.completion]);
  useEffect(()=>{
    const phase=controller.study?.session.projection.phase;
    if(!ending&&!continuing&&!moreFinishing&&transitioned.current&&!controller.busy&&phase&&phase!=='completed'&&!checked.current){
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
