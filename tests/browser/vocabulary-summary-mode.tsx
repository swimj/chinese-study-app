// Real study controller and surface; synthetic completed study and completion transport.
// Keep summary open, wait for closure, then choose a mode. ?fail=1 fails closure
// until Allow close is selected. ?narrow=1 uses a 420px panel and 125% text.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VocabularyStudy } from '../../src/features/vocabulary-study/VocabularyStudy';
import { useVocabularyStudy } from '../../src/features/vocabulary-study/useVocabularyStudy';
import { projectVocabularySession, type VocabularySessionAction, type VocabularySessionInitialContext, type VocabularyWordMode } from '../../src/domain/vocabulary-session';
import type { VocabularySessionCompletion } from '../../src/domain/vocabulary-session-api';
import type { VocabularyStudy as Study } from '../../src/domain/vocabulary-study-api';
import '../../src/styles.css';
import '../../src/features/session/session-desk.css';

const params=new URLSearchParams(location.search),narrow=params.has('narrow');
const context:VocabularySessionInitialContext={sessionId:'summary-mode',words:[{wordId:'word',mode:'practice',selectedSkill:'recognition'}]};
const time=()=>new Date().toISOString();
type Input=VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A,'kind'|'payload'>:never:never;
const inputs:Input[]=[
  {kind:'presentation',payload:{wordId:'word',encounterId:'recognition',snapshot:{contentId:'recognition',contentVersion:1,kind:'recognition',role:'general',body:{prompt:'坚持'},assessment:{acceptedAnswers:['坚持']}}}},
  {kind:'response',payload:{encounterId:'recognition',response:null,selfAssessment:'accepted',outcome:'accepted'}},
  {kind:'word_wrap',payload:{wordId:'word',reason:'policy'}},
  {kind:'finish_for_now',payload:{}},
];
const actions:VocabularySessionAction[]=inputs.map((action,index)=>({...action,protocolVersion:1,sequence:index+1,actionId:`action-${index}`,clientActionId:`action-${index}`,occurredAt:time()}));
const projection=projectVocabularySession(context,actions);
let completion:VocabularySessionCompletion|null=null,failClose=params.has('fail'),futureMode:VocabularyWordMode='practice',stateVersion=1;
let modeCommands=0,cancelCalls=0,modeWrites=0,closeCalls=0;
function study():Study {
  return {session:{sessionId:context.sessionId,status:completion?.status==='closed'?'closed':completion?'finalizing':'active',context,actions,projection,completion},
    words:[{wordId:'word',hanzi:'坚持',traditional:null,pinyin:'jiān chí',meaning:'to persevere; to keep going despite difficulties and an unusually long explanation that should wrap naturally'}],
    currentWordId:'word',currentEncounter:projection.encounters.at(-1)!,notice:null,
    controls:{canNext:false,canSkip:false,canEnough:false,canMore:false,canUndo:false,canFinishForNow:false,canFinishImmediately:false,canChangeMode:false}};
}
window.fetch=async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/completion/current'))return Response.json(null);
  if(url.endsWith('/sessions'))return Response.json(study());
  if(url.endsWith('/words'))return Response.json({words:[{wordId:'word',mode:futureMode,stateVersion}]});
  if(url.endsWith('/words/word/mode')){
    const body=JSON.parse(String(init?.body)) as {mode:VocabularyWordMode;expectedVersion:number};
    if(completion?.status!=='closed'||body.expectedVersion!==stateVersion)return Response.json({error:'Invalid future-state write'},{status:409});
    futureMode=body.mode;stateVersion++;modeWrites++;return Response.json({});
  }
  if(url.endsWith('/completion/close')){
    closeCalls++;
    if(!completion)throw new Error('Missing completion');
    if(failClose){completion={...completion,status:'failed',error:'Fixture closure failure',canUndo:false};return Response.json({error:'Fixture closure failure'},{status:503});}
    completion={...completion,status:'closed',closedAt:time(),error:null,canUndo:false,serverNow:time()};return Response.json(completion);
  }
  if(url.endsWith('/completion/cancel')){cancelCalls++;return Response.json({error:'Unexpected cancellation'},{status:409});}
  if(url.endsWith('/commands')){modeCommands++;return Response.json({error:'Unexpected session command'},{status:409});}
  if(url.endsWith('/completion')){
    if(init?.method==='POST'&&!completion){const now=time();completion={completionId:'completion',sessionId:context.sessionId,revisionNumber:1,throughSequence:actions.length,status:'pending',stagedAt:now,closeAt:new Date(Date.now()+15000).toISOString(),closedAt:null,report:projection,error:null,serverNow:now,canUndo:true,metadata:{activeDurationMs:5000,source:'client_visibility_and_focus'}};}
    return Response.json(completion?{...completion,serverNow:time()}:null);
  }
  throw new Error(`Unexpected request ${url}`);
};
function Fixture(){
  const [home,setHome]=useState(false),[,redraw]=useState(0);
  const controller=useVocabularyStudy({onSessionEnded:()=>setHome(true)}),started=useRef(false);
  useEffect(()=>{if(!started.current){started.current=true;void controller.start();}},[]);
  useEffect(()=>{const timer=setInterval(()=>redraw(value=>value+1),250);return()=>clearInterval(timer);},[]);
  return <>
    {narrow&&<style>{':root{font-size:125%;}'}</style>}
    <aside style={{fontSize:'.8rem'}}>
      <output id="summary-evidence">{JSON.stringify({status:completion?.status??'starting',modeCommands,cancelCalls,modeWrites,closeCalls,futureMode})}</output>{' '}
      <button onClick={()=>{failClose=false;redraw(value=>value+1);}}>Allow close</button>
      <button onClick={()=>{failClose=true;redraw(value=>value+1);}}>Fail close</button>
    </aside>
    <div style={{width:narrow?420:'100%',maxWidth:'100%',height:'calc(100dvh - 3rem)',margin:'0 auto'}}>
      {home?<p>Home — reload to repeat</p>:<VocabularyStudy controller={controller}/>}
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
