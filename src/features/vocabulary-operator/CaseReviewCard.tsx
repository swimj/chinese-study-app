import type { ReactNode } from 'react';
import type { VocabularyCaseQueueItem, VocabularyOperationReview } from '../../domain/vocabulary-case-queue';

const strategies = { create: 'Add', update_existing: 'Update', replace: 'Replace', retire: 'Retire' };
const roles = { source_repair: 'Source repair', refinement: 'Refinement', enrichment: 'Enrichment', shared: 'Shared practice' };
const outcomes: Record<string, string> = { single_sense: 'Exercise improvement', repertoire_bootstrap: 'Default selected senses', already_covered: 'Authored practice already exists', laundry_list: 'Default selected senses', unmappable: 'Sense needs review', inventory_gap: 'Sense inventory needs review', needs_coverage: 'Useful senses need review', no_senses_requested: 'No senses selected' };
const stages: Record<string, string> = { sense_mapping: 'Sense mapping', single_improvement: 'Exercise improvement', pure_cue_promotion: 'Shared cue integration', pure_cue_improvement: 'Pure cue improvement', repertoire: 'Repertoire', exercise_improvement: 'Exercise improvement' };

function Operation({ operation, redundant }: { operation: VocabularyOperationReview; redundant: Set<string> }) {
  return <article className="vocabulary-proposed-row">
    <div className="vocabulary-proposed-row-heading"><strong>{strategies[operation.strategy]}{operation.learningRole ? ` · ${roles[operation.learningRole]}` : ''}</strong><span className="vocabulary-operator-meta">{operation.scopeLabel}</span></div>
    {operation.prompt !== null && <p className="vocabulary-operator-cue">{operation.prompt}</p>}
    {operation.acceptedAnswers.length > 0 && <p><strong>Accepted answers:</strong> {operation.acceptedAnswers.join(' · ')}</p>}
    {operation.rationale && !redundant.has(operation.rationale.trim()) && <p>{operation.rationale}</p>}
    {operation.otherChanges.length > 0 && <ul>{operation.otherChanges.map((change, index) => <li key={index}>{change}</li>)}</ul>}
  </article>;
}

