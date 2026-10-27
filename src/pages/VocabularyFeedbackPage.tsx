import { CardInbox } from '../components/CardInbox';
import { useEffect, useRef, useState } from 'react';
import { fetchVocabularyFeedback, markVocabularyFeedbackSeen, retryVocabularyFeedback, dismissVocabularyFeedback, restoreVocabularyFeedback, type VocabularyFeedbackInbox } from '../services/api';
import { ShortcutHint } from '../components/ShortcutHint';
import '../features/vocabulary-ui/vocabulary-ui.css';
import { feedbackShortcut } from '../features/vocabulary-feedback/keyboard';
import type { VocabularyJson } from '../domain/vocabulary-content';
function FeedbackBody({value}:{value:VocabularyJson}) {
  if(value===null)return null;
  if(typeof value==='string')return <p style={{whiteSpace:'pre-wrap'}}>{value}</p>;
  if(Array.isArray(value))return <>{value.map((v,i)=><FeedbackBody key={i} value={v}/>)}</>;
  if(typeof value==='object')return <>{Object.entries(value).map(([k,v])=><div key={k}>{k==='title'&&typeof v==='string'?<h2>{v}</h2>:<FeedbackBody value={v}/>}</div>)}</>;
  return null;
}
export const vocabularyFeedbackApi = {fetch:fetchVocabularyFeedback,markSeen:markVocabularyFeedbackSeen,retry:retryVocabularyFeedback,dismiss:dismissVocabularyFeedback,restore:restoreVocabularyFeedback};
export function VocabularyFeedbackPage({onChanged,api=vocabularyFeedbackApi}:{onChanged?:()=>void;api?:typeof vocabularyFeedbackApi}) {
  const [inbox,setInbox]=useState<VocabularyFeedbackInbox|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const [view,setView]=useState<'inbox'|'dismissed'>('inbox');
  const [selectedCase,setSelectedCase]=useState<string|null>(null);
  const request=useRef(0),changed=useRef(onChanged);changed.current=onChanged;
  async function reload(){const version=++request.current;try{const next=await api.fetch();if(version!==request.current)return;setError(null);setInbox(next);changed.current?.();}catch(e){if(version===request.current)setError(e instanceof Error?e.message:'Could not load feedback.');}}
  useEffect(()=>{setInbox(null);setSelectedCase(null);void reload();return()=>{request.current++;};},[api]);
  const pending=inbox?.jobs?.some(job=>job.status==='queued'||job.status==='running')??false;
  useEffect(()=>{if(!pending)return;const timer=setInterval(()=>void reload(),3000);return()=>clearInterval(timer);},[pending,api]);
  const messages=inbox?.messages.filter(message=>view==='dismissed'?Boolean(message.dismissedAt):!message.dismissedAt).slice().reverse()??[];
  const jobs=view==='inbox'?inbox?.jobs??[]:[];
  const entries=[...messages.map(message=>({caseId:message.caseId,label:message.subjectLabel||'Practice feedback',at:message.createdAt,state:message.seenAt?'Read':'New'})),...jobs.filter(job=>!messages.some(message=>message.caseId===job.caseId)).map(job=>({caseId:job.caseId,label:job.subjectLabel,at:job.createdAt,state:job.status==='failed'?'Could not finish':job.status==='running'?'Generating…':'Queued'}))].sort((a,b)=>b.at.localeCompare(a.at)||a.caseId.localeCompare(b.caseId));
  const index=Math.max(0,entries.findIndex(entry=>entry.caseId===selectedCase));
  const current=entries[index];
  const selected=messages.find(message=>message.caseId===current?.caseId);
  const selectedJob=jobs.find(job=>job.caseId===current?.caseId);
  const scroll=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(current)setSelectedCase(current.caseId);scroll.current?.scrollTo(0,0);},[current?.caseId]);
  useEffect(()=>{
    if(!selected||selected.seenAt)return;
    let active=true;
    void api.markSeen(selected.messageId).then(()=>{if(!active)return;setInbox(current=>current?{...current,messages:current.messages.map(message=>message.messageId===selected.messageId?{...message,seenAt:new Date().toISOString()}:message)}:current);changed.current?.();}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Could not mark feedback as read.');});
    return()=>{active=false;};
  },[selected?.messageId,selected?.seenAt,api]);
  async function retry(id:string){setBusy(true);try{await api.retry(id);await reload();}catch(e){setError(e instanceof Error?e.message:'Could not retry feedback.');}finally{setBusy(false);}}
  const mutation=useRef(false);
  async function changeDismissed(dismissed:boolean){
    if(!selected||mutation.current)return;
    mutation.current=true;setBusy(true);setError(null);
    const next=entries[index+1]?.caseId??entries[index-1]?.caseId??null;
    try{
      await (dismissed?api.dismiss:api.restore)(selected.messageId);
      request.current++;
      setInbox(value=>value?{...value,messages:value.messages.map(message=>message.messageId===selected.messageId?{...message,dismissedAt:dismissed?new Date().toISOString():null}:message)}:value);
      setSelectedCase(next);changed.current?.();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not update feedback.');}
    finally{mutation.current=false;setBusy(false);}
  }
  useEffect(()=>{
    function keydown(event:KeyboardEvent){
      const target=event.target;
      const editing=target instanceof HTMLElement&&(target.isContentEditable||Boolean(target.closest('input,textarea,select,[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"]')));
      const action=feedbackShortcut(event,editing);
      if(!action||busy||!current)return;
      if(action==='previous'&&index>0){event.preventDefault();setSelectedCase(entries[index-1].caseId);}
      if(action==='next'&&index<entries.length-1){event.preventDefault();setSelectedCase(entries[index+1].caseId);}
      if(action==='dismiss'&&selected&&view==='inbox'){event.preventDefault();void changeDismissed(true);}
    }
    window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);
  });
  return <section className="vocabulary-feedback-inbox">
    <header className="vocabulary-word-actions"><h1>Feedback</h1><nav className="vocabulary-feedback-views" aria-label="Feedback view">{(['inbox','dismissed'] as const).map(value=><button type="button" className={view===value?'vocab-primary':'vocab-secondary'} key={value} disabled={busy} aria-pressed={view===value} onClick={()=>{setView(value);setSelectedCase(null);}}>{value==='inbox'?'Inbox':'Dismissed'}</button>)}</nav><button type="button" className="vocab-text-button" onClick={()=>void reload()} disabled={busy}>Refresh</button></header>
    {error&&<p role="alert">{error}</p>}
    {!inbox&&!error&&<p>Loading…</p>}
    {inbox&&<CardInbox count={entries.length} index={index} itemLabel="feedback" busy={busy} sessionButtons
      className="vocabulary-feedback-shell" onSelect={next=>setSelectedCase(entries[next].caseId)}
      emptyCopy={view==='dismissed'?'No dismissed feedback.':'No feedback yet.'}
      metadata={current&&<><h2>{current.label}</h2><time className="notes" dateTime={current.at}>{new Date(current.at).toLocaleString()}</time></>}>
        <div className="reflection-help-scroll" ref={scroll} aria-label="Current feedback">
          {selected?<section className="reflection-analysis"><h3>Feedback</h3><FeedbackBody value={selected.body}/></section>
            :selectedJob?<section><p role="status">{selectedJob.status==='failed'?selectedJob.error||'Feedback could not finish. You can retry.':selectedJob.status==='running'?'Generating feedback…':'Feedback is queued.'}</p>{selectedJob.status==='failed'&&<button type="button" className="vocab-primary" disabled={busy} onClick={()=>void retry(selectedJob.jobId)}>Retry feedback</button>}</section>:null}
        </div>
        {selected&&<footer className="reflection-help-footer"><div className="reflection-help-toolbar">{view==='inbox'?<button type="button" className="vocab-primary" disabled={busy} aria-keyshortcuts="d" onClick={()=>void changeDismissed(true)}>Dismiss<ShortcutHint shortcut="D"/></button>:<button type="button" className="vocab-secondary" disabled={busy} onClick={()=>void changeDismissed(false)}>Restore to inbox</button>}</div></footer>}
    </CardInbox>}
  </section>;
}
