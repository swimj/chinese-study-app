import { useEffect,useRef,useState } from 'react';
import type { VocabularyContent,VocabularyContentDraft,VocabularyJson } from '../domain/vocabulary-content';
import type { VocabularyContentProposal,VocabularyProposalDraft,VocabularyProposalOperation,VocabularyReflectionCase } from '../domain/vocabulary-reflection';
import { effectiveVocabularyFeedback } from '../domain/vocabulary-session';
import { vocabularyOperatorApi,type VocabularyOperatorApi,type VocabularyCaseWorkspace,type VocabularyFailedDispatch,type VocabularyFailedPreparation,type VocabularyProposalPreview } from '../features/vocabulary-operator/api';
import './VocabularyOperatorPage.css';

const kinds={exercise_improvement:'Exercise issues',teaching_review:'Teaching inbox',learner_feedback:'Feedback cases'} as const;
const labels={create:'Add another item',update_existing:'Update existing item',replace:'Replace with new item'} as const;
const pretty=(value:unknown)=>JSON.stringify(value,null,2);
const message=(error:unknown)=>error instanceof Error?error.message:'The request could not finish. Refresh and try again.';
function draftOf(value:VocabularyContentProposal):VocabularyProposalDraft{return {caseId:value.caseId??undefined,operations:value.operations,rationale:value.rationale,bases:value.bases};}
function authored(value:VocabularyContent):VocabularyContentDraft {
  const {version:_version,createdAt:_created,updatedAt:_updated,...draft}=value;return draft;
}
function Readable({value}:{value:VocabularyJson}) {
  if(value===null)return null;
  if(typeof value!=='object')return <span>{String(value)}</span>;
  if(Array.isArray(value))return <ul>{value.map((entry,index)=><li key={index}><Readable value={entry}/></li>)}</ul>;
  return <dl>{Object.entries(value).filter(([key])=>!['source','id','exampleId','wordId','contentId'].includes(key)).map(([key,entry])=><div key={key}><dt>{key.replace(/([A-Z])/g,' $1')}</dt><dd><Readable value={entry}/></dd></div>)}</dl>;
}
function AuthoredContent({content}:{content:VocabularyContentDraft}) {
  const body=content.body!==null&&typeof content.body==='object'&&!Array.isArray(content.body)?content.body:{};
  return <div className="vocabulary-authored">{typeof body.prompt==='string'?<p className="vocabulary-operator-cue">{body.prompt}</p>:<Readable value={content.body}/>}
    {content.kind==='exercise'&&<div className="vocabulary-operator-answers"><strong>Expected answers</strong><p>{content.answers.map(answer=>answer.acceptedForms.join(' / ')).join(' · ')}</p>
      <details><summary>Answer criteria and retained teaching</summary><Readable value={content.assessment}/>{body.reveal!==undefined&&<Readable value={body.reveal}/>}</details></div>}
  </div>;
}
function editableDraft(value:unknown):value is VocabularyProposalDraft {
  if(!value||typeof value!=='object')return false;const item=value as Record<string,unknown>;
  return typeof item.rationale==='string'&&Array.isArray(item.operations)&&item.operations.every(value=>{
    if(!value||typeof value!=='object')return false;const operation=value as Record<string,unknown>;
    if(typeof operation.operationKey!=='string'||typeof operation.rationale!=='string'||!['create','update_existing','replace'].includes(String(operation.strategy)))return false;
    const scope=operation.scope as Record<string,unknown>|undefined,content=operation.content as Record<string,unknown>|undefined;
    if(!scope||!['shared','learner'].includes(String(scope.kind))||!content||!['exercise','introduction'].includes(String(content.kind))||!('body' in content))return false;
    return content.kind==='introduction'||(Array.isArray(content.answers)&&content.answers.every(value=>!!value&&typeof value==='object'&&Array.isArray((value as Record<string,unknown>).acceptedForms)&&((value as Record<string,unknown>).acceptedForms as unknown[]).every(form=>typeof form==='string')));
  });
}
function Scope({operation}:{operation:VocabularyProposalOperation}) {return <p className="vocabulary-scope">{operation.scope.kind==='shared'?'Shared content: future eligible learners':`Private content: learner ${operation.scope.learnerId}`}</p>;}