/** Render-only projection: deliberately cannot be passed to the authored-content editor. */
export function CaseReviewCard({ item, children, onDetails }: { item: VocabularyCaseQueueItem; children?: ReactNode; onDetails: () => void }) {
  const groups = new Map<string, VocabularyOperationReview[]>();
  for (const operation of item.proposal?.operations ?? []) groups.set(operation.groupLabel, [...(groups.get(operation.groupLabel) ?? []), operation]);
  const encounterTime = item.served.map(entry => entry.presentedAt).filter((value): value is string => !!value).sort()[0];
  const repertoire = ['repertoire_bootstrap', 'laundry_list'].includes(item.assessment?.outcome ?? '');
  const repeated = new Set([item.assessment?.diagnosis.trim(), item.proposal?.rationale.trim()].filter((value): value is string => !!value));
  const changedSources = item.sources.filter(source => source.version !== source.expectedVersion);
  return <section className="vocabulary-improvement-entry vocabulary-case-card" aria-label="Improvement case">
    <div className="vocabulary-case-heading"><h2>{item.wordLabel ?? (item.proposal?.operations.flatMap(operation => operation.acceptedAnswers).filter((answer, index, all) => all.indexOf(answer) === index).join(' · ') || 'Content review')}</h2><span className="vocabulary-operator-meta">{encounterTime ? `Encounter · ${new Date(encounterTime).toLocaleString()}` : `Case opened · ${new Date(item.createdAt).toLocaleString()}`}</span></div>
    <div className="vocabulary-served-lead" aria-label="Original served content">
      <p className="vocabulary-served-label">Original served content</p>
      {item.served.length === 0 && <p>The original served content is not available for this case.</p>}
      {item.served.map(encounter => <article key={encounter.encounterId}>
        <p className="vocabulary-operator-meta">{[item.served.length > 1 && encounter.presentedAt ? new Date(encounter.presentedAt).toLocaleString() : null, encounter.role, encounter.kind, encounter.contentVersion !== null ? `version ${encounter.contentVersion}` : null].filter(Boolean).join(' · ')}{encounter.presentationUndone ? ' · presentation undone' : ''}</p>
        <p className="vocabulary-operator-cue">{encounter.prompt ?? 'The original served content is unavailable.'}</p>
        {encounter.choices.length > 0 && <ol>{encounter.choices.map(choice => <li key={choice.id}>{choice.text}</li>)}</ol>}
        {encounter.acceptedAnswers.length > 0 && <p><strong>Expected answers:</strong> {encounter.acceptedAnswers.join(' · ')}</p>}
        {(encounter.responses.length > 0 || encounter.reactions.length > 0 || encounter.skipped) && <ul className="vocabulary-encounter-responses">
          {encounter.responses.map(response => <li key={response.actionId}>{response.text ?? 'Self assessment'} · {response.outcome}{response.undone ? ' (undone)' : ''}</li>)}
          {encounter.reactions.map(reaction => <li key={reaction.actionId}>{reaction.feedback}{reaction.comment ? `: ${reaction.comment}` : ''}{reaction.undone ? ' (undone)' : ''}</li>)}
          {encounter.skipped && <li>Skipped</li>}
        </ul>}
      </article>)}
    {item.stale && <p role="alert" className="vocabulary-operator-error">Source or sense mapping changed.{item.state === 'open' && <> Approval and second opinion are unavailable.{item.proposal && ' You can edit or dismiss this proposal.'}{item.reassessment.eligible && ' Reassessment uses the current source.'}</>}</p>}
    {changedSources.length > 0 && <details className="vocabulary-source-summary" ><summary>Source changed{changedSources.length === 1 ? '' : 's'}</summary>{changedSources.map(source => <article key={source.contentId}><p className="vocabulary-operator-meta">Assessed v{source.expectedVersion} · {source.version === null ? 'unavailable' : `current v${source.version}`}{source.availability ? ` · ${source.availability}` : ''}</p>{source.prompt !== null && <p className="vocabulary-operator-cue">{source.prompt}</p>}{source.acceptedAnswers.length > 0 && <p><strong>Accepted answers:</strong> {source.acceptedAnswers.join(' · ')}</p>}</article>)}</details>}
    </div>
    {item.assessment ? <div aria-label="Assessment provenance">
      <p className="vocabulary-operator-meta"><strong>Assessment {item.assessment.sequence}</strong> · {item.assessment.origin === 'automatic' ? 'Automatic assessment' : item.assessment.origin === 'identity_resolution' ? 'Operator lexical resolution' : 'Operator reassessment'}{item.currentAssessment?.jobId !== item.assessment.jobId ? ' · earlier assessment' : ''}</p>
      {item.assessment.models.map(model => <p className="vocabulary-operator-meta" key={`${model.invocationId}:${model.stage}`}>{stages[model.stage] ?? model.stage} · {model.resolvedModel ?? model.model} · {model.provider}</p>)}
      {item.assessment.outcome && <p><strong>{outcomes[item.assessment.outcome] ?? item.assessment.outcome}</strong>{item.assessment.scopeLabel ? ` · ${item.assessment.scopeLabel}` : ''}</p>}
      {item.assessment.diagnosis && !repertoire && <p>{item.assessment.diagnosis}</p>}
    </div> : item.proposal?.authorKind === 'operator' ? <p className="vocabulary-operator-meta">Operator correction</p> : null}
    {item.finding && <p className="vocabulary-case-finding"><strong>{{unmappable:'Intended sense unresolved',inventory_gap:'Sense inventory gap',needs_coverage:'Useful senses need review',needs_operator:'Candidate identity unresolved'}[item.finding.kind]}</strong>{item.finding.message && ` · ${item.finding.message}`}</p>}
    {item.state === 'open' && !item.reassessment.eligible && item.reassessment.reason && <p className="vocabulary-operator-meta">Reassessment unavailable: {item.reassessment.reason}</p>}
    {item.state === 'resolved' && <p><strong>Resolved</strong>{item.resolvedAt ? ` · ${new Date(item.resolvedAt).toLocaleString()}` : ''}</p>}
    {item.activeJob && <p role="status">{item.frozen ? 'Reassessment' : 'Assessment'} {item.activeJob.sequence} {item.activeJob.status === 'queued' ? 'queued' : 'running'}{item.frozen ? ' · review is paused' : ''}</p>}
    {item.latestJob?.status === 'failed' && <p role="alert" className="vocabulary-operator-error">{item.latestJob.advisory ? 'Second opinion' : 'Assessment'} {item.latestJob.sequence} failed: {item.latestJob.error === 'source_conflict' ? 'The source changed. Reassess the current source.' : item.latestJob.error === 'provider_outcome_unknown' ? 'The provider outcome is unknown. Retrying may make another call.' : item.latestJob.error ?? 'Processing failed.'}</p>}
    {item.approvalState && <p role="status">{item.approvalState === 'pending' ? 'Approval queued; application is not yet confirmed.' : 'Approval needs attention.'}</p>}
    {item.proposal ? <div className="vocabulary-compact-review">
      <p className="vocabulary-operator-meta">Proposal revision {item.proposal.version}{!item.proposal.isCurrent ? ' · retained alternative' : ''}{['applied', 'closed'].includes(item.proposal.status) ? ` · ${item.proposal.status === 'applied' ? 'Applied' : 'Dismissed'}` : ''}</p>
      {item.proposal.rationale && item.proposal.rationale.trim() !== item.assessment?.diagnosis.trim() && <p>{item.proposal.rationale}</p>}
      {[...groups].map(([label, operations]) => <details className="vocabulary-sense-group" key={label}><summary><strong>{label}</strong> <span className="vocabulary-group-count">{operations.length} {operations.length === 1 ? 'exercise' : 'exercises'}</span></summary>{operations.map(operation => <Operation key={operation.operationKey} operation={operation} redundant={repeated} />)}</details>)}
    </div> : <p><strong>{item.needsDecision ? 'Needs a decision' : item.currentAssessment ? 'No change proposed' : 'Awaiting assessment'}</strong></p>}
    {repertoire && item.assessment?.diagnosis && <details className="vocabulary-item-details"><summary>Assessment reasoning</summary><p>{item.assessment.diagnosis}</p></details>}
    {item.advisoryOpinion && <div className="vocabulary-second-opinion" aria-label="Second opinion"><p><strong>Second opinion · job {item.advisoryOpinion.sequence}</strong></p>{item.advisoryOpinion.result ? <><p>{{ support: 'Supports this judgment', revise: 'Suggests revision', reject: 'Recommends against this judgment' }[item.advisoryOpinion.result.verdict]}</p><p>{item.advisoryOpinion.result.rationale}</p></> : <p role="status">{item.advisoryOpinion.status === 'queued' ? 'Queued' : item.advisoryOpinion.status === 'running' ? 'Reviewing…' : 'Review failed'}</p>}</div>}
    {item.requiresDetails && <p><button className="secondary-button" onClick={onDetails}>Review full content before approval</button></p>}
    {children}
  </section>;
}
