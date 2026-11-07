import { useEffect, useRef, useState } from 'react';
import type { VocabularyCaseQueueItem } from '../../domain/vocabulary-case-queue';
import { ApiRequestError } from '../../services/api';
import type { VocabularyOperatorApi } from './api';
import { approvalOutcomeUncertain, shouldSaveReviewNote } from './case-queue-model';

/** Standalone notes never become instructions for an unrelated review action. */
export function CaseNotes({item,api,disabled,onSaved,onActivity}:{item:VocabularyCaseQueueItem;api:VocabularyOperatorApi;disabled:boolean;onSaved:(item:VocabularyCaseQueueItem)=>void;onActivity:(activity:{dirty:boolean;busy:boolean})=>void}) {
  const [open,setOpen]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLTextAreaElement>(null),toggle=useRef<HTMLButtonElement>(null);
  const request=useRef<{version:number;id:string;text:string}|null>(null);
  useEffect(()=>{onActivity({dirty:!!text.trim(),busy:busy||uncertain});},[text,busy,uncertain,onActivity]);
  const wasOpen=useRef(false);
  useEffect(()=>{if(open)input.current?.focus();else if(wasOpen.current)toggle.current?.focus();wasOpen.current=open;},[open]);
  async function save() {
    if (busy || disabled || !text.trim()) return;
    request.current ??= {version: item.version, id: crypto.randomUUID(), text: text.trim()};
    setBusy(true);
    setError('');
    try {
      const value = request.current;
      const card = await api.addCaseNote(item.caseId, value.version, value.id, value.text);
      onSaved(card);
      request.current = null;
      setUncertain(false);
      setText('');
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save note.');
      const unknown = approvalOutcomeUncertain(cause instanceof ApiRequestError ? cause.status : undefined);
      setUncertain(unknown);
      if (!unknown) {
        request.current = null;
        if (cause instanceof ApiRequestError && cause.status === 409) {
          try {
            const fresh = await api.caseCard(item.caseId, item.proposal?.proposalId);
            // Installing a resolved/pending card advances the queue and destroys the unsaved editor.
            if (fresh.state === 'open' && !fresh.frozen && fresh.approvalState !== 'pending') onSaved(fresh);
            else setError('This case can no longer accept a note. Your text is retained here to copy or cancel.');
          } catch { /* Preserve the note and original conflict. */ }
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const actions={done:'Marked done',dismiss:'Dismissed proposal',approve:'Approved proposal',reassess:'Requested reassessment',second_opinion:'Requested second opinion'};
  return <section className="vocabulary-case-notes" aria-label="Case notes">
    <header><h3>Notes</h3>{item.state==='open'&&!open&&<button ref={toggle} className="secondary-button" disabled={disabled} onClick={()=>setOpen(true)}>Add note</button>}</header>
    {(item.notes??[]).map(note=><article key={note.noteId}><p className="vocabulary-operator-meta">{new Date(note.createdAt).toLocaleString()}</p><p className="vocabulary-case-note-text">{note.text}</p></article>)}
    {!!item.activity?.length&&<details className="vocabulary-case-activity"><summary>{item.activityHasMore?'Recent action notes':'Action notes'} · {item.activity.length}</summary>
      {item.activity.map(entry=><article key={entry.activityId}><p className="vocabulary-operator-meta">{actions[entry.action]} · {new Date(entry.createdAt).toLocaleString()}</p>{entry.text&&<p className="vocabulary-case-note-text">{entry.text}</p>}{entry.secondOpinionRequestId&&<p className="vocabulary-operator-meta">Included second opinion</p>}</article>)}
    </details>}
    {open&&<form onSubmit={event=>{event.preventDefault();void save();}}>
      <label>Case note<textarea ref={input} value={text} maxLength={10000} disabled={busy||uncertain||disabled} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(shouldSaveReviewNote(event.nativeEvent)){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/></label>
      {error&&<p role="alert">{error}</p>}
      <div className="vocabulary-operator-actions"><button disabled={busy||disabled||!text.trim()}>{uncertain?'Retry save':'Save note'}</button><button type="button" className="secondary-button" disabled={busy||uncertain} onClick={()=>{setText('');setError('');setOpen(false);request.current=null;}}>Cancel</button></div>
    </form>}
  </section>;
}
