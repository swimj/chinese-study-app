import { vocabularyPhraseClozeError } from '../../domain/vocabulary-production-coverage';
import type { VocabularyContent,VocabularyContentDraft } from '../../domain/vocabulary-content';
import type { VocabularyProposalOperation,VocabularySenseLabel } from '../../domain/vocabulary-reflection';
import type { VocabularyReviewSnapshot } from './api';
import { ReadableJson } from './content-improvement-entry';
import { consequentialContentChanges,editableCue,groupOperations,operationAnswers,operationScope,readableSenseProse,sourceConsequences,updateCue } from './proposal-review';

export const proposalStrategyLabels={create:'Add exercise',update_existing:'Update exercise',replace:'Replace exercise',retire:'Retire exercise'} as const;
function ContentCue({content}:{content:VocabularyContentDraft}) {const body=content.body;return body&&typeof body==='object'&&!Array.isArray(body)&&typeof body.prompt==='string'?<p className="vocabulary-operator-cue">{body.prompt}</p>:<ReadableJson value={body}/>;}
function ContentDetails({content}:{content:VocabularyContentDraft}){return <pre>{JSON.stringify(content,null,2)}</pre>;}
export function CompactProposalReview({operations,previews,senses,excluded,toggle,disabled,editing,onChange,onStrategy,stale=false,onDraftCorrection,currentSources=[],bases=[]}:{
  currentSources?:VocabularyContent[];bases?:{contentId:string;expectedVersion:number}[];
  stale?:boolean;onDraftCorrection?:(source:VocabularyContent)=>void;
  operations:VocabularyProposalOperation[];previews:VocabularyReviewSnapshot['previews'];senses:VocabularySenseLabel[];
  excluded:ReadonlySet<string>;toggle:(key:string)=>void;disabled:boolean;editing:boolean;
  onChange:(key:string,change:(operation:VocabularyProposalOperation)=>VocabularyProposalOperation)=>void;
  onStrategy:(index:number,strategy:'create'|'update_existing'|'replace'|'retire')=>void;
}) {
  const scopes=[...new Set(operations.map(operationScope))],answers=[...new Set(operations.map(operationAnswers).filter(Boolean))];
  const sources=[...new Map([...currentSources,...previews.flatMap(item=>item.source?[item.source]:[])].map(source=>[source.contentId,source])).values()];
  const consequences=sourceConsequences(operations,excluded);
  return <div className="vocabulary-compact-review">
    <div className="vocabulary-repertoire-header"><span>{scopes.join(' · ')}</span>{answers.length===1&&<span><strong>Expected answer</strong> {answers[0]}</span>}</div>
    {sources.map((source,index)=><div className="vocabulary-source-summary" key={source.contentId}>
      {consequences.find(item=>item.sourceContentId===source.contentId)&&<p className="vocabulary-source-effect">{consequences.find(item=>item.sourceContentId===source.contentId)!.retired?'Source exercise will retire.':'Source exercise will stay active.'}</p>}
      <details open={stale||undefined}><summary>Current source{sources.length>1?` ${index+1}`:''} · version {source.version}</summary><ContentCue content={source}/><p><strong>Expected answers:</strong> {(source.answers??[]).map(answer=>answer.acceptedForms.join(' / ')).join(' / ')}</p>{stale&&<p className="vocabulary-operator-meta">Proposal based on {[...new Set([...bases.filter(base=>base.contentId===source.contentId).map(base=>base.expectedVersion),...operations.flatMap(operation=>operation.strategy!=='create'&&operation.sourceContentId===source.contentId?[operation.expectedVersion]:[])])].map(version=>`v${version}`).join(', ')}</p>}{stale&&onDraftCorrection&&<button className="secondary-button" disabled={disabled} onClick={()=>onDraftCorrection(source)}>Draft a correction from v{source.version}</button>}<details><summary>Source details</summary><ContentDetails content={source}/></details></details>
    </div>)}
    {groupOperations(operations,senses).map(group=><section className="vocabulary-sense-group" key={group.key} aria-label={group.label}>
      <h3>{group.label} <span className="vocabulary-group-count">{group.operations.filter(operation=>!excluded.has(operation.operationKey)).length}/{group.operations.length}</span></h3>
      {group.operations.map(operation=>{
        const included=!excluded.has(operation.operationKey),index=operations.findIndex(item=>item.operationKey===operation.operationKey),cue=editableCue(operation.content);
        const cueError=operation.strategy==='retire'?null:vocabularyPhraseClozeError(operation.content.body);
        const changed=operation.strategy==='retire'?[]:consequentialContentChanges(previews.find(item=>item.operationKey===operation.operationKey)?.source??null,operation.content);
        return <article className={`vocabulary-proposed-row${included?'':' vocabulary-proposed-excluded'}`} key={operation.operationKey}>
          <div className="vocabulary-proposed-row-heading"><label className="vocabulary-inclusion"><input type="checkbox" checked={included} disabled={disabled} onChange={()=>toggle(operation.operationKey)} aria-label={`Include change ${index+1}: ${proposalStrategyLabels[operation.strategy]}`}/><span>{proposalStrategyLabels[operation.strategy]}</span></label>
          {editing&&<select aria-label={`Strategy for change ${index+1}`} value={operation.strategy} disabled={disabled} onChange={event=>onStrategy(index,event.target.value as 'create'|'update_existing'|'replace'|'retire')}>{Object.entries(proposalStrategyLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>}</div>
          {scopes.length>1&&<p className="vocabulary-operator-meta">{operationScope(operation)}</p>}
          {operation.strategy==='retire'?<p>{included?'Retire without a replacement.':'Retirement excluded; the source stays active.'}</p>
            :editing&&cue?<div className="vocabulary-cue-editor">{cue.kind==='phrase_cloze'&&<label>English frame<textarea disabled={disabled} value={cue.frame} onChange={event=>onChange(operation.operationKey,item=>({...item,content:updateCue(item.content,{...cue,frame:event.target.value})}))}/></label>}<label>{cue.kind==='phrase_cloze'?'Mandarin cloze':'Cue'}<textarea disabled={disabled} value={cue.text} onChange={event=>onChange(operation.operationKey,item=>({...item,content:updateCue(item.content,{...cue,text:event.target.value})}))}/></label></div>
            :<ContentCue content={operation.content}/>}
          {answers.length!==1&&operationAnswers(operation)&&<p className="vocabulary-operator-meta"><strong>Expected answer</strong> {operationAnswers(operation)}</p>}
          {operation.strategy==='replace'&&!included&&<p className="vocabulary-operator-meta">Replacement excluded; its source stays active.</p>}
          {cueError&&<p role="alert" className="vocabulary-operator-error">{cueError}</p>}
          {changed.length>0&&<p className="vocabulary-operator-meta">Also changes: {changed.join(', ')}.</p>}
          <details className="vocabulary-item-details"><summary>Item details</summary>{editing?<label>Rationale<textarea disabled={disabled} value={operation.rationale} onChange={event=>onChange(operation.operationKey,item=>({...item,rationale:event.target.value}))}/></label>:<p>{readableSenseProse(operation.rationale,senses)}</p>}<ContentDetails content={operation.content}/></details>
        </article>;
      })}
    </section>)}
  </div>;
}
