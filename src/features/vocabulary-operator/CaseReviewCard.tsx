import { useState, type ReactNode } from 'react';
import { convertSentenceCharacters } from '../../domain/sentence-characters';
import type { VocabularyCaseQueueItem, VocabularyOperationReview, VocabularyServedReview } from '../../domain/vocabulary-case-queue';

const strategies = { create: 'Add', update_existing: 'Update', replace: 'Replace', retire: 'Retire' };
const roles = { source_repair: 'Source repair', refinement: 'Refinement', enrichment: 'Enrichment', shared: 'Shared practice' };
const outcomes: Record<string, string> = { single_sense: 'Exercise improvement', repertoire_bootstrap: 'Default selected senses', already_covered: 'Authored practice already exists', laundry_list: 'Default selected senses', unmappable: 'Sense needs review', inventory_gap: 'Sense inventory needs review', needs_coverage: 'Useful senses need review', no_senses_requested: 'No senses selected' };
const stages: Record<string, string> = { sense_mapping: 'Sense mapping', single_improvement: 'Exercise improvement', pure_cue_promotion: 'Shared cue integration', pure_cue_improvement: 'Pure cue improvement', repertoire: 'Repertoire', exercise_improvement: 'Exercise improvement' };

const icons = { create: '+', update_existing: '↻', replace: '⇄', retire: '−' };
function answers(forms: string[]): string {
  return [...new Set(forms.map(form => convertSentenceCharacters(form, 'simplified')))].join(' · ');
}

