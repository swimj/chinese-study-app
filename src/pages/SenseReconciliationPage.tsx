import { useEffect, useRef, useState } from 'react';
import type { SenseContentReconciliationDraft, SenseContentReconciliationWorkspace, SenseContentReconciliationWord } from '../domain/sense-content-reconciliation';
import { fetchSenseReconciliationWords, fetchSenseReconciliation, saveSenseReconciliation, applySenseReconciliation, retrySenseReconciliation } from '../services/api';
import './SenseReconciliationPage.css';

const defaultApi = {list:fetchSenseReconciliationWords,get:fetchSenseReconciliation,save:saveSenseReconciliation,apply:applySenseReconciliation,retry:retrySenseReconciliation};
export type SenseReconciliationApi = typeof defaultApi;
function initialDraft(workspace: SenseContentReconciliationWorkspace): SenseContentReconciliationDraft {
  return workspace.resolution?.draft ?? {
    defaultSenseIds:workspace.senses.filter(sense=>sense.defaultUseful).map(sense=>sense.senseId),
    uses:(workspace.teaching?.uses??[]).map(use=>({useId:use.id,decision:'unsupported',senseId:null,rationale:''})),
    rationale:'',unsupportedChanges:[],
  };
}

export function SenseReconciliationPage({api=defaultApi}: {api?:SenseReconciliationApi}) {
  const [words,setWords]=useState<SenseContentReconciliationWord[]>([]);
  const [workspace,setWorkspace]=useState<SenseContentReconciliationWorkspace|null>(null);
  const [draft,setDraft]=useState<SenseContentReconciliationDraft|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [savedDraft,setSavedDraft]=useState('');
  const request=useRef(0);
  const dirty=draft!==null&&JSON.stringify(draft)!==savedDraft;
  const applied=workspace?.resolution?.status==='applied';
  function install(value:SenseContentReconciliationWorkspace) {
    const next=initialDraft(value);setWorkspace(value);setDraft(next);setSavedDraft(JSON.stringify(next));
  }
  async function open(wordId:string) {
    if(dirty&&!window.confirm('Discard unsaved resolution changes?'))return;
    const token=++request.current;setBusy(true);setError('');setNotice('');
    try{const value=await api.get(wordId);if(token===request.current)install(value);}
    catch(e){if(token===request.current)setError(e instanceof Error?e.message:'Could not load reconciliation.');}
    finally{if(token===request.current)setBusy(false);}
  }
  useEffect(()=>{let active=true;void api.list().then(async items=>{
    if(!active)return;setWords(items);
    if(items.length){const value=await api.get(items[0].wordId);if(active)install(value);}
  }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load reconciliation.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;request.current++;};},[api]);
  useEffect(()=>{
    if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    const guard=(event:MouseEvent)=>{
      const link=event.target instanceof Element?event.target.closest('a[href]'):null;
      if(link&&link.getAttribute('href')!==window.location.pathname&&!window.confirm('Discard unsaved resolution changes?')){event.preventDefault();event.stopPropagation();}
    };
    window.addEventListener('beforeunload',warn);document.addEventListener('click',guard,true);
    return()=>{window.removeEventListener('beforeunload',warn);document.removeEventListener('click',guard,true);};
  },[dirty]);
  async function act(work:()=>Promise<SenseContentReconciliationWorkspace>,success:string) {
    setBusy(true);setError('');setNotice('');
    try{install(await work());setNotice(success);}
    catch(e){setError(e instanceof Error?e.message:'Reconciliation failed.');}
    finally{setBusy(false);}
  }
  function save(status:'draft'|'resolved',refreshSource=false) {
    if(!workspace||!draft)return;
    void act(()=>api.save(workspace.wordId,{expectedVersion:workspace.resolution?.version??null,status,draft,refreshSource}),
      status==='resolved'?'Resolution saved. Review application consequences below.':'Draft saved.');
  }
  function updateUse(index:number,patch:Partial<SenseContentReconciliationDraft['uses'][number]>) {
    setDraft(value=>value?{...value,uses:value.uses.map((use,i)=>i===index?{...use,...patch}:use)}:value);
  }
  const focusUse=useRef<string|null>(null);
  const [movingUse,setMovingUse]=useState<string|null>(null);
  const draggedUse=useRef<string|null>(null);
  function moveUse(useId:string,target:string) {
    if(busy||applied||!draft)return;
    const index=draft.uses.findIndex(use=>use.useId===useId);
    if(index<0)return;
    focusUse.current=useId;
    updateUse(index,target==='unassigned'?{decision:'unsupported',senseId:null}:target==='excluded'?{decision:'reject',senseId:null}:{decision:'map',senseId:target});
    setMovingUse(null);draggedUse.current=null;
  }
  function dropTarget(target:string) {
    return {onDragOver:(event:React.DragEvent)=>{if(draggedUse.current&&!busy&&!applied)event.preventDefault();},
      onDrop:(event:React.DragEvent)=>{event.preventDefault();if(draggedUse.current)moveUse(draggedUse.current,target);}};
  }
  useEffect(()=>{
    if(focusUse.current){document.getElementById(`reconciliation-use-${focusUse.current}`)?.focus();focusUse.current=null;}
  },[draft]);
  function renderUses(uses:NonNullable<SenseContentReconciliationWorkspace['teaching']>['uses']) {
    if(!workspace||!draft)return null;
    return <>{uses.map(use=>{
                const index=draft.uses.findIndex(row=>row.useId===use.id),decision=draft.uses[index];
                if(!decision)return <p key={use.id} role="alert">Teaching changed. Reload before reviewing.</p>;
                return <div className="reconciliation-use" key={use.id}>
                  <div className="reconciliation-use-title"><button type="button" id={`reconciliation-use-${use.id}`} className="reconciliation-drag" aria-label={`Move ${use.label}`} aria-pressed={movingUse===use.id}
                    draggable={!busy&&!applied} onDragStart={event=>{draggedUse.current=use.id;event.dataTransfer.setData('text/plain',use.id);event.dataTransfer.effectAllowed='move';setMovingUse(use.id);}}
                    onDragEnd={()=>{draggedUse.current=null;setMovingUse(null);}} onClick={()=>setMovingUse(movingUse===use.id?null:use.id)}>⠿</button><h4>{use.label}</h4></div>
                  <details><summary>Details</summary>
                    {use.notes.length>0&&<ul>{use.notes.map((note,i)=><li key={i}>{note}</li>)}</ul>}
                    {use.examples.map((example,i)=><blockquote key={i}><p lang="zh">{example.text}</p><p>{example.translation}</p></blockquote>)}
                    <label>Move to<select value={decision.decision==='map'?`map:${decision.senseId??''}`:decision.decision} onChange={e=>{
                      const value=e.target.value;moveUse(use.id,value.startsWith('map:')?value.slice(4):value==='reject'?'excluded':'unassigned');
                    }}><option value="unsupported">Unassigned</option>{workspace.senses.map(sense=><option key={sense.senseId} value={`map:${sense.senseId}`}>{sense.label}</option>)}<option value="reject">Excluded</option></select></label>
                    <label>Note (optional)<textarea rows={2} value={decision.rationale} onChange={e=>updateUse(index,{rationale:e.target.value})}/></label>
                  </details>
                </div>;
              })}</>;
  }
  const plan=workspace?.plan;
  return <div className="sense-reconciliation-page">
    <header><div><p className="reconciliation-eyebrow">Operator · shared content</p><h1>Sense reconciliation</h1></div>
      {workspace&&<button className="secondary-button" disabled={busy} onClick={()=>void open(workspace.wordId)}>Reload</button>}</header>
    {error&&<p role="alert" className="reconciliation-error">{error}</p>}
    {notice&&<p role="status" className="reconciliation-notice">{notice}</p>}
    {loading?<p role="status">Loading reconciliations…</p>:words.length===0?<p>No teaching conflicts or saved resolutions.</p>:<>
      <label className="reconciliation-word-picker">Word<select value={workspace?.wordId??''} disabled={busy} onChange={e=>void open(e.target.value)}>
        {!workspace&&<option value="">Select a word</option>}{words.map(word=><option key={word.wordId} value={word.wordId}>{word.hanzi} · {word.reason}</option>)}
      </select></label>
      {workspace&&draft&&<>
        <section className="reconciliation-summary"><h2>{workspace.hanzi} <span>{workspace.pinyin}</span></h2>
          <div className="reconciliation-statuses" aria-label="Reconciliation status">
            <span>Decision <strong>{dirty?'Unsaved changes':workspace.resolution?.status??'Not started'}</strong></span>
            <span>Application <strong>{applied?'Applied':plan?.blockers.length?'Blocked':workspace.resolution?.status==='resolved'?'Ready':'Not ready'}</strong></span>
            <span>Replacement <strong>{workspace.progress.status==='not_required'?'Not started':workspace.progress.status.replaceAll('_',' ')}</strong></span>
          </div>
        </section>
        <fieldset disabled={busy||applied} className="reconciliation-editor">
          <div className="reconciliation-group-headings"><h3>Canonical senses</h3><h3>Matched teaching uses</h3></div>
          {workspace.senses.map(sense=>{
            const uses=(workspace.teaching?.uses??[]).filter(use=>draft.uses.some(row=>row.useId===use.id&&row.decision==='map'&&row.senseId===sense.senseId));
            return <section className="reconciliation-comparison" key={sense.senseId} aria-label={sense.label} {...dropTarget(sense.senseId)}>
              <div className="reconciliation-sense">
                <label><input type="checkbox" checked={draft.defaultSenseIds.includes(sense.senseId)} onChange={e=>setDraft({...draft,defaultSenseIds:e.target.checked?[...draft.defaultSenseIds,sense.senseId]:draft.defaultSenseIds.filter(id=>id!==sense.senseId)})}/><strong>{sense.label}</strong></label>

                {sense.notes.length>0&&<details><summary>Details</summary><ul>{sense.notes.map((note,i)=><li key={i}>{note}</li>)}</ul></details>}
              </div>
              <div>{renderUses(uses)}{movingUse?<button type="button" className="reconciliation-drop" onClick={()=>moveUse(movingUse,sense.senseId)}>Match here</button>:!uses.length&&<p className="reconciliation-drop">Drop teaching uses here</p>}</div>
            </section>;
          })}
          {draft.defaultSenseIds.filter(id=>!workspace.senses.some(sense=>sense.senseId===id)).map(id=><div className="reconciliation-sense" key={id}><label><input type="checkbox" checked onChange={()=>setDraft({...draft,defaultSenseIds:draft.defaultSenseIds.filter(selected=>selected!==id)})}/><strong>Unavailable sense: {id}</strong></label></div>)}
          {(['unassigned','excluded'] as const).map(group=>{
            const uses=(workspace.teaching?.uses??[]).filter(use=>{
              const row=draft.uses.find(row=>row.useId===use.id);
              return group==='excluded'?row?.decision==='reject':row?.decision!=='reject'&&!(row?.decision==='map'&&workspace.senses.some(sense=>sense.senseId===row.senseId));
            });
            return <section className="reconciliation-comparison" key={group} aria-label={group==='unassigned'?'Unassigned teaching uses':'Excluded teaching uses'} {...dropTarget(group)}>
              <h3>{group==='unassigned'?'Unassigned teaching uses':'Excluded teaching uses'}</h3><div>{renderUses(uses)}{movingUse?<button type="button" className="reconciliation-drop" onClick={()=>moveUse(movingUse,group)}>Move here</button>:!uses.length&&<p className="reconciliation-drop">Drop teaching uses here</p>}</div>
            </section>;
          })}
          {!workspace.teaching&&<p>No current teaching source.</p>}
          <section className="reconciliation-decision"><details><summary>Notes and inventory changes</summary>
            <label>Note (optional)<textarea rows={3} value={draft.rationale} onChange={e=>setDraft({...draft,rationale:e.target.value})}/></label>
            <label>Additional inventory changes<textarea rows={2} placeholder="Add, revise, merge, or split senses; one requested change per line" value={draft.unsupportedChanges.join('\n')} onChange={e=>setDraft({...draft,unsupportedChanges:e.target.value.split('\n')})}/></label>
            </details>
            <div className="reconciliation-actions"><button className="secondary-button" onClick={()=>save('draft')}>Save draft</button><button onClick={()=>save('resolved')}>Save resolution</button></div>
          </section>
        </fieldset>
        {workspace.resolution&&<section className="reconciliation-plan" aria-labelledby="application-heading"><h3 id="application-heading">Application plan</h3>
          {dirty&&<p>Save your changes to update this plan.</p>}
          {plan&&<>
            {plan.blockers.length>0&&<div className="reconciliation-blockers"><h4>Application blocked</h4><ul>{plan.blockers.map((blocker,index)=><li key={`${blocker.code}:${index}`}>{blocker.message}{blocker.objectIds.length>0&&<span> ({blocker.objectIds.map(id=>workspace.teaching?.uses.find(use=>use.id===id)?.label??workspace.senses.find(sense=>sense.senseId===id)?.label??(id===workspace.wordId?workspace.hanzi:id)).join(', ')})</span>}</li>)}</ul></div>}
            <ul className="reconciliation-effects">
              <li>{applied?'Retired':'Will retire'} {plan.retireContentIds.length} content items from future serving; {applied?'retained':'will retain'} {plan.retainedContentIds.length}.</li>
              <li>Teaching: {plan.replacementTeachingRequired?'compatible replacement required':'no replacement required'}.</li>
              <li>Repertoire: {plan.replacementPracticeRequired?'compatible replacement required':'no replacement required'}.</li>
            </ul>
            <details><summary>Affected content</summary><dl><dt>Retire</dt><dd>{plan.retireContentIds.map(id=><div key={id}><p>{workspace.affectedContent.find(content=>content.contentId===id)?.summary}</p><code>{id}</code></div>)}</dd><dt>Retain</dt><dd>{plan.retainedContentIds.map(id=><div key={id}><p>{workspace.affectedContent.find(content=>content.contentId===id)?.summary}</p><code>{id}</code></div>)}</dd></dl></details>
          </>}
          {!applied&&<><p className="reconciliation-consequence">Applying changes future content eligibility. Affected study waits for required replacements. Existing sessions and learner progress are preserved.</p>
            <div className="reconciliation-actions"><button disabled={busy||dirty||workspace.resolution.status!=='resolved'||!plan||plan.blockers.length>0} onClick={()=>{
              if(!plan||!workspace.resolution)return;
              void act(()=>api.apply(workspace.wordId,{expectedVersion:workspace.resolution!.version,planFingerprint:plan.fingerprint}),'Resolution applied. Replacement readiness is shown below.');
            }}>Apply resolution</button>
            {plan?.blockers.some(blocker=>['source_changed','stale_source'].includes(blocker.code))&&<button className="secondary-button" disabled={busy||dirty} onClick={()=>{
              if(window.confirm('Revalidate this decision against the current source? Review the refreshed comparison and plan before applying.'))save('draft',true);
            }}>Revalidate against current source</button>}</div></>}
        </section>}
        {workspace.progress.status!=='not_required'&&<section className="reconciliation-progress"><h3>Replacement content</h3><p>Teaching: <strong>{workspace.progress.teachingStatus}</strong> · Repertoire: <strong>{workspace.progress.practiceStatus}</strong></p>
          {workspace.progress.errors.map((message,index)=><p role="alert" key={index}>{message}</p>)}
          <div className="reconciliation-actions"><button className="secondary-button" disabled={busy} onClick={()=>void open(workspace.wordId)}>Refresh status</button>
            {applied&&<button className="secondary-button" disabled={busy} onClick={()=>save('draft',true)}>Start another resolution</button>}
            {workspace.progress.status==='failed'&&<button disabled={busy||dirty} onClick={()=>void act(()=>api.retry(workspace.wordId),'Replacement retry requested.')}>Retry preparation</button>}</div>
        </section>}
      </>}
    </>}
  </div>;
}
