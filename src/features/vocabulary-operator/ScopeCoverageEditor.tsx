import { createPortal } from 'react-dom';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import type { VocabularySenseCoverageWorkspace,VocabularyDefaultSelectionFinding } from '../../domain/vocabulary-sense-coverage';
import type { VocabularyContentProposal } from '../../domain/vocabulary-reflection';
import type { VocabularyOperatorApi, VocabularyReassessmentModel, VocabularyReassessmentSource } from './api';
import type { VocabularyCaseQueueItem } from '../../domain/vocabulary-case-queue';
import { coverageImpact,scopeBlocksNavigation } from './sense-coverage';
import { SenseDetails } from './SenseDetails';
type Selection={ids:string[];expectedVersion:number};
function notes(value:VocabularySenseCoverageWorkspace['senses'][number]['description']):string[]{return value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.notes)?value.notes.filter((note):note is string=>typeof note==='string'):[];}
function label(value:VocabularySenseCoverageWorkspace['senses'][number]['description']):string {
  return typeof value==='string'?value:value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.label==='string'?value.label:'Sense label unavailable';
}
export function ScopeCoverageEditor({api,wordId,disabled,finding,onActivity,onSaved,children,repertoire,actionsContainer}:{expanded?:boolean;actionsContainer?:HTMLElement|null;repertoire?:{proposal:Pick<VocabularyContentProposal,'proposalId'|'version'>;onSaved:(proposal:VocabularyContentProposal)=>void;reassessment?:{caseVersion:number;source:VocabularyReassessmentSource;onQueued:(item:VocabularyCaseQueueItem)=>void}};api:VocabularyOperatorApi;wordId:string;disabled:boolean;finding?:VocabularyDefaultSelectionFinding|null;onActivity:(active:boolean)=>void;onSaved:(scope:'word',value:VocabularySenseCoverageWorkspace)=>void;children?:ReactNode}) {
  const [current,setCurrent]=useState<VocabularySenseCoverageWorkspace|null>(null),[draft,setDraft]=useState<Selection|null>(null);
  const [saving,setSaving]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [reassessOpen,setReassessOpen]=useState(false),[model,setModel]=useState<VocabularyReassessmentModel>('openai:gpt-6-sol-high');
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
      setCurrent(value);setDraft(null);setReassessOpen(false);
      if(result&&repertoire)repertoire.onSaved(result.proposal);else onSaved('word',value);
    }
    catch(cause){if(token===serial.current&&mounted.current)setError(cause instanceof Error?cause.message:'Could not save word defaults.');}
    finally{if(token===serial.current&&mounted.current){setPending(false);setSaving(false);}}
  }
  async function saveAndReassess(){
    if(!current||!draft||!repertoire?.reassessment)return;
    const token=++serial.current;setPending(true);setSaving(true);setError('');
    try {
      const result=await api.saveRepertoireWordDefaultsAndReassess(repertoire.proposal.proposalId,{
        expectedVersion:repertoire.proposal.version,expectedWordVersion:draft.expectedVersion,
        expectedCaseVersion:repertoire.reassessment.caseVersion,expectedContentVersion:repertoire.reassessment.source.currentVersion,
        includedSenseIds:selected,modelChoice:model,
      });
      if(token!==serial.current||!mounted.current)return;
      setCurrent(result.coverage);setDraft(null);setReassessOpen(false);repertoire.reassessment.onQueued(result.item);
    } catch(cause){if(token===serial.current&&mounted.current)setError(cause instanceof Error?cause.message:'Could not save selection and queue reassessment.');}
    finally{if(token===serial.current&&mounted.current){setPending(false);setSaving(false);}}
  }
  function choose(ids:string[]){
    setError('');setReassessOpen(false);
    if(current)setDraft(previous=>current.selectionEstablished&&ids.length===current.includedSenseIds.length&&ids.every(id=>current.includedSenseIds.includes(id))?null:{ids,expectedVersion:previous?.expectedVersion??current.word.version});
  }
  const actions=current&&draft&&<div className="vocabulary-operator-actions">
    <button disabled={pending||disabled} onClick={()=>void save()}>Save selection</button>
    {repertoire?.reassessment&&<button className="secondary-button" disabled={pending||disabled||!selected.length} aria-expanded={reassessOpen} onClick={()=>setReassessOpen(value=>!value)}>Save selection and reassess…</button>}
    <button className="secondary-button" disabled={pending||disabled} onClick={()=>{setDraft(null);setError('');setReassessOpen(false);}}>Discard edits</button>
  </div>;
  return <section className="vocabulary-sense-coverage" aria-label="Selected senses">
    <div className="vocabulary-selection-heading"><strong>Selected senses{draft?' · unsaved':''}</strong></div>
    {finding&&<p role="status">{finding.reason}</p>}
    {pending&&<p role="status">{saving?'Saving selection…':'Loading senses…'}</p>}
    {error&&<p role="alert" className="vocabulary-operator-error">{error} <button disabled={pending||disabled} onClick={()=>void load()}>Reload selection</button></p>}
    {current&&<>
      {!current.selectionEstablished&&!draft&&<p role="status">Useful senses have not been selected.</p>}
      {current.selectionEstablished&&selected.length===0&&!draft&&<p role="status">No senses selected.</p>}
      <div className="vocabulary-sense-chips" role="group" aria-label="Useful senses">{current.senses.filter(sense=>sense.status==='active').map(sense=><SenseDetails key={sense.senseId} label={label(sense.description)} notes={notes(sense.description)}><button type="button" className="vocabulary-sense-chip" aria-pressed={selected.includes(sense.senseId)} disabled={pending||disabled} onClick={()=>choose(selected.includes(sense.senseId)?selected.filter(id=>id!==sense.senseId):[...selected,sense.senseId])}>{label(sense.description)}</button></SenseDetails>)}</div>
      {!repertoire && (!current.selectionEstablished || current.includedSenseIds.length > 0 || selected.length > 0) &&
        <button type="button" className="secondary-button" disabled={pending || disabled}
          aria-pressed={!!draft && selected.length === 0} onClick={() => choose([])}>No useful senses</button>}
      {draft && selected.length === 0 && !repertoire &&
        <p role="status">Individual-word production will stop for all learners in Practice and Maintain.</p>}
      {draft&&impact>0&&(selected.length>0||repertoire)&&<p role="status">{impact} mapped general production {impact===1?'exercise':'exercises'} will stop being selected. Content remains active.</p>}
      {draft&&draft.expectedVersion!==current.word.version&&<p role="alert">Word defaults changed. Discard edits before selecting from the current version.</p>}
      {actionsContainer?createPortal(actions,actionsContainer):actions}
      {draft&&reassessOpen&&repertoire?.reassessment&&<div className="vocabulary-selection-reassessment" role="group" aria-label="Save selection and reassess">
        <p>Saves shared defaults now and generates a new proposal for exactly these senses. The existing proposal stays until reassessment succeeds.</p>
        <label>Model for reassessment<select value={model} disabled={pending||disabled} onChange={event=>setModel(event.target.value as VocabularyReassessmentModel)}><option value="openai:gpt-6-sol-high">GPT-6 Sol high</option><option value="openai:gpt-6-luna-high">Luna high</option><option value="zai:glm-5.3-flash-high">GLM-5.3 Flash high</option></select></label>
        <button disabled={pending||disabled||!selected.length} onClick={()=>void saveAndReassess()}>Save selection and reassess</button>
      </div>}
      {children}
    </>}
  </section>;
}
