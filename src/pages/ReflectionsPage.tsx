import { useEffect, useState } from 'react';
import type {
  EffectRef,
  OperationApplicationState,
  ProposalReviewDisposition,
  ReflectionInputItemV1,
  ReflectionOperation,
} from '../domain/reflection';
import { ReflectionOperationEditor } from '../features/reflection/ReflectionOperationEditor';
import type { ReflectionPageController } from '../features/reflection/useReflectionPageController';
import {
  buildReflectionItemPresentations,
  cloneReflectionOperation,
  getOperationDraftState,
  reflectionOperationLabel,
  type ReflectionArtifactSummaryDto,
  type ReflectionGenerationRunDto,
  type ReflectionProposalDetailDto,
} from '../features/reflection/reflection-page-model';

export function ReflectionsPage({
  controller,
}: {
  controller: ReflectionPageController;
}) {
  const items = controller.selectedArtifact === null
    ? []
    : buildReflectionItemPresentations(controller.selectedArtifact);

  return (
    <section className="reflections-page">
      <header className="header">
        <div>
          <h1 className="title">Reflections</h1>
          <p className="subtitle">
            Review proposed changes one at a time. Nothing is authorized by generation alone.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={controller.isLoading}
          onClick={() => void controller.refresh()}
        >
          {controller.isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <div className="reflection-layout">
        <aside className="panel reflection-artifact-sidebar">
          <ArtifactList
            title="Open proposals"
            emptyLabel="No pending or deferred proposals."
            artifacts={controller.openArtifacts}
            selectedArtifactId={controller.selectedArtifactId}
            onSelect={controller.selectArtifact}
          />
          <ArtifactList
            title="Recent history"
            emptyLabel="No reflection artifacts yet."
            artifacts={controller.recentArtifacts}
            selectedArtifactId={controller.selectedArtifactId}
            onSelect={controller.selectArtifact}
          />
          <ReflectionRunLog runs={controller.generationRuns} />
        </aside>

        <main className="reflection-detail">
          {controller.selectedArtifact === null ? (
            <div className="panel reflection-empty-state">
              <h2>No reflection selected</h2>
              <p className="notes">
                Completed-session reflections, including informational results without proposals,
                will appear in recent history.
              </p>
            </div>
          ) : (
            <>
              <section className="panel reflection-artifact-header">
                <div>
                  <p className="reflection-eyebrow">Source session</p>
                  <h2>{formatDateTime(
                    controller.selectedArtifact.evidenceBundle.session.endedAt
                      ?? controller.selectedArtifact.generatedAt,
                  )}</h2>
                  <p className="notes">
                    Session {controller.selectedArtifact.sourceSessionId}
                    {' · '}
                    {controller.selectedArtifact.provider}/{controller.selectedArtifact.model}
                    {' · '}
                    {controller.selectedArtifact.promptVersion}
                  </p>
                </div>
                <span className="reflection-count-pill">
                  {controller.selectedArtifact.proposals.length} proposal
                  {controller.selectedArtifact.proposals.length === 1 ? '' : 's'}
                </span>
              </section>

              {items.map((item, itemIndex) => (
                <article className="panel reflection-item-card" key={item.result.itemId}>
                  <header className="reflection-item-heading">
                    <div>
                      <p className="reflection-eyebrow">Reflection item {itemIndex + 1}</p>
                      <h2>{itemTitle(item.evidence)}</h2>
                    </div>
                    <div className="reflection-tag-list">
                      {item.result.diagnosisTags.map((tag) => (
                        <span className="reflection-tag" key={tag}>{humanize(tag)}</span>
                      ))}
                    </div>
                  </header>

                  <EvidenceView evidence={item.evidence} />

                  <section className="reflection-analysis">
                    <h3>Observation</h3>
                    <p>{item.result.observation}</p>
                    {item.result.learnerExplanation !== null ? (
                      <>
                        <h3>Learner-facing explanation</h3>
                        <p>{item.result.learnerExplanation}</p>
                      </>
                    ) : null}
                  </section>

                  {item.result.questions.length > 0 ? (
                    <InfoList
                      title="Questions"
                      entries={item.result.questions.map((question) => ({
                        title: question.question,
                        detail: question.reason,
                      }))}
                    />
                  ) : null}

                  {item.result.unhandledNeeds.length > 0 ? (
                    <InfoList
                      title="Unhandled needs"
                      entries={item.result.unhandledNeeds.map((need) => ({
                        title: need.description,
                        detail: need.whyRegisteredOperationsDoNotFit,
                      }))}
                    />
                  ) : null}

                  <section className="reflection-proposals-section">
                    <h3>Proposals</h3>
                    {item.proposals.length === 0 ? (
                      <p className="notes">
                        Informational reflection only; no change was proposed.
                      </p>
                    ) : (
                      <div className="reflection-proposal-list">
                        {item.proposals.map((proposal) => (
                          <ProposalCard
                            key={proposal.review.proposalId}
                            proposal={proposal}
                            submitting={
                              controller.submittingProposalId === proposal.review.proposalId
                            }
                            withdrawingInvocationId={controller.withdrawingInvocationId}
                            onDefer={controller.deferProposal}
                            onDismiss={controller.dismissProposal}
                            onAccept={controller.acceptProposal}
                            onWithdraw={controller.withdrawAuthorization}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </article>
              ))}
            </>
          )}
        </main>
      </div>
    </section>
  );
}

function ReflectionRunLog({
  runs,
}: {
  runs: ReflectionGenerationRunDto[];
}) {
  return (
    <section className="reflection-artifact-list">
      <h2>Reflection runs</h2>
      {runs.length === 0 ? (
        <p className="notes">No reflection generation attempts yet.</p>
      ) : (
        runs.map((run) => (
          <article className="reflection-proposal-card" key={run.runId}>
            <header className="reflection-proposal-heading">
              <div>
                <p className="reflection-eyebrow">{formatDateTime(run.completedAt)}</p>
                <h4>{run.provider}/{run.model}</h4>
              </div>
              <span className={`reflection-state-pill state-${run.state}`}>
                {humanize(run.state)}
              </span>
            </header>
            <p className="notes">
              {run.includedItemCount}/{run.eligibleItemCount} eligible item
              {run.eligibleItemCount === 1 ? '' : 's'} included
              {run.finishReason === null ? '' : ` · finish: ${run.finishReason}`}
              {run.failureCode === null ? '' : ` · ${humanize(run.failureCode)}`}
            </p>
            <p className="notes">
              Input {formatTokenCount(run.usage.inputTokens)}
              {' · '}cached {formatTokenCount(run.usage.cachedInputTokens)}
              {' · '}cache write {formatTokenCount(run.usage.cacheWriteInputTokens)}
              {' · '}output {formatTokenCount(run.usage.outputTokens)}
              {' · '}reasoning {formatTokenCount(run.usage.reasoningTokens)}
              {' · '}total {formatTokenCount(run.usage.totalTokens)}
            </p>
            <p className="notes">
              {run.estimatedCostUsd === null
                ? 'Cost estimate unavailable for this run.'
                : `Estimated cost: ${formatUsd(run.estimatedCostUsd)} (rates as of ${run.pricingAsOf}; ${run.pricingSnapshotId})`}
              {run.responseId === null ? '' : ` · response ${run.responseId}`}
            </p>
          </article>
        ))
      )}
    </section>
  );
}

function ArtifactList({
  title,
  emptyLabel,
  artifacts,
  selectedArtifactId,
  onSelect,
}: {
  title: string;
  emptyLabel: string;
  artifacts: ReflectionArtifactSummaryDto[];
  selectedArtifactId: string | null;
  onSelect: (artifactId: string) => Promise<void>;
}) {
  return (
    <section className="reflection-artifact-list">
      <h2>{title}</h2>
      {artifacts.length === 0 ? (
        <p className="notes">{emptyLabel}</p>
      ) : (
        artifacts.map((artifact) => (
          <button
            type="button"
            className={
              artifact.artifactId === selectedArtifactId
                ? 'reflection-artifact-link active'
                : 'reflection-artifact-link'
            }
            key={artifact.artifactId}
            onClick={() => void onSelect(artifact.artifactId)}
          >
            <strong>{formatDateTime(artifact.generatedAt)}</strong>
            <span>
              {artifact.openProposalCount} open · {artifact.proposalCount} total
            </span>
          </button>
        ))
      )}
    </section>
  );
}

function formatTokenCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value < 0.01 ? 5 : 2)}`;
}

function ProposalCard({
  proposal,
  submitting,
  withdrawingInvocationId,
  onDefer,
  onDismiss,
  onAccept,
  onWithdraw,
}: {
  proposal: ReflectionProposalDetailDto;
  submitting: boolean;
  withdrawingInvocationId: string | null;
  onDefer: (proposalId: string) => Promise<void>;
  onDismiss: (proposalId: string, reason: string | null) => Promise<void>;
  onAccept: (proposalId: string, operation: ReflectionOperation) => Promise<void>;
  onWithdraw: (invocationId: string) => Promise<void>;
}) {
  const original = proposal.proposal.operation;
  const [draft, setDraft] = useState(() => cloneReflectionOperation(original));
  const [dismissReason, setDismissReason] = useState('');

  useEffect(() => {
    setDraft(cloneReflectionOperation(original));
    setDismissReason('');
  }, [proposal.review.proposalId, proposal.review.updatedAt]);

  const draftState = getOperationDraftState(original, draft);
  const unresolved = proposal.review.disposition.kind === 'pending'
    || proposal.review.disposition.kind === 'deferred';
  const invocation = proposal.invocation;

  return (
    <article className="reflection-proposal-card">
      <header className="reflection-proposal-heading">
        <div>
          <p className="reflection-eyebrow">
            {proposal.proposal.proposalGroupKey === null
              ? `Proposal ${proposal.proposalIndex + 1}`
              : `Group ${proposal.proposal.proposalGroupKey}`}
          </p>
          <h4>{reflectionOperationLabel(original)}</h4>
        </div>
        <span className={`reflection-state-pill state-${proposal.review.disposition.kind}`}>
          {humanize(proposal.review.disposition.kind)}
        </span>
      </header>

      <p>{proposal.proposal.rationale}</p>
      <SupportNotice support={draftState.applySupport} />

      {unresolved ? (
        <>
          <ReflectionOperationEditor operation={draft} onChange={setDraft} />
          {draftState.validationErrors.length > 0 ? (
            <div className="reflection-validation" role="alert">
              <strong>Fix before accepting:</strong>
              <ul>
                {draftState.validationErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="reflection-review-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={submitting || draftState.acceptanceMode === 'exact'}
              onClick={() => setDraft(cloneReflectionOperation(original))}
            >
              Reset edits
            </button>
            {proposal.review.disposition.kind === 'pending' ? (
              <button
                type="button"
                className="secondary-button"
                disabled={submitting}
                onClick={() => void onDefer(proposal.review.proposalId).catch(() => undefined)}
              >
                Defer
              </button>
            ) : null}
            <button
              type="button"
              disabled={submitting || draftState.validationErrors.length > 0}
              onClick={() => void onAccept(
                proposal.review.proposalId,
                draft,
              ).catch(() => undefined)}
            >
              {submitting
                ? 'Saving...'
                : draftState.acceptanceMode === 'exact'
                  ? 'Accept unchanged'
                  : 'Accept revised'}
            </button>
          </div>
          <div className="reflection-dismiss-row">
            <input
              value={dismissReason}
              placeholder="Optional dismissal reason"
              aria-label="Optional dismissal reason"
              disabled={submitting}
              onChange={(event) => setDismissReason(event.target.value)}
            />
            <button
              type="button"
              className="danger-button"
              disabled={submitting}
              onClick={() => void onDismiss(
                  proposal.review.proposalId,
                  dismissReason.trim().length === 0 ? null : dismissReason.trim(),
                ).catch(() => undefined)}
            >
              Dismiss
            </button>
          </div>
        </>
      ) : (
        <>
          <h5>Original operation</h5>
          <ReflectionOperationEditor operation={original} disabled />
          <ReviewOutcome disposition={proposal.review.disposition} />
          {invocation !== null ? (
            <>
              {proposal.review.disposition.kind === 'accepted'
                && proposal.review.disposition.acceptanceMode === 'revised' ? (
                  <>
                    <h5>Authorized revision</h5>
                    <ReflectionOperationEditor
                      operation={invocation.invocation.operation}
                      disabled
                    />
                  </>
                ) : null}
              <ApplicationOutcome state={invocation.application.state} />
              {invocation.application.state.kind === 'unsupported'
                || invocation.application.state.kind === 'pending' ? (
                  <button
                    type="button"
                    className="danger-button"
                    disabled={
                      withdrawingInvocationId === invocation.invocation.invocationId
                    }
                    onClick={() => void onWithdraw(
                      invocation.invocation.invocationId,
                    ).catch(() => undefined)}
                  >
                    {withdrawingInvocationId === invocation.invocation.invocationId
                      ? 'Withdrawing...'
                      : 'Withdraw authorization'}
                  </button>
                ) : null}
            </>
          ) : null}
        </>
      )}
    </article>
  );
}

function SupportNotice({ support }: { support: 'supported' | 'unsupported' }) {
  return support === 'supported' ? (
    <div className="reflection-support supported">
      Supported now. Acceptance starts application immediately.
    </div>
  ) : (
    <div className="reflection-support unsupported">
      Unsupported now. Acceptance records standing authorization for this exact operation but
      changes no study or content state. You can withdraw it before an adapter becomes available.
    </div>
  );
}

function ReviewOutcome({ disposition }: { disposition: ProposalReviewDisposition }) {
  switch (disposition.kind) {
    case 'pending':
    case 'deferred':
      return null;
    case 'accepted':
      return (
        <p className="reflection-outcome">
          Accepted {disposition.acceptanceMode}; invocation{' '}
          <code>{disposition.acceptedInvocationId}</code>.
        </p>
      );
    case 'dismissed':
      return (
        <p className="reflection-outcome">
          Dismissed{disposition.reason === null ? '.' : `: ${disposition.reason}`}
        </p>
      );
    case 'superseded':
      return (
        <div className="reflection-outcome">
          <p>Superseded: {disposition.supersession.reason}</p>
          <EffectRefs
            label="Satisfying references"
            refs={disposition.supersession.satisfyingEffectRefs}
          />
        </div>
      );
  }
}

function ApplicationOutcome({ state }: { state: OperationApplicationState }) {
  switch (state.kind) {
    case 'unsupported':
      return <p className="reflection-outcome">Application unsupported: {state.reason}</p>;
    case 'pending':
      return <p className="reflection-outcome">Application is pending.</p>;
    case 'applied':
      return (
        <div className="reflection-outcome">
          <p>Applied {formatDateTime(state.appliedAt)}.</p>
          <EffectRefs label="Caused effects" refs={state.effectRefs} />
        </div>
      );
    case 'failed':
      return <p className="reflection-outcome">Application failed: {state.error}</p>;
    case 'stale':
      return <p className="reflection-outcome">Application became stale: {state.reason}</p>;
    case 'already_satisfied':
      return (
        <div className="reflection-outcome">
          <p>The exact postcondition was already satisfied elsewhere.</p>
          <EffectRefs label="Satisfying references" refs={state.satisfyingEffectRefs} />
        </div>
      );
    case 'authorization_withdrawn':
      return <p className="reflection-outcome">Authorization was withdrawn before an effect.</p>;
  }
}

function EffectRefs({ label, refs }: { label: string; refs: EffectRef[] }) {
  if (refs.length === 0) {
    return null;
  }
  return (
    <>
      <strong>{label}</strong>
      <ul className="reflection-reference-list">
        {refs.map((ref) => <li key={`${ref.type}:${ref.id}`}>{ref.type}: {ref.id}</li>)}
      </ul>
    </>
  );
}

function EvidenceView({ evidence }: { evidence: ReflectionInputItemV1 | null }) {
  if (evidence === null) {
    return (
      <section className="reflection-evidence">
        <h3>Evidence</h3>
        <p className="notes">The evidence item could not be reconstructed for display.</p>
      </section>
    );
  }

  if (evidence.source === 'production_mistake') {
    return (
      <section className="reflection-evidence">
        <h3>Evidence</h3>
        <dl className="reflection-evidence-grid">
          <EvidenceFact label="Target" value={wordLabel(evidence.targetWord)} />
          <EvidenceFact label="Typed response" value={evidence.rawResponse ?? 'No response'} />
          <EvidenceFact
            label="Matched word"
            value={evidence.submittedWord === null ? 'Unmatched' : wordLabel(evidence.submittedWord)}
          />
        </dl>
        <div className="reflection-evidence-notes">
          <strong>Cues as shown</strong>
          <ul>
            {evidence.cuesAsShown.map((cue, index) => (
              <li key={`${cue.cueId ?? 'snapshot'}-${index}`}>{cue.text}</li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  if (evidence.source === 'contrast_selection') {
    return (
      <section className="reflection-evidence">
        <h3>Evidence</h3>
        <p>{evidence.promptAsShown.promptText}</p>
        <p className="notes">
          Target: {wordLabel(evidence.targetWord)}
          {' · '}
          Signal: {evidence.reflectionSignal === null ? 'none' : humanize(evidence.reflectionSignal)}
        </p>
      </section>
    );
  }

  return (
    <section className="reflection-evidence">
      <h3>Evidence</h3>
      <p>{evidence.sessionNote ?? 'Session note'}</p>
      {evidence.relatedWords.length > 0 ? (
        <p className="notes">Related: {evidence.relatedWords.map(wordLabel).join(', ')}</p>
      ) : null}
    </section>
  );
}

function EvidenceFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function InfoList({
  title,
  entries,
}: {
  title: string;
  entries: Array<{ title: string; detail: string }>;
}) {
  return (
    <section className="reflection-info-list">
      <h3>{title}</h3>
      {entries.map((entry, index) => (
        <div className="reflection-info-card" key={`${entry.title}-${index}`}>
          <strong>{entry.title}</strong>
          <p>{entry.detail}</p>
        </div>
      ))}
    </section>
  );
}

function itemTitle(evidence: ReflectionInputItemV1 | null): string {
  if (evidence?.targetWord !== null && evidence?.targetWord !== undefined) {
    return wordLabel(evidence.targetWord);
  }
  return evidence?.source === 'session_note' ? 'Session note' : 'Reflection evidence';
}

function wordLabel(word: { hanzi: string; pinyin: string }): string {
  return `${word.hanzi} · ${word.pinyin}`;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
