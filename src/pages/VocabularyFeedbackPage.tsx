import { useEffect, useState } from 'react';
import { fetchVocabularyFeedback, markVocabularyFeedbackSeen, retryVocabularyFeedback, type VocabularyFeedbackInbox } from '../services/api';
import type { VocabularyJson } from '../domain/vocabulary-content';
function FeedbackBody({value}:{value:VocabularyJson}) {
  if(value===null)return null;
  if(typeof value==='string')return <p style={{whiteSpace:'pre-wrap'}}>{value}</p>;
  if(Array.isArray(value))return <>{value.map((v,i)=><FeedbackBody key={i} value={v}/>)}</>;
  if(typeof value==='object')return <>{Object.entries(value).map(([k,v])=><div key={k}>{k==='title'&&typeof v==='string'?<h2>{v}</h2>:<FeedbackBody value={v}/>}</div>)}</>;
  return null;
}
export function VocabularyFeedbackPage({onChanged}:{onChanged?:()=>void}) {
  const [inbox,setInbox]=useState<VocabularyFeedbackInbox|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  async function reload(){setError(null);try{const next=await fetchVocabularyFeedback();setInbox(next);await Promise.all(next.messages.filter(m=>!m.seenAt).map(m=>markVocabularyFeedbackSeen(m.messageId)));onChanged?.();}catch(e){setError(e instanceof Error?e.message:'Could not load feedback.');}}
  useEffect(()=>{void reload();},[]);
  async function retry(id:string){setBusy(true);try{await retryVocabularyFeedback(id);await reload();}catch(e){setError(e instanceof Error?e.message:'Could not retry feedback.');}finally{setBusy(false);}}
  return <section className="panel"><div className="vocabulary-word-actions"><h1>Feedback</h1><button type="button" onClick={()=>void reload()} disabled={busy}>Refresh</button></div>
    <p>Lessons from your recent practice. You don’t need to review proposals or approve corrections.</p>
    {error?<p role="alert">{error}</p>:null}
    {!inbox&&!error?<p>Loading…</p>:null}
    {inbox?.failures.map(f=><div key={f.jobId}><p>{f.error}</p><button type="button" disabled={busy} onClick={()=>void retry(f.jobId)}>Retry feedback</button></div>)}
    {inbox?.messages.length===0?<p>Feedback will appear here after a session when there’s something useful to share.</p>:null}
    {inbox?.messages.slice().reverse().map(m=><article className="vocabulary-feedback-message" key={m.messageId}><FeedbackBody value={m.body}/><small>{new Date(m.createdAt).toLocaleString()}</small></article>)}
  </section>;
}
