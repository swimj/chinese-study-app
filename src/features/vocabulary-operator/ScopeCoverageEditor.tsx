import { useEffect,useRef,useState,type ReactNode } from 'react';
import type { VocabularySenseCoverageWorkspace,VocabularyDefaultSelectionFinding } from '../../domain/vocabulary-sense-coverage';
import type { VocabularyContentProposal } from '../../domain/vocabulary-reflection';
import type { VocabularyOperatorApi } from './api';
import { coverageImpact,scopeBlocksNavigation } from './sense-coverage';
type Selection={ids:string[];expectedVersion:number};
function notes(value:VocabularySenseCoverageWorkspace['senses'][number]['description']):string[]{return value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.notes)?value.notes.filter((note):note is string=>typeof note==='string'):[];}
function label(value:VocabularySenseCoverageWorkspace['senses'][number]['description']):string {
  return typeof value==='string'?value:value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.label==='string'?value.label:'Sense label unavailable';
}
export function ScopeCoverageEditor({api,wordId,disabled,finding,onActivity,onSaved,children,repertoire}:{repertoire?:{proposal:Pick<VocabularyContentProposal,'proposalId'|'version'>;onSaved:(proposal:VocabularyContentProposal)=>void};api:VocabularyOperatorApi;wordId:string;disabled:boolean;finding?:VocabularyDefaultSelectionFinding|null;onActivity:(active:boolean)=>void;onSaved:(scope:'word',value:VocabularySenseCoverageWorkspace)=>void;children?:ReactNode}) {
  const [current,setCurrent]=useState<VocabularySenseCoverageWorkspace|null>(null),[draft,setDraft]=useState<Selection|null>(null);
  const [saving,setSaving]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
  const serial=useRef(0),mounted=useRef(true);
  const selected=draft?.ids??current?.includedSenseIds??[],impact=current?coverageImpact(current,selected):0;
  useEffect(()=>{onActivity(scopeBlocksNavigation(saving,!!draft));},[saving,draft,onActivity]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;serial.current++;onActivity(false);};},[onActivity]);
  useEffect(()=>{void load();},[api,wordId]);
  async function load(){
    const token=++serial.current;setPending(true);setError('');
    try{const value=await api.wordSenseCoverage(wordId);if(token===serial.current&&mounted.current)setCurrent(value);}
    catch(cause){if(token===serial.current&&mounted.current)setError(cause instanceof Error?cause.message:'Could not load word defaults.');}
    finally{if(token===serial.current&&mounted.current)setPending(false);}
  }
  async function save(){
    if(!current||!draft)return;const token=++serial.current;setPending(true);setSaving(true);setError('');
    try{
      const result=repertoire?await api.saveRepertoireWordDefaults(repertoire.proposal.proposalId,repertoire.proposal.version,draft.expectedVersion,selected):null;
      const value=result?result.coverage:await api.saveDefaultUsefulSenses(wordId,draft.expectedVersion,selected);
      if(token!==serial.current||!mounted.current)return;
      setCurrent(value);setDraft(null);
      if(result&&repertoire)repertoire.onSaved(result.proposal);else onSaved('word',value);
    }
    catch(cause){if(token===serial.current&&mounted.current)setError(cause instanceof Error?cause.message:'Could not save word defaults.');}
    finally{if(token===serial.current&&mounted.current){setPending(false);setSaving(false);}}
  }
  function choose(ids:string[]){setError('');if(current)setDraft(previous=>({ids,expectedVersion:previous?.expectedVersion??current.word.version}));}
  return <details className="vocabulary-sense-coverage"><summary>Word defaults{draft?' · unsaved':''}</summary>
    <div role="group" aria-label="Shared word defaults">
      {finding&&<p role="status">{finding.reason}</p>}
      {pending&&<p role="status">{saving?'Saving word defaults…':'Loading word defaults…'}</p>}
      {error&&<p role="alert" className="vocabulary-operator-error">{error} <button disabled={pending||disabled} onClick={()=>void load()}>Reload defaults</button></p>}
      {current&&<>
        {!current.selectionEstablished&&!draft&&<p role="status">Useful senses have not been selected.</p>}
        {current.selectionEstablished&&selected.length===0&&!draft&&<p role="status">No senses selected.</p>}
        <fieldset disabled={pending||disabled}><legend>Useful senses</legend>{current.senses.filter(sense=>sense.status==='active').map(sense=><div className="vocabulary-coverage-sense" key={sense.senseId}><label className="vocabulary-operator-checkbox"><input type="checkbox" checked={selected.includes(sense.senseId)} onChange={()=>choose(selected.includes(sense.senseId)?selected.filter(id=>id!==sense.senseId):[...selected,sense.senseId])}/><span>{label(sense.description)}</span></label>{notes(sense.description).length>0&&<details><summary>Sense notes</summary><ul>{notes(sense.description).map((note,index)=><li key={index}>{note}</li>)}</ul></details>}</div>)}</fieldset>
        {draft&&impact>0&&<p role="status">{impact} mapped general production {impact===1?'exercise':'exercises'} will stop being selected. Content remains active.</p>}
        {draft&&draft.expectedVersion!==current.word.version&&<p role="alert">Word defaults changed. Discard edits before selecting from the current version.</p>}
        <div className="vocabulary-operator-actions"><button disabled={pending||disabled||!draft} onClick={()=>void save()}>{repertoire?'Save defaults and update proposal':'Save word defaults'}</button><button className="secondary-button" disabled={pending||disabled} onClick={()=>choose([])}>Select none</button>{draft&&<button className="secondary-button" disabled={pending||disabled} onClick={()=>{setDraft(null);setError('');}}>Discard edits</button>}</div>
        {children}
      </>}
    </div>
  </details>;
}