/** Operator surface: private evidence, authored drafts, exact review, then explicit application. */
export function VocabularyOperatorPage({api=vocabularyOperatorApi}:{api?:VocabularyOperatorApi}) {
  const [kind,setKind]=useState<VocabularyReflectionCase['kind']>('exercise_improvement');
  const [cases,setCases]=useState<VocabularyReflectionCase[]>([]),[proposals,setProposals]=useState<VocabularyContentProposal[]>([]),[dispatches,setDispatches]=useState<VocabularyFailedDispatch[]>([]);
  const [preparationFailures,setPreparationFailures]=useState<VocabularyFailedPreparation[]>([]);
  const [workspace,setWorkspace]=useState<VocabularyCaseWorkspace|null>(null),[selected,setSelected]=useState<VocabularyContentProposal|null>(null);
  const [draftText,setDraftText]=useState(''),[savedText,setSavedText]=useState('');
  const [preview,setPreview]=useState<VocabularyProposalPreview|null>(null),[review,setReview]=useState<{reviewId:string;version:number}|null>(null);
  const [reviewed,setReviewed]=useState(false),[reviewNote,setReviewNote]=useState(''),[reason,setReason]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [receipt,setReceipt]=useState<string|null>(null);const selectedRequest=useRef(0),applicationKey=useRef('');
  const dirty=draftText!==savedText;
  let draft:VocabularyProposalDraft|null=null;try{const value:unknown=JSON.parse(draftText);if(editableDraft(value))draft=value;}catch{/* Keep invalid editing text intact. */}
  const editable=selected===null||!['applied','closed'].includes(selected.status);
  async function reload(){const [caseList,proposalList,dispatchList,preparationList]=await Promise.all([api.cases(kind),api.proposals(),api.dispatches(),api.preparationFailures()]);setCases(caseList.items);setProposals(proposalList.items);setDispatches(dispatchList.items);setPreparationFailures(preparationList.items);}
  useEffect(()=>{let active=true;void Promise.all([api.cases(kind),api.proposals(),api.dispatches(),api.preparationFailures()]).then(([a,b,c,d])=>{if(active){setCases(a.items);setProposals(b.items);setDispatches(c.items);setPreparationFailures(d.items);}}).catch(cause=>{if(active)setError(message(cause));});return()=>{active=false;};},[api,kind]);
  async function run(work:()=>Promise<void>,success?:string){setBusy(true);setError('');setNotice('');try{await work();if(success)setNotice(success);}catch(cause){setError(message(cause));}finally{setBusy(false);}}
  function maySwitch(){return !dirty||window.confirm('Discard your unsaved draft edits and open another item?');}
  function resetReview(){setPreview(null);setReview(null);setReviewed(false);setReceipt(null);applicationKey.current='';}
  function install(value:VocabularyContentProposal){setSelected(value);const text=pretty(draftOf(value));setDraftText(text);setSavedText(text);setReviewNote('');setReason('');resetReview();}
  function changeDraft(next:VocabularyProposalDraft){setDraftText(pretty(next));resetReview();}
  function openCase(id:string){if(!maySwitch())return;void run(async()=>{const request=++selectedRequest.current;const value=await api.workspace(id);if(request!==selectedRequest.current)return;setWorkspace(value);setSelected(null);setDraftText('');setSavedText('');setReason('');resetReview();});}
  function openProposal(value:VocabularyContentProposal){if(!maySwitch())return;void run(async()=>{const request=++selectedRequest.current;const [latest,source]=await Promise.all([api.proposal(value.proposalId),value.caseId?api.workspace(value.caseId):Promise.resolve(null)]);if(request!==selectedRequest.current)return;setWorkspace(source);install(latest);});}
  function startDraft(source:VocabularyContent){if(!maySwitch())return;const next:VocabularyProposalDraft={caseId:workspace?.case.caseId,
    rationale:'',operations:[{operationKey:'repair-1',scope:source.accessScope==='shared'?{kind:'shared'}:{kind:'learner',learnerId:source.ownerLearnerId!},
      strategy:'update_existing',sourceContentId:source.contentId,expectedVersion:source.version,rationale:'',content:authored(source)}]};setSelected(null);setSavedText('');changeDraft(next);setNotice('Draft from current authored content. Describe the problem and edit the proposed content, then save.');}
  function strategy(index:number,next:VocabularyProposalOperation['strategy']) {
    if(!draft)return;const operation=draft.operations[index];if(!operation)return;
    const base=operation.strategy==='create'?draft.bases?.[index]??draft.bases?.[0]:{contentId:operation.sourceContentId,expectedVersion:operation.expectedVersion};
    const source=workspace?.sources.find(source=>source.contentId===(base?.contentId??operation.content.contentId))??workspace?.sources.find(source=>source.kind===operation.content.kind);
    if(next!=='create'&&!base&&!source){setError('Open the source case to select an existing content identity.');return;}
    const sourceId=base?.contentId??source?.contentId??operation.content.contentId??'',sourceVersion=base?.expectedVersion??source?.version??1;
    const content={...operation.content,contentId:next==='update_existing'?sourceId:operation.content.contentId===sourceId?crypto.randomUUID():operation.content.contentId??crypto.randomUUID(),
      ...(next==='update_existing'&&source?{originKind:source.originKind,authorKind:source.authorKind,authorId:source.authorId,accessScope:source.accessScope,ownerLearnerId:source.ownerLearnerId}:{})};
    const common={operationKey:operation.operationKey,scope:operation.scope,rationale:operation.rationale,content};
    const changed:VocabularyProposalOperation=next==='create'?{...common,strategy:'create'}:{...common,strategy:next,sourceContentId:sourceId,expectedVersion:sourceVersion};
    changeDraft({...draft,bases:base?draft.bases??[base]:draft.bases,operations:draft.operations.map((old,i)=>i===index?changed:old)});
  }
  function save(){void run(async()=>{if(!draft)throw new Error('Fix the JSON draft before saving.');const value=selected?await api.save(selected.proposalId,selected.version,draft):await api.create(draft);install(value);await reload();},'Draft saved. Preview this exact version before approval.');}
  function inspect(){if(!selected||dirty)return;void run(async()=>{setPreview(await api.preview(selected.proposalId,selected.version));setReview(null);setReviewed(false);},'Preview validated. Review the cue, expected answers, scope and identity effects.');}
  function approve(){if(!selected||!preview||dirty||!reviewed)return;void run(async()=>{const value=await api.approve(selected.proposalId,selected.version,reviewNote);setReview({...value,version:selected.version});setSelected({...selected,status:'approved'});await reload();},'Approval recorded for this version. Apply it to publish the displayed changes.');}
  function apply(){if(!selected||!review||review.version!==selected.version||dirty)return;void run(async()=>{applicationKey.current||=crypto.randomUUID();const result=await api.apply(selected.proposalId,selected.version,review.reviewId,applicationKey.current);setReceipt(result.applicationId);setSelected({...selected,status:'applied'});await reload();if(workspace)setWorkspace(await api.workspace(workspace.case.caseId));},'Applied. The content changes and application receipt were saved together.');}
  return <main className="vocabulary-operator-page">
    <header><h1>Vocabulary content review</h1><p>Review private evidence, draft a correction, then approve and apply its exact saved version.</p><button className="secondary-button" disabled={busy} onClick={()=>void run(reload,'Queues refreshed.')}>Refresh queues</button></header>
    {error&&<p role="alert" className="vocabulary-operator-error">{error} Your unsaved draft remains available.</p>}{notice&&<p role="status">{notice}</p>}
    {preparationFailures.length>0&&<section aria-label="Practice preparation failures"><h2>Practice preparation needs attention</h2><p>Retry queues one more generation attempt and may incur provider cost. Failed calls never retry automatically.</p><ul>{preparationFailures.map(item=><li key={item.workId}><span>Word {item.wordId} · attempt {item.attemptCount} of 3</span>{item.retryable?<button disabled={busy} onClick={()=>void run(async()=>{await api.retryPreparation(item.workId);await reload();},'Practice preparation queued; execution waits for provider work to be enabled.')}>Retry practice preparation</button>:<p>Attempt limit reached; inspect the retained invocation before changing preparation.</p>}<details><summary>Failure details</summary><p>{item.lastError}</p><p>Invocation: {item.invocationId??'No retained invocation'}</p><p>Source: {item.sourceContentId}</p></details></li>)}</ul></section>}
    {dispatches.length>0&&<section aria-label="Evidence processing failures"><h2>Evidence needs processing</h2><ul>{dispatches.map(item=><li key={item.dispatchId}><span>Session {item.sessionId} · learner {item.learnerId}</span><button disabled={busy} onClick={()=>void run(async()=>{await api.retryDispatch(item.dispatchId);await reload();},'Evidence processing queued.')}>Retry evidence processing</button><details><summary>Failure details</summary><p>{item.error}</p></details></li>)}</ul></section>}
    <div className="vocabulary-operator-layout"><aside aria-label="Review queues">
      <section><h2>Cases</h2><label>Inbox<select value={kind} disabled={busy} onChange={event=>setKind(event.target.value as VocabularyReflectionCase['kind'])}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        {cases.length===0?<p>No open cases in this inbox.</p>:<ul className="vocabulary-operator-list">{cases.map(item=><li key={item.caseId}><button disabled={busy} aria-pressed={workspace?.case.caseId===item.caseId} onClick={()=>openCase(item.caseId)}>{item.wordId??item.contentId??'Content issue'}<span>{item.evidence.length} encounter{item.evidence.length===1?'':'s'} · {new Date(item.createdAt).toLocaleString()}</span></button></li>)}</ul>}
      </section>
      <section><h2>Proposals</h2>{proposals.length===0?<p>No saved proposals.</p>:<ul className="vocabulary-operator-list">{proposals.map(item=><li key={item.proposalId}><button disabled={busy} aria-pressed={selected?.proposalId===item.proposalId} onClick={()=>openProposal(item)}>{item.rationale}<span>Version {item.version} · {item.status.replaceAll('_',' ')}</span></button></li>)}</ul>}</section>
    </aside><div className="vocabulary-operator-detail">
      {!workspace&&!selected&&<section><h2>Choose a case or proposal</h2><p>Teaching issues include the introduction and associated exercises for manual review. General exercise repairs arrive as separate proposals.</p></section>}
      {workspace&&<section aria-label="Case evidence"><h2>{kinds[workspace.case.kind]}</h2><p className="vocabulary-operator-meta">Learner {workspace.case.learnerId} · {workspace.case.status}</p>
        {workspace.jobs.map(job=><div className="vocabulary-operator-job" key={job.jobId}><span>{job.kind==='learner_feedback'?'Learner feedback':'Exercise improvement'} · {job.status} · attempt {job.attemptNumber}</span>{job.status==='failed'&&<button disabled={busy} onClick={()=>void run(async()=>{await api.retryJob(job.jobId);setWorkspace(await api.workspace(workspace.case.caseId));await reload();},'Processing queued. Other feedback and proposals remain independent.')}>Retry processing</button>}{job.error&&<details><summary>Failure details</summary><p>{job.error==='provider_outcome_unknown'?'The provider outcome is unknown. An explicit retry may make another call.':job.error}</p></details>}</div>)}
        <h3>What the learner encountered</h3>{workspace.case.evidence.map(encounter=><article className="vocabulary-operator-encounter" key={encounter.encounterId}><p className="vocabulary-operator-meta">{encounter.snapshot.role} · {encounter.snapshot.kind} · content version {encounter.snapshot.contentVersion}{encounter.skipped?' · skipped':''}</p><p className="vocabulary-operator-cue">{encounter.snapshot.body.prompt}</p>
          {encounter.snapshot.kind==='introduction'&&encounter.snapshot.body.material!==undefined&&<Readable value={encounter.snapshot.body.material}/>}
          {encounter.snapshot.assessment&&<p><strong>Expected answers:</strong> {encounter.snapshot.assessment.acceptedAnswers.join(' / ')}</p>}
          {encounter.responses.length?<ul>{encounter.responses.map(response=><li key={response.actionId}>{response.payload.response??'No answer'} · {response.payload.outcome}{!encounter.effectiveResponses.some(item=>item.actionId===response.actionId)?' · undone':''}</li>)}</ul>:<p>No answer was submitted.</p>}
          {(encounter.effectiveFeedback??effectiveVocabularyFeedback(encounter.feedback)).map(feedback=><p key={feedback.actionId}><strong>Learner feedback:</strong> {feedback.payload.comment||feedback.payload.feedback}</p>)}
          <details><summary>Exact retained encounter and reaction history</summary><pre>{pretty(encounter)}</pre></details></article>)}
        {workspace.case.kind!=='learner_feedback'&&<><h3>{workspace.case.kind==='teaching_review'?'Current introduction and teaching repertoire':'Current authored content'}</h3><p>Draft from the current version below. The encounters above preserve what was actually served.</p>{workspace.sources.map(source=><article key={source.contentId} className="vocabulary-operator-source"><h4>{source.kind==='introduction'?'Introduction':source.kind==='exercise'&&source.exerciseRole==='teaching'?'Teaching exercise':'General exercise'} · version {source.version}</h4><AuthoredContent content={source}/><p className="vocabulary-operator-meta">{source.contentId} · {source.accessScope} · {source.availability}</p><button disabled={busy} onClick={()=>startDraft(source)}>Draft a correction</button></article>)}</>}
        {workspace.case.kind==='teaching_review'&&<div className="vocabulary-operator-close"><label>Case resolution<textarea value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain the manual review outcome"/></label><button className="secondary-button" disabled={busy||!reason.trim()||workspace.case.status==='closed'} onClick={()=>void run(async()=>{await api.closeCase(workspace.case.caseId,reason);setWorkspace(await api.workspace(workspace.case.caseId));await reload();},'Teaching case closed; its evidence remains retained.')}>Close teaching case</button></div>}
      </section>}
      {(selected||draftText)&&<section aria-label="Proposal editor"><h2>{selected?`Proposal · version ${selected.version}`:'New correction draft'}</h2><p>{selected?.status.replaceAll('_',' ')??'Unsaved draft'}{dirty?' · unsaved changes':''}</p>
        {draft&&Array.isArray(draft.operations)?<><label>Diagnosis and overall rationale<textarea disabled={!editable||busy} value={draft.rationale??''} onChange={event=>changeDraft({...draft!,rationale:event.target.value})}/></label>{draft.operations.map((operation,index)=><fieldset key={`${index}-${operation.operationKey}`}><legend>Change {index+1}</legend><Scope operation={operation}/><label>Identity decision<select disabled={!editable||busy} value={operation.strategy} onChange={event=>strategy(index,event.target.value as VocabularyProposalOperation['strategy'])}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <p>{operation.strategy==='update_existing'?'Preserves the content ID and its identity-bound schedules and deactivations.':operation.strategy==='replace'?'Creates a new item and retires the old item. Existing schedules, deactivations and teaching references stay on the old identity.':'Creates an additional item; existing items stay active. No learner state or teaching relationships transfer automatically.'}</p>
          <label>Why this strategy and content are appropriate<textarea disabled={!editable||busy} value={operation.rationale} onChange={event=>changeDraft({...draft!,operations:draft!.operations.map((item,i)=>i===index?{...item,rationale:event.target.value}:item)})}/></label>
          <AuthoredContent content={operation.content}/></fieldset>)}</>:<p role="status">The JSON draft is incomplete. Fix it below before saving.</p>}
        <details open={!draft}><summary>Edit the full authored draft</summary><p>Change authored content and answer criteria here. The server validates relationships and scope before approval. Saving invalidates previous review.</p><label>Draft JSON<textarea className="vocabulary-operator-json" rows={18} value={draftText} disabled={busy||!editable} spellCheck={false} onChange={event=>{setDraftText(event.target.value);resetReview();}}/></label></details>
        {editable&&<div className="vocabulary-operator-actions"><button disabled={busy||!draft||!dirty} onClick={save}>{selected?'Save new version':'Save draft'}</button><button className="secondary-button" disabled={busy||!selected||dirty} onClick={inspect}>Validate and preview saved version</button></div>}
        {preview&&<div className="vocabulary-operator-preview"><h3>Validated preview · version {preview.proposal.version}</h3>{preview.previews.map(item=><article key={item.operationKey}><h4>{labels[preview.proposal.operations.find(operation=>operation.operationKey===item.operationKey)!.strategy]}</h4><div className="vocabulary-operator-comparison"><div><h5>Current item</h5>{item.source?<AuthoredContent content={item.source}/>:<p>New item</p>}</div><div><h5>Proposed result</h5><AuthoredContent content={item.result}/></div></div></article>)}
          <div className="vocabulary-operator-table" role="region" aria-label="Identity relationship effects" tabIndex={0}><table><caption>Identity-bound relationships; no automatic transfer</caption><thead><tr><th>Change</th><th>Scope</th><th>Cue schedules</th><th>Deactivations</th><th>Teaching references</th><th>Sense relationships</th><th>Curation records</th></tr></thead><tbody>{preview.operations.map(item=><tr key={item.operationKey}><th>{labels[item.strategy]}</th><td>{item.scope.kind==='shared'?'Shared':`Private: ${item.scope.learnerId}`}</td><td>{item.schedulesRemainOnSource}</td><td>{item.deactivationsRemainOnSource}</td><td>{item.teachingBindingsRemainOnSource+item.sourceIntroductionExercises}</td><td>{item.sourceSenseMappings}</td><td>{item.sourceCurations}</td></tr>)}</tbody></table></div>
          <label className="vocabulary-operator-checkbox"><input type="checkbox" checked={reviewed} disabled={busy||selected?.status==='applied'} onChange={event=>setReviewed(event.target.checked)}/>I reviewed the cue, expected answers, scope and identity effects for version {preview.proposal.version}.</label>
          <label>Review note (optional)<textarea value={reviewNote} disabled={busy||selected?.status==='applied'} onChange={event=>setReviewNote(event.target.value)}/></label>
          <div className="vocabulary-operator-actions"><button disabled={busy||!reviewed||dirty||!editable} onClick={approve}>Record approval for this version</button><button disabled={busy||!review||review.version!==selected?.version||dirty||!editable} onClick={apply}>Apply approved changes</button></div>
        </div>}
        {receipt&&<p role="status">Application receipt: <code>{receipt}</code></p>}
        {selected&&editable&&<details><summary>Close proposal without applying</summary><label>Reason<textarea value={reason} onChange={event=>setReason(event.target.value)}/></label><button className="secondary-button" disabled={busy||!reason.trim()||dirty} onClick={()=>void run(async()=>{await api.close(selected.proposalId,selected.version,reason);install(await api.proposal(selected.proposalId));await reload();},'Proposal closed; authored content was not changed.')}>Close proposal</button></details>}
      </section>}
    </div></div>
  </main>;
}
