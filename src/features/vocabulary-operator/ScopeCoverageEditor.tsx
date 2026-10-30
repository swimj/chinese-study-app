import { useEffect,useRef,useState } from 'react';
import type { VocabularySenseCoverageWorkspace,VocabularyDefaultSelectionFinding } from '../../domain/vocabulary-sense-coverage';
import type { VocabularyOperatorApi } from './api';
import { coverageImpact,scopeBlocksNavigation } from './sense-coverage';
type Scope='case'|'word';
type Selection={ids:string[];expectedVersion:number};
function notes(value:VocabularySenseCoverageWorkspace['senses'][number]['description']):string[]{return value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.notes)?value.notes.filter((note):note is string=>typeof note==='string'):[];}
function label(value:VocabularySenseCoverageWorkspace['senses'][number]['description']):string {
  return typeof value==='string'?value:value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.label==='string'?value.label:'Sense label unavailable';
}
export function ScopeCoverageEditor({api,caseId,wordId,disabled,finding,onActivity,onSaved}:{api:VocabularyOperatorApi;caseId?:string;wordId:string;disabled:boolean;finding?:VocabularyDefaultSelectionFinding|null;onActivity:(active:boolean)=>void;onSaved:(scope:Scope,value:VocabularySenseCoverageWorkspace)=>void}) {
  const [open,setOpen]=useState(!caseId),[scope,setScope]=useState<Scope>(caseId?'case':'word');
  const [review,setReview]=useState<VocabularySenseCoverageWorkspace|null>(null),[word,setWord]=useState<VocabularySenseCoverageWorkspace|null>(null);
  const [drafts,setDrafts]=useState<Partial<Record<Scope,Selection>>>({});
  const [saving,setSaving]=useState(false);
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[reviewRefreshFailed,setReviewRefreshFailed]=useState(false);
  const serial=useRef(0),mounted=useRef(true);
  const current=scope==='case'?review:word,draft=drafts[scope],selected=draft?.ids??current?.includedSenseIds??[];
  const impact=current?coverageImpact(current,selected):0;
  useEffect(()=>{onActivity(scopeBlocksNavigation(saving,Object.keys(drafts).length>0));},[saving,drafts,onActivity]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;serial.current++;onActivity(false);};},[onActivity]);
  useEffect(()=>{if(!caseId)void load('word');},[api,caseId,wordId]);
  async function load(next:Scope){
    if(next==='case'&&!caseId)throw new Error('Review coverage requires a case');
    const token=++serial.current;setPending(true);setError('');setReviewRefreshFailed(false);
    try{const value=await(next==='case'?api.caseSenseCoverage(caseId!):api.wordSenseCoverage(wordId));if(token!==serial.current||!mounted.current)return;next==='case'?setReview(value):setWord(value);}
    catch(cause){if(token===serial.current&&mounted.current)setError(cause instanceof Error?cause.message:'Could not load sense coverage.');}
    finally{if(token===serial.current&&mounted.current)setPending(false);}
  }
  async function save(inherit=false){
    if(!current)return;if(scope==='case'&&!caseId)throw new Error('Review coverage requires a case');const target=scope,token=++serial.current;setPending(true);setSaving(true);setError('');setReviewRefreshFailed(false);
    try{
      const value=target==='word'?await api.saveDefaultUsefulSenses(wordId,draft?.expectedVersion??current.word.version,selected):await api.saveCaseSenseCoverage(caseId!,inherit?current.review!.version:draft?.expectedVersion??current.review!.version,inherit?null:selected);
      if(token!==serial.current||!mounted.current)return;
      target==='case'?setReview(value):setWord(value);setDrafts(previous=>{const next={...previous};delete next[target];return next;});onSaved(target,value);setSaving(false);
      if(target==='word'&&caseId)try{const refreshed=await api.caseSenseCoverage(caseId!);if(token===serial.current&&mounted.current)setReview(refreshed);}
      catch{if(token===serial.current&&mounted.current){setReviewRefreshFailed(true);setError('Word defaults were saved, but review coverage could not refresh. Reload review coverage.');}}
    }catch(cause){if(token===serial.current&&mounted.current)setError(cause instanceof Error?cause.message:'Could not save sense coverage.');}
    finally{if(token===serial.current&&mounted.current){setPending(false);setSaving(false);}}
  }
  function choose(ids:string[]){if(!current)return;setDrafts(previous=>({...previous,[scope]:{ids,expectedVersion:previous[scope]?.expectedVersion??(scope==='word'?current.word.version:current.review!.version)}}));}
  return <>{finding&&<section aria-label="Useful sense selection needs review"><p role="status">{finding.reason}</p><button className="secondary-button" disabled={pending||disabled} onClick={()=>{setOpen(true);setScope('word');void load('word');}}>Review word defaults</button><details><summary>Selection evidence</summary><pre>{JSON.stringify(finding,null,2)}</pre></details></section>}<details className="vocabulary-sense-coverage" open={open} onToggle={event=>{const next=event.currentTarget.open;setOpen(next);if(next&&scope==='case'&&!review&&!pending)void load('case');}}>
    <summary>Sense coverage{Object.keys(drafts).length>0?' · unsaved':''}</summary>
    <div role="group" aria-label={scope==='case'?'Review sense coverage':'Shared word defaults'}>
      <h3>{scope==='case'?'This review':'Word defaults · shared'}</h3>
      {scope==='case'?<p className="vocabulary-operator-meta">{review?.review?.includedSenseIds!==null&&review?.review?.includedSenseIds!==undefined?'Review override':'Using word defaults'}</p>:<p className="vocabulary-operator-meta">Changing word defaults changes mapped practice selection.</p>}
      {pending&&<p role="status">{saving?'Saving sense coverage…':'Loading sense coverage…'}</p>}
      {error&&<p role="alert" className="vocabulary-operator-error">{error} <button disabled={pending||disabled} onClick={()=>{if(reviewRefreshFailed)setScope('case');void load(reviewRefreshFailed?'case':scope);}}>{reviewRefreshFailed?'Reload review coverage':'Reload coverage'}</button></p>}
      {current&&<>
        {!current.selectionEstablished&&!draft&&<p role="status">Useful senses have not been selected.</p>}
        {current.selectionEstablished&&selected.length===0&&!draft&&<p role="status">No senses selected.</p>}
        <fieldset disabled={pending||disabled}><legend>Useful senses</legend>{current.senses.filter(sense=>sense.status==='active').map(sense=><div className="vocabulary-coverage-sense" key={sense.senseId}><label className="vocabulary-operator-checkbox"><input type="checkbox" checked={selected.includes(sense.senseId)} onChange={()=>choose(selected.includes(sense.senseId)?selected.filter(id=>id!==sense.senseId):[...selected,sense.senseId])}/><span>{label(sense.description)}</span></label>{notes(sense.description).length>0&&<details><summary>Sense notes</summary><ul>{notes(sense.description).map((note,index)=><li key={index}>{note}</li>)}</ul></details>}</div>)}</fieldset>
        {scope==='word'&&draft&&impact>0&&<p role="status">{impact} mapped general production {impact===1?'exercise':'exercises'} will stop being selected. Content remains active.</p>}
        {draft&&draft.expectedVersion!==(scope==='word'?current.word.version:current.review!.version)&&<p role="alert">Coverage changed since these edits. Discard coverage edits before selecting from the current version.</p>}
        {draft&&<p role="status">Unsaved {scope==='case'?'review coverage':'word defaults'}</p>}
        <div className="vocabulary-operator-actions">
          <button disabled={pending||disabled||!draft} onClick={()=>void save()}>{scope==='case'?'Save review coverage':'Save word defaults'}</button>
          <button className="secondary-button" disabled={pending||disabled} onClick={()=>choose([])}>Select none</button>
          {scope==='case'&&<button className="secondary-button" disabled={pending||disabled||(review?.review?.includedSenseIds===null&&!draft)} onClick={()=>void save(true)}>Use word defaults</button>}
          {draft&&<button className="secondary-button" disabled={pending||disabled} onClick={()=>setDrafts(previous=>{const next={...previous};delete next[scope];return next;})}>Discard coverage edits</button>}
        </div>
      </>}
      {caseId&&<button className="secondary-button" disabled={pending||disabled} onClick={()=>{const next=scope==='case'?'word':'case';setScope(next);void load(next);}}>{scope==='case'?'Edit word defaults':'Back to review coverage'}</button>}
    </div>
  </details></>;
}