function Operation({ operation, item, summary, editCue }: { editCue?: (key:string)=>ReactNode; operation: VocabularyOperationReview; item: VocabularyCaseQueueItem; summary: string }) {
  const pure = operation.pureCue;
  const before = item.served.find(encounter => encounter.contentId === operation.sourceContentId && encounter.contentVersion === operation.expectedVersion)?.acceptedAnswers
    ?? item.sources.find(source => source.contentId === operation.sourceContentId && source.version === operation.expectedVersion)?.acceptedAnswers;
  const label = operation.prompt ?? pure?.axisNote ?? 'Exercise';
  const rationale = operation.learningRole !== 'source_repair' && operation.rationale.trim() !== summary.trim() ? operation.rationale : '';
  const changes = operation.otherChanges.filter(change => !pure || !['reveal', 'expected answers'].includes(change));
  const privateScope = operation.scopeLabel.startsWith('Private');
  const showAnswers = !pure && operation.learningRole !== 'source_repair' && operation.acceptedAnswers.length > 0;
  const hasDetails = !!pure || privateScope || showAnswers || !!rationale || changes.length > 0;
  const heading = <><span className="vocabulary-review-action"><span aria-hidden="true">{icons[operation.strategy]}</span> {strategies[operation.strategy]}{operation.learningRole && operation.learningRole !== 'shared' ? ` · ${roles[operation.learningRole]}` : ''}</span><span className="vocabulary-review-item-label">{label}</span></>;
  const className = `vocabulary-review-item vocabulary-review-item--${operation.strategy}`;
  const cueActions = operation.strategy !== 'retire' ? editCue?.(operation.operationKey) : null;
  if (!hasDetails) return <div className={`${className} vocabulary-review-item--plain`}>{heading}{cueActions && <div className="vocabulary-review-item-body">{cueActions}</div>}</div>;
  return <details className={className}>
    <summary>{heading}</summary>
    <div className="vocabulary-review-item-body">
      {cueActions}
      {privateScope && <p className="vocabulary-operator-meta">{operation.scopeLabel}</p>}
      {pure?.axisNote && <p><strong>Axis:</strong> {pure.axisNote}</p>}
      {pure ? <p className="vocabulary-answer-change"><span>{before ? answers(before) : operation.strategy === 'create' ? 'New cue' : 'Assessed accepted answers unavailable'}</span><span aria-label="changes to">→</span><strong>{answers(operation.acceptedAnswers) || 'No accepted answers'}</strong></p>
        : showAnswers && <p><strong>Accepted answers:</strong> {answers(operation.acceptedAnswers)}</p>}
      {pure?.teachingNote && <p><strong>Teaching note:</strong> {pure.teachingNote}</p>}
      {rationale && <p>{rationale}</p>}
      {changes.length > 0 && <ul>{changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}
    </div>
  </details>;
}

function ReusedCue({ cue }: { cue: NonNullable<VocabularyCaseQueueItem['reusedSharedCue']> }) {
  return <details className="vocabulary-review-item vocabulary-review-item--reuse" aria-label="Reused shared practice">
    <summary><span className="vocabulary-review-action"><span aria-hidden="true">↗</span> Reuse existing</span><span className="vocabulary-review-item-label">{cue.axisNote ?? cue.prompt ?? 'Shared cue unavailable'}</span></summary>
    <div className="vocabulary-review-item-body">
      {cue.axisNote && cue.prompt !== null && <p className="vocabulary-operator-cue">{cue.prompt}</p>}
      {cue.acceptedAnswers.length > 0 && <p><strong>Accepted answers:</strong> {answers(cue.acceptedAnswers)}</p>}
      {cue.teachingNote && <p>{cue.teachingNote}</p>}
      {cue.rationale && <p>{cue.rationale}</p>}
      <p className="vocabulary-operator-meta">{cue.expectedVersion !== null && cue.expectedVersion !== cue.version && <>Assessed version {cue.expectedVersion} · </>}{cue.version !== null && <>Current version {cue.version} · </>}{cue.contentId}</p>
    </div>
  </details>;
}

function Encounter({ encounter, baseline, children }: { encounter: VocabularyServedReview; baseline?: VocabularyServedReview; children?: ReactNode }) {
  const accepted = encounter.pureCue && (!baseline || answers(encounter.acceptedAnswers) !== answers(baseline.acceptedAnswers)) ? answers(encounter.acceptedAnswers) : null;
  return <article className="vocabulary-encounter">
    {(!baseline || encounter.prompt !== baseline.prompt) && <p className="vocabulary-operator-cue">{encounter.prompt ?? 'The original served content is unavailable.'}</p>}
    {encounter.choices.length > 0 && JSON.stringify(encounter.choices) !== JSON.stringify(baseline?.choices) && <ol>{encounter.choices.map(choice => <li key={choice.id}>{choice.text}</li>)}</ol>}
    {accepted && <p><strong>Accepted answers:</strong> {accepted}</p>}
    <div className="vocabulary-response-row"><div>
      {encounter.responses.map(response => <span className="vocabulary-response" key={response.actionId}>{response.text ?? 'Self assessment'} <small>· {response.outcome}{response.undone ? ' (undone)' : ''}</small></span>)}
      {encounter.reactions.map(reaction => <span className="vocabulary-response" key={reaction.actionId}>{reaction.feedback}{reaction.comment ? `: ${reaction.comment}` : ''}{reaction.undone ? ' (undone)' : ''}</span>)}
      {encounter.skipped && <span className="vocabulary-response">Skipped</span>}{encounter.presentationUndone && <span className="vocabulary-response">Presentation undone</span>}
    </div>{children}</div>
  </article>;
}

/** Render-only projection: deliberately cannot be passed to the authored-content editor. */
export function CaseReviewCard({ item, children, onDetails, showDetails = false, wordDefaults, editCue, onReassessOpinion, reassessmentDisabled = false }: { editCue?: (key:string|null)=>ReactNode; onReassessOpinion?: () => void; reassessmentDisabled?: boolean; wordDefaults?: ReactNode; item: VocabularyCaseQueueItem; children?: ReactNode; onDetails: () => void; showDetails?: boolean }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const encounters = [...item.served].sort((a, b) => a.presentedAt && b.presentedAt ? a.presentedAt.localeCompare(b.presentedAt) : a.presentedAt ? -1 : b.presentedAt ? 1 : 0);
  const first = encounters[0];
  const groups = new Map<string, VocabularyOperationReview[]>();
  for (const operation of item.proposal?.operations ?? []) groups.set(operation.groupLabel, [...(groups.get(operation.groupLabel) ?? []), operation]);
  const encounterTime = first?.presentedAt;
  const repertoire = ['repertoire_bootstrap', 'laundry_list'].includes(item.assessment?.outcome ?? '');
  const summary = item.assessment?.diagnosis || item.proposal?.rationale || '';
  const authorStages = ['repertoire', 'single_improvement', 'pure_cue_improvement', 'exercise_improvement'];
  const author = authorStages.flatMap(stage => item.assessment?.models.filter(model => model.stage === stage) ?? [])[0];
  const changedSources = item.sources.filter(source => source.version !== source.expectedVersion);
  return <section className="vocabulary-improvement-entry vocabulary-case-card" aria-label="Improvement case">
    <div className="vocabulary-case-heading"><h2>{item.wordLabel ?? first?.pureCue?.axisNote ?? 'Content review'}</h2><span className="vocabulary-operator-meta">{encounterTime ? new Date(encounterTime).toLocaleString() : `Case opened · ${new Date(item.createdAt).toLocaleString()}`}</span></div>
    <div className="vocabulary-served-lead" aria-label="Original served content">
      {item.kind === 'teaching_review' && <p className="vocabulary-served-label">Teaching encounter</p>}
      {item.served.length === 0 && <p>The original served content is not available for this case.</p>}
      {first && <Encounter encounter={first}>{encounters.length > 1 && <button className="vocabulary-encounter-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}><span aria-hidden="true">{historyOpen ? '▾' : '▸'}</span> {encounters.length - 1} more encounters</button>}</Encounter>}
      <div className="vocabulary-encounter-history" hidden={!historyOpen}>{encounters.slice(1).map(encounter => <section key={encounter.encounterId}><p className="vocabulary-operator-meta">{encounter.presentedAt ? new Date(encounter.presentedAt).toLocaleString() : 'Encounter time unavailable'}{encounter.role !== first?.role && ` · ${encounter.role}`}{encounter.kind !== first?.kind && ` · ${encounter.kind}`}{encounter.contentVersion !== null && encounter.contentVersion !== first?.contentVersion ? ` · version ${encounter.contentVersion}` : ''}</p><Encounter encounter={encounter} baseline={first} /></section>)}</div>
    {item.stale && <p role="alert" className="vocabulary-operator-error">Source or sense mapping changed.{item.state === 'open' && <> Approval and second opinion are unavailable.{item.proposal && ' You can edit or dismiss this proposal.'}{item.reassessment.eligible && ' Reassessment uses the current source.'}</>}</p>}
    {changedSources.length > 0 && <details className="vocabulary-source-summary" ><summary>Source changed{changedSources.length === 1 ? '' : 's'}</summary>{changedSources.map(source => <article key={source.contentId}><p className="vocabulary-operator-meta">Assessed v{source.expectedVersion} · {source.version === null ? 'unavailable' : `current v${source.version}`}{source.availability ? ` · ${source.availability}` : ''}</p>{source.prompt !== null && <p className="vocabulary-operator-cue">{source.prompt}</p>}{source.acceptedAnswers.length > 0 && <p><strong>Accepted answers:</strong> {source.acceptedAnswers.join(' · ')}</p>}</article>)}</details>}
    </div>
    {!item.proposal && editCue?.(null)}
    <h3 className="vocabulary-improvement-heading">{repertoire ? <><span aria-hidden="true">📖</span> Repertoire bootstrap</> : 'Proposed improvement'}</h3>
    {item.proposal?.authorKind === 'operator' ? <p className="vocabulary-operator-meta">Operator correction</p> : author && <p className="vocabulary-operator-meta" aria-label="Content model">{author.resolvedModel ?? author.model}</p>}
    {summary && !repertoire && summary.trim() !== item.finding?.message.trim() && <p>{summary}</p>}
    {item.finding && <p className="vocabulary-case-finding"><strong>{{unmappable:'Intended sense unresolved',inventory_gap:'Sense inventory gap',needs_coverage:'Useful senses need review',needs_operator:'Candidate identity unresolved'}[item.finding.kind]}</strong>{item.finding.message && ` · ${item.finding.message}`}</p>}
    {item.kind !== 'teaching_review' && item.state === 'open' && !item.reassessment.eligible && item.reassessment.reason && <p className="vocabulary-operator-meta">Reassessment unavailable: {item.reassessment.reason}</p>}
    {item.state === 'resolved' && <p><strong>Resolved</strong>{item.resolvedAt ? ` · ${new Date(item.resolvedAt).toLocaleString()}` : ''}</p>}
    {item.activeJob && <p role="status">{item.frozen ? 'Reassessment' : 'Assessment'} {item.activeJob.sequence} {item.activeJob.status === 'queued' ? 'queued' : 'running'}{item.frozen ? ' · review is paused' : ''}</p>}
    {item.latestJob?.status === 'failed' && <p role="alert" className="vocabulary-operator-error">{item.latestJob.advisory ? 'Second opinion' : 'Assessment'} {item.latestJob.sequence} failed: {item.latestJob.error === 'source_conflict' ? 'The source changed. Reassess the current source.' : item.latestJob.error === 'provider_outcome_unknown' ? 'The provider outcome is unknown. Retrying may make another call.' : item.latestJob.error ?? 'Processing failed.'}</p>}
    {item.approvalState && <p role="status">{item.approvalState === 'pending' ? 'Approval queued; application is not yet confirmed.' : 'Approval needs attention.'}</p>}
    {wordDefaults}
    {item.reusedSharedCue && <>
      <ReusedCue cue={item.reusedSharedCue} />
      {item.reusedSharedCue.availability !== 'active' && <p className="vocabulary-operator-error">{item.reusedSharedCue.availability === null ? 'The referenced shared cue is unavailable.' : `The referenced shared cue is ${item.reusedSharedCue.availability}.`}</p>}
    </>}
    {item.proposal ? <div className="vocabulary-compact-review">
      {item.proposal.operations.filter(operation => operation.pureCue || !repertoire).map(operation => <Operation key={operation.operationKey} item={item} operation={operation} summary={summary} editCue={editCue} />)}
      {repertoire && [...groups].map(([label, operations]) => { const exercises = operations.filter(operation => !operation.pureCue); return exercises.length > 0 && <details className="vocabulary-sense-group" key={label}><summary><strong>{label}</strong> <span className="vocabulary-group-count">{exercises.length} {exercises.length === 1 ? 'exercise' : 'exercises'}</span></summary>{exercises.map(operation => <Operation key={operation.operationKey} item={item} operation={operation} summary={summary} editCue={editCue} />)}</details>; })}
    </div> : <p><strong>{item.needsDecision ? 'Needs a decision' : item.currentAssessment ? 'No change proposed' : 'Awaiting assessment'}</strong></p>}
    {item.advisoryOpinion && <div className="vocabulary-second-opinion" aria-label="Second opinion"><p><strong>Second opinion · job {item.advisoryOpinion.sequence}</strong></p>{item.advisoryOpinion.result ? <><p>{{ support: 'Supports this judgment', revise: 'Suggests revision', reject: 'Recommends against this judgment' }[item.advisoryOpinion.result.verdict]}</p><p>{item.advisoryOpinion.result.rationale}</p>{onReassessOpinion && item.advisoryOpinion.status === 'succeeded' && item.reassessment.eligible && item.state === 'open' && <button className="secondary-button" aria-haspopup="dialog" disabled={reassessmentDisabled || item.frozen || !!item.activeJob || item.approvalState === 'pending'} onClick={onReassessOpinion}>Reassess with this opinion</button>}</> : <p role="status">{item.advisoryOpinion.status === 'queued' ? 'Queued' : item.advisoryOpinion.status === 'running' ? 'Reviewing…' : 'Review failed'}</p>}</div>}
    {item.requiresDetails && <p><button className="secondary-button" onClick={onDetails}>Review full content before approval</button></p>}
    {showDetails && <section className="vocabulary-case-provenance" aria-label="Case details">    {item.assessment ? <div aria-label="Assessment provenance">
      <p className="vocabulary-operator-meta"><strong>Assessment {item.assessment.sequence}</strong> · {item.assessment.origin === 'automatic' ? 'Automatic assessment' : item.assessment.origin === 'identity_resolution' ? 'Operator lexical resolution' : 'Operator reassessment'}{item.currentAssessment?.jobId !== item.assessment.jobId ? ' · earlier assessment' : ''}</p>
      {item.assessment.models.map(model => <p className="vocabulary-operator-meta" key={`${model.invocationId}:${model.stage}`}>{stages[model.stage] ?? model.stage} · {model.resolvedModel ?? model.model} · {model.provider}</p>)}
      {item.assessment.outcome && <p><strong>{outcomes[item.assessment.outcome] ?? item.assessment.outcome}</strong>{item.assessment.scopeLabel ? ` · ${item.assessment.scopeLabel}` : ''}</p>}

    </div> : item.proposal?.authorKind === 'operator' ? <p className="vocabulary-operator-meta">Operator correction</p> : null}
{first?.pureCue?.teachingNote && <details><summary>Original teaching note</summary><p>{first.pureCue.teachingNote}</p></details>}{item.proposal && <>      <p className="vocabulary-operator-meta">Proposal revision {item.proposal.version}{!item.proposal.isCurrent ? ' · retained alternative' : ''}{['applied', 'closed'].includes(item.proposal.status) ? ` · ${item.proposal.status === 'applied' ? 'Applied' : 'Dismissed'}` : ''}</p>
</>}<p className="vocabulary-operator-meta">{first ? [first.role, first.kind, first.contentVersion !== null ? `version ${first.contentVersion}` : null].filter(Boolean).join(' · ') : null}</p>{children}<button className="secondary-button" onClick={onDetails}>Full review workspace</button></section>}
  </section>;
}
