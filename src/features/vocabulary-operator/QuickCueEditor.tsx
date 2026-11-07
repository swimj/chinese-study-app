import { useEffect, useState } from 'react';
import { ApiRequestError } from '../../services/api';
import type { VocabularyCaseQueueItem } from '../../domain/vocabulary-case-queue';
import type { VocabularyProposalDraft } from '../../domain/vocabulary-reflection';
import { vocabularyPhraseClozeError } from '../../domain/vocabulary-production-coverage';
import type { VocabularyOperatorApi } from './api';
import { type EditableCue } from './proposal-review';
import { loadCueEdit, cueEditDraft, type CueEdit } from './quick-cue-edit';

type Activity = {dirty:boolean;busy:boolean};
export function QuickCueEditor({api,item,operationKey,onCancel,onSaved,onActivity}:{api:VocabularyOperatorApi;item:VocabularyCaseQueueItem;operationKey:string|null;onCancel:()=>void;onSaved:(card:VocabularyCaseQueueItem)=>void;onActivity:(activity:Activity)=>void}) {
  const [edit,setEdit]=useState<CueEdit|null>(null),[cue,setCue]=useState<EditableCue|null>(null);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false);
  useEffect(()=>{let active=true;void loadCueEdit(api,item,operationKey).then(value=>{if(active){setEdit(value);setCue(value.cue);}}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Could not load cue.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const dirty=!!edit&&JSON.stringify(cue)!==JSON.stringify(edit.cue);
  useEffect(()=>{onActivity({dirty:dirty&&!saved&&!uncertain,busy:loading||saving});},[dirty,loading,saving,saved,uncertain,onActivity]);
  const draft:VocabularyProposalDraft|null=edit&&cue?cueEditDraft(edit,cue):null;
  const content=draft?.operations.find(operation=>operation.operationKey===edit?.operationKey)?.content;
  const invalid=cue&&!cue.text.trim()?'Cue cannot be empty.':cue?.kind==='phrase_cloze'&&!cue.frame.trim()?'English frame cannot be empty.':content?vocabularyPhraseClozeError(content.body):null;
  async function save(){
    if(!edit||!draft||!dirty||invalid||saving||saved||uncertain)return;
    setSaving(true);setError('');
    let writing=false;
    try {
      const fresh=await api.caseCard(item.caseId,item.proposal?.proposalId);
      if(fresh.version!==item.version||fresh.frozen||fresh.approvalState||fresh.state!=='open'||fresh.stale)throw new Error('This case changed. Cancel and reopen the editor to review its current content.');
      writing=true;
      const proposal=edit.proposal?await api.save(edit.proposal.proposalId,edit.proposal.version,draft):await api.create(draft);
      writing=false;
      setSaved(true);
      onSaved(await api.caseCard(item.caseId,proposal.proposalId));
    }catch(cause){if(writing&&(!(cause instanceof ApiRequestError)||cause.status>=500))setUncertain(true);setError(cause instanceof Error?cause.message:'Could not save cue.');}finally{setSaving(false);}
  }
  return <form className="vocabulary-quick-cue-editor" aria-label="Edit cue" onSubmit={event=>{event.preventDefault();void save();}}>
    <h4>{operationKey?'Edit proposed cue':'Edit current cue'}</h4>
    {loading&&<p role="status">Loading current content…</p>}
    {error&&<p role="alert">{error}</p>}
    {cue&&<>{cue.kind==='phrase_cloze'&&<label>English frame<textarea autoFocus value={cue.frame} disabled={saving||saved||uncertain} onChange={event=>setCue({...cue,frame:event.target.value})}/></label>}
      <label>{cue.kind==='phrase_cloze'?'Mandarin cloze':'Cue'}<textarea autoFocus={cue.kind==='direct_text'} value={cue.text} disabled={saving||saved||uncertain} onChange={event=>setCue({...cue,text:event.target.value})}/></label></>}
    {dirty&&invalid&&<p role="alert">{invalid}</p>}
    {uncertain&&<p role="status">Save outcome is unknown. Close and reload this case before trying again.</p>}
    {saved&&<p role="status">Proposal saved. Close the editor and refresh the case before applying.</p>}
    <div className="vocabulary-operator-actions"><button type="submit" disabled={!dirty||!!invalid||loading||saving||saved||uncertain}>Save</button><button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>{saved||uncertain?'Close':'Cancel'}</button></div>
  </form>;
}
