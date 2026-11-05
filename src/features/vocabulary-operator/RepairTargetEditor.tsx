import { useEffect,useRef,useState } from 'react';
import type { VocabularyRepairTargetWorkspace } from '../../domain/vocabulary-reflection';
import type { VocabularyOperatorApi } from './api';

export function RepairTargetEditor({api,caseId,revision,disabled=false,hidden=false,disclosure=false,onState,onSaved,onActivity}:{
  api:VocabularyOperatorApi;caseId:string;revision?:number;disabled?:boolean;hidden?:boolean;disclosure?:boolean;
  onState:(value:VocabularyRepairTargetWorkspace|null)=>void;onSaved:()=>void|Promise<void>;onActivity?:(active:boolean)=>void;
}) {
  const [value,setValue]=useState<VocabularyRepairTargetWorkspace|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [open,setOpen]=useState(false);
  const serial=useRef(0),callbacks=useRef({onState,onSaved,onActivity});callbacks.current={onState,onSaved,onActivity};
  useEffect(()=>{void load();return()=>{serial.current++;callbacks.current.onActivity?.(false);};},[api,caseId,revision]);
  function install(next:VocabularyRepairTargetWorkspace){setValue(next);setSelected(next.pendingSenseId??next.currentSenseId??'');callbacks.current.onState(next);if(next.blocked)setOpen(true);}
  async function load(){const request=++serial.current;setBusy(true);setError('');
    // A failed refresh must not erase a known pending restriction for this case.
    if(value?.caseId!==caseId){setValue(null);callbacks.current.onState(null);}
    try{const next=await api.repairTarget(caseId);if(request===serial.current)install(next);}
    catch(cause){if(request===serial.current)setError(cause instanceof Error?cause.message:'Could not load target sense.');}
    finally{if(request===serial.current)setBusy(false);}
  }
  async function save(senseId:string|null){if(!value)return;const request=++serial.current;setBusy(true);setError('');callbacks.current.onActivity?.(true);
    try{const next=await api.saveRepairTarget(caseId,value.version,senseId);if(request!==serial.current)return;install(next);await callbacks.current.onSaved();}
    catch(cause){if(request===serial.current)setError(cause instanceof Error?cause.message:'Could not save target sense.');}
    finally{if(request===serial.current)setBusy(false);callbacks.current.onActivity?.(false);}
  }
  if(value&&!value.available)return null;
  const controls=<div className="vocabulary-repair-target-controls">
    {error&&<p role="alert">{error} <button disabled={busy||disabled} onClick={()=>void load()}>Reload target</button></p>}
    {value?.available&&<><div className="vocabulary-repair-target-row"><label>Target sense<select value={selected} disabled={busy||disabled||!value.editable} onChange={event=>setSelected(event.target.value)}>
      {!selected&&<option value="">Choose a sense</option>}{selected&&!value.senses.some(sense=>sense.senseId===selected)&&<option value={selected}>Retired or unavailable target</option>}{value.senses.map(sense=><option key={sense.senseId} value={sense.senseId}>{sense.label}</option>)}
    </select></label><div className="vocabulary-operator-actions"><button className="secondary-button" disabled={busy||disabled||!value.editable||!selected} onClick={()=>void save(selected)}>Use for reassessment</button>
      {value.pendingSenseId!==null&&<button className="secondary-button" disabled={busy||disabled||!value.editable} onClick={()=>void save(null)}>Reset target</button>}</div></div>
      {value.blocked&&<p role="status">Target change pending. Reassess or reset before editing or applying.</p>}
    </>}
  </div>;
  return disclosure?<details className="vocabulary-repair-target" open={open||!!error} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Target sense{value?.blocked?' · pending':''}</summary>{controls}</details>:<div hidden={hidden&&!error} role="group" aria-label="Repair target sense" className="vocabulary-repair-target">{controls}</div>;
}
