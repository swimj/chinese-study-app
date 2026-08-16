import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type {
  EffectRef,
  OperationApplicationState,
  ProposalReviewDisposition,
  ReflectionInputItemV1,
  ReflectionInputItemV2,
  ReflectionItemV3,
  ReflectionOperation,
  ReflectionQualityAnnotation,
  ReflectionQualityCritiqueReason,
  ReflectionQualitySubject,
} from '../domain/reflection';
import type { ReflectionModelChoice, ReflectionQualityStatsDto } from '../services/api';
import { ReflectionOperationEditor } from '../features/reflection/ReflectionOperationEditor';
import type { ReflectionPageController } from '../features/reflection/useReflectionPageController';
import { qualitySubjectKey } from '../features/reflection/useReflectionPageController';
import {
  buildNoDurableChangeGists,
  buildReflectionItemPresentations,
  buildLearnerRequestedReflectionPresentations,
  buildReflectionProposalPresentations,
  critiqueOptionsForSubject,
  findQualityAnnotation,
  legacyReflectionUnhandledNeeds,
  reflectionLearnerFeedback,
  cloneReflectionOperation,
  createReplacementOperation,
  getOperationDraftState,
  reflectionOperationLabel,
  formatRunDuration,
  visibleOutputTokens,
  type NoDurableChangeReflectionGist,
  type ReflectionArtifactSummaryDto,
  type ReflectionGenerationRunDto,
  type ReflectionProposalPresentation,
  type ReflectionProposalDetailDto,
  type ReflectionProposalQueueKind,
} from '../features/reflection/reflection-page-model';

type ReflectionRetryMenuOption = {
  id: string;
  label: string;
  model?: ReflectionModelChoice;
};

const REFLECTION_RETRY_MODEL_OPTIONS: ReadonlyArray<Omit<ReflectionRetryMenuOption, 'label'> & {
  label: string;
  model: ReflectionModelChoice;
}> = [
  { id: 'openai:gpt-5.6-luna-high', label: 'Luna high', model: 'openai:gpt-5.6-luna-high' },
  { id: 'zai:glm-5.2-high', label: 'GLM-5.2 high', model: 'zai:glm-5.2-high' },
  { id: 'dashscope:qwen3.8-max', label: 'Qwen3.8-Max', model: 'dashscope:qwen3.8-max' },
  { id: 'dashscope:qwen3.7-plus', label: 'Qwen3.7 Plus', model: 'dashscope:qwen3.7-plus' },
];

type ReflectionView = ReflectionProposalQueueKind | 'requests' | 'sessions' | 'usage' | 'quality';

export function ReflectionsPage({
  controller,
}: {
  controller: ReflectionPageController;
}) {
  const [view, setView] = useState<ReflectionView>('attention');
  const proposalQueues = {
    attention: buildReflectionProposalPresentations(controller.artifactDetails, 'attention'),
    deferred: buildReflectionProposalPresentations(controller.artifactDetails, 'deferred'),
    unapplied: buildReflectionProposalPresentations(controller.artifactDetails, 'unapplied'),
  };
  const learnerRequests = buildLearnerRequestedReflectionPresentations(controller.artifactDetails);
  const views: Array<{ key: ReflectionView; label: string; count?: number }> = [
    { key: 'attention', label: 'Needs attention', count: proposalQueues.attention.length },
    { key: 'deferred', label: 'Deferred', count: proposalQueues.deferred.length },
    {
      key: 'unapplied',
      label: 'Pending / unsupported',
      count: proposalQueues.unapplied.length,
    },
    { key: 'requests', label: 'Learner requests', count: learnerRequests.length },
    { key: 'sessions', label: 'By session' },
    { key: 'usage', label: 'Run meta' },
    { key: 'quality', label: 'Quality' },
  ];

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

      <nav className="priority-subtabs reflection-view-tabs" aria-label="Reflection views">
        {views.map((option) => (
          <button
            type="button"
            className={view === option.key ? 'priority-subtab active' : 'priority-subtab'}
            aria-pressed={view === option.key}
            key={option.key}
            onClick={() => setView(option.key)}
          >
            {option.label}{option.count === undefined ? '' : ` (${option.count})`}
          </button>
        ))}
      </nav>

      {controller.unreadableArtifactIds.size > 0 ? (
        <section className="panel reflection-unreadable-notice" role="status">
          <strong>
            {controller.unreadableArtifactIds.size} stored reflection
            {controller.unreadableArtifactIds.size === 1 ? '' : 's'} could not be read
          </strong>
          <p className="notes">
            They remain stored and are isolated from the readable proposal queues and history.
          </p>
        </section>
      ) : null}

      {view === 'sessions' ? (
        <SessionWorkspace controller={controller} />
      ) : view === 'usage' ? (
        <TokenUsageView
          runs={controller.generationRuns}
          retryStatus={controller.generationRetryStatus}
          onRetry={controller.retryGenerationRun}
        />
      ) : view === 'quality' ? (
        <QualityStatsView stats={controller.qualityStats} />
      ) : (
        view === 'requests' ? (
          <LearnerRequestsView requests={learnerRequests} controller={controller} />
        ) : (
        <ProposalQueueView
          kind={view}
          proposals={proposalQueues[view]}
          controller={controller}
        />
        )
      )}
    </section>
  );
}

function LearnerRequestsView({
  requests,
  controller,
}: {
  requests: ReturnType<typeof buildLearnerRequestedReflectionPresentations>;
  controller: ReflectionPageController;
}) {
  return (
    <main className="reflection-queue">
      <header className="reflection-queue-heading">
        <div>
          <h2>Learner-requested feedback</h2>
          <p className="notes">Feedback requested during study, including informational results.</p>
        </div>
      </header>
      {requests.length === 0 ? (
        <section className="panel reflection-empty-state">
          <h2>No requests yet</h2>
          <p className="notes">Marked study actions will appear here after reflection finishes.</p>
        </section>
      ) : requests.map(({ artifact, evidence, result }) => (
        <article className="panel reflection-queue-card" key={`${artifact.artifactId}:${result.itemId}`}>
          <header className="reflection-item-heading">
            <div>
              <p className="reflection-eyebrow">{formatDateTime(artifact.generatedAt)}</p>
              <h2>{itemTitle(evidence)}</h2>
            </div>
          </header>
          <EvidenceView evidence={evidence} />
          <section className="reflection-analysis"><h3>Feedback</h3><p>{reflectionLearnerFeedback(result)}</p></section>
          <QualityAnnotationControls
            subject={{ kind: 'item', artifactId: artifact.artifactId, itemId: result.itemId }}
            annotation={findQualityAnnotation(artifact.qualityAnnotations, {
              kind: 'item',
              artifactId: artifact.artifactId,
              itemId: result.itemId,
            })}
            allowMissedIntervention={result.proposals.length === 0}
            submitting={
              controller.submittingQualitySubjectKey
                === qualitySubjectKey({
                  kind: 'item',
                  artifactId: artifact.artifactId,
                  itemId: result.itemId,
                })
            }
            onUpsert={controller.upsertQuality}
            onClear={controller.clearQuality}
          />
        </article>
      ))}
    </main>
  );
}

function ProposalQueueView({
  kind,
  proposals,
  controller,
}: {
  kind: ReflectionProposalQueueKind;
  proposals: ReflectionProposalPresentation[];
  controller: ReflectionPageController;
}) {
  const copy = {
    attention: {
      title: 'Needs attention',
      empty: 'No proposals are waiting for a decision.',
    },
    deferred: {
      title: 'Deferred proposals',
      empty: 'No proposals are deferred.',
    },
    unapplied: {
      title: 'Pending / unsupported authorizations',
      empty: 'No accepted authorizations are pending or unsupported.',
    },
  }[kind];

  return (
    <main className="reflection-queue">
      <header className="reflection-queue-heading">
        <div>
          <h2>{copy.title}</h2>
          <p className="notes">
            {proposals.length} proposal{proposals.length === 1 ? '' : 's'} across recent reflections
          </p>
        </div>
      </header>
      {proposals.length === 0 ? (
        <section className="panel reflection-empty-state">
          <h2>All clear</h2>
          <p className="notes">{copy.empty}</p>
        </section>
      ) : proposals.map((presentation) => (
        <article
          className="panel reflection-queue-card"
          key={presentation.proposal.review.proposalId}
        >
          <header className="reflection-item-heading">
            <div>
              <p className="reflection-eyebrow">
                {formatDateTime(
                  presentation.artifact.evidenceBundle.session.endedAt
                    ?? presentation.artifact.generatedAt,
                )}
              </p>
              <h2>{itemTitle(presentation.evidence)}</h2>
            </div>
            <div className="reflection-tag-list">
              {presentation.result.diagnosisTags.map((tag) => (
                <span className="reflection-tag" key={tag}>{humanize(tag)}</span>
              ))}
            </div>
          </header>
          <EvidenceView evidence={presentation.evidence} />
          {presentation.result.learnerExplanation !== null ? (
            <section className="reflection-analysis">
              <p>{presentation.result.learnerExplanation}</p>
            </section>
          ) : null}
          <QualityAnnotationControls
            subject={{
              kind: 'item',
              artifactId: presentation.artifact.artifactId,
              itemId: presentation.result.itemId,
            }}
            annotation={findQualityAnnotation(presentation.artifact.qualityAnnotations, {
              kind: 'item',
              artifactId: presentation.artifact.artifactId,
              itemId: presentation.result.itemId,
            })}
            allowMissedIntervention={presentation.result.proposals.length === 0}
            submitting={
              controller.submittingQualitySubjectKey === qualitySubjectKey({
                kind: 'item',
                artifactId: presentation.artifact.artifactId,
                itemId: presentation.result.itemId,
              })
            }
            onUpsert={controller.upsertQuality}
            onClear={controller.clearQuality}
          />
          <ProposalCard
            proposal={presentation.proposal}
            evidence={presentation.evidence}
            qualityAnnotation={findQualityAnnotation(
              presentation.artifact.qualityAnnotations,
              {
                kind: 'proposal',
                proposalId: presentation.proposal.review.proposalId,
              },
            )}
            submitting={
              controller.submittingProposalId === presentation.proposal.review.proposalId
            }
            qualitySubmitting={
              controller.submittingQualitySubjectKey === qualitySubjectKey({
                kind: 'proposal',
                proposalId: presentation.proposal.review.proposalId,
              })
            }
            withdrawingInvocationId={controller.withdrawingInvocationId}
            onDefer={controller.deferProposal}
            onDismiss={controller.dismissProposal}
            onAccept={controller.acceptProposal}
            onReplace={controller.replaceProposal}
            onWithdraw={controller.withdrawAuthorization}
            onUpsertQuality={controller.upsertQuality}
            onClearQuality={controller.clearQuality}
          />
        </article>
      ))}
    </main>
  );
}

function SessionWorkspace({ controller }: { controller: ReflectionPageController }) {
  const items = controller.selectedArtifact === null
    ? []
    : buildReflectionItemPresentations(controller.selectedArtifact);
  const noDurableChangeGists = controller.selectedArtifact === null
    ? []
    : buildNoDurableChangeGists(controller.selectedArtifact, items);

  return (
    <div className="reflection-layout">
      <aside className="panel reflection-artifact-sidebar">
        <ArtifactList
          title="Open proposals"
          emptyLabel="No pending or deferred proposals."
          artifacts={controller.openArtifacts}
          selectedArtifactId={controller.selectedArtifactId}
          unreadableArtifactIds={controller.unreadableArtifactIds}
          onSelect={controller.selectArtifact}
        />
        <ArtifactList
          title="Recent history"
          emptyLabel="No reflection artifacts yet."
          artifacts={controller.recentArtifacts}
          selectedArtifactId={controller.selectedArtifactId}
          unreadableArtifactIds={controller.unreadableArtifactIds}
          onSelect={controller.selectArtifact}
        />
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
                <p className="notes reflection-long-metadata">
                  Session {controller.selectedArtifact.sourceSessionId}
                  {' · '}
                  {controller.selectedArtifact.sourceRunId === null
                    ? 'legacy run'
                    : `run ${abbreviateId(controller.selectedArtifact.sourceRunId)}`}
                  {' · '}
                  {controller.selectedArtifact.provider}/{controller.selectedArtifact.model}
                  {' · '}
                  {controller.selectedArtifact.promptVersion}
                </p>
              </div>
              <div className="reflection-header-counts">
                <span className="reflection-count-pill">
                  {controller.selectedArtifact.proposals.length} proposal
                  {controller.selectedArtifact.proposals.length === 1 ? '' : 's'}
                </span>
                {noDurableChangeGists.length === 0 ? null : (
                  <span className="reflection-count-pill reflection-count-pill-muted">
                    {noDurableChangeGists.length} no durable change
                  </span>
                )}
              </div>
            </section>

            {noDurableChangeGists.length === 0 ? null : (
              <NoDurableChangeGistPanel gists={noDurableChangeGists} controller={controller} />
            )}

            {items.map((item, itemIndex) => {
              const selectedArtifact = controller.selectedArtifact!;
              return (
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
                  <h3>Feedback</h3>
                  <p>{reflectionLearnerFeedback(item.result)}</p>
                </section>

                <QualityAnnotationControls
                  subject={{
                    kind: 'item',
                    artifactId: selectedArtifact.artifactId,
                    itemId: item.result.itemId,
                  }}
                  annotation={findQualityAnnotation(
                    selectedArtifact.qualityAnnotations,
                    {
                      kind: 'item',
                      artifactId: selectedArtifact.artifactId,
                      itemId: item.result.itemId,
                    },
                  )}
                  allowMissedIntervention={item.proposals.length === 0}
                  submitting={
                    controller.submittingQualitySubjectKey === qualitySubjectKey({
                      kind: 'item',
                      artifactId: selectedArtifact.artifactId,
                      itemId: item.result.itemId,
                    })
                  }
                  onUpsert={controller.upsertQuality}
                  onClear={controller.clearQuality}
                />

                {item.result.questions.length > 0 ? (
                  <InfoList
                    title="Questions"
                    entries={item.result.questions.map((question) => ({
                      title: question.question,
                      detail: question.reason,
                    }))}
                  />
                ) : null}

                {legacyReflectionUnhandledNeeds(item.result).length > 0 ? (
                  <InfoList
                    title="Unhandled needs"
                    entries={legacyReflectionUnhandledNeeds(item.result).map((need) => ({
                      title: need.description,
                      detail: need.whyRegisteredOperationsDoNotFit,
                    }))}
                  />
                ) : null}

                <section className="reflection-proposals-section">
                  <h3>Proposals</h3>
                  {item.proposals.length === 0 ? (
                    <p className="notes">
                      {item.result.diagnosisTags.includes('ordinary_retrieval_noise')
                        ? 'Judged as ordinary forgetting / retrieval noise; no durable change proposed.'
                        : 'Informational reflection only; no change was proposed.'}
                    </p>
                  ) : (
                    <div className="reflection-proposal-list">
                      {item.proposals.map((proposal) => (
                        <ProposalCard
                          key={proposal.review.proposalId}
                          proposal={proposal}
                          evidence={item.evidence}
                          qualityAnnotation={findQualityAnnotation(
                            selectedArtifact.qualityAnnotations,
                            {
                              kind: 'proposal',
                              proposalId: proposal.review.proposalId,
                            },
                          )}
                          submitting={
                            controller.submittingProposalId === proposal.review.proposalId
                          }
                          qualitySubmitting={
                            controller.submittingQualitySubjectKey === qualitySubjectKey({
                              kind: 'proposal',
                              proposalId: proposal.review.proposalId,
                            })
                          }
                          withdrawingInvocationId={controller.withdrawingInvocationId}
                          onDefer={controller.deferProposal}
                          onDismiss={controller.dismissProposal}
                          onAccept={controller.acceptProposal}
                          onReplace={controller.replaceProposal}
                          onWithdraw={controller.withdrawAuthorization}
                          onUpsertQuality={controller.upsertQuality}
                          onClearQuality={controller.clearQuality}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </article>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}

function NoDurableChangeGistPanel({
  gists,
  controller,
}: {
  gists: NoDurableChangeReflectionGist[];
  controller: ReflectionPageController;
}) {
  return (
    <section className="panel reflection-no-change-gist" aria-label="No durable change">
      <div className="reflection-section-heading">
        <div>
          <p className="reflection-eyebrow">Session observability</p>
          <h3>No durable change</h3>
        </div>
      </div>
      <p className="notes">
        Bundle items with empty proposal lists — often ordinary forgetting / retrieval noise,
        sometimes insufficient evidence or questions only. Full item cards remain below.
      </p>
      <ul className="reflection-no-change-list">
        {gists.map((gist) => {
          const subject: ReflectionQualitySubject = {
            kind: 'item',
            artifactId: gist.artifactId,
            itemId: gist.itemId,
          };
          const annotation = controller.selectedArtifact === null
            ? null
            : findQualityAnnotation(controller.selectedArtifact.qualityAnnotations, subject);
          return (
            <li key={gist.itemId}>
              <div className="reflection-no-change-row">
                <strong>{gist.title}</strong>
                <div className="reflection-tag-list">
                  {gist.diagnosisTags.map((tag) => (
                    <span className="reflection-tag" key={tag}>{humanize(tag)}</span>
                  ))}
                </div>
              </div>
              <p className="notes reflection-no-change-context">
                {[
                  gist.responseSummary,
                  gist.cueSummary === null ? null : `Cue: ${gist.cueSummary}`,
                  gist.questionCount === 0
                    ? null
                    : `${gist.questionCount} question${gist.questionCount === 1 ? '' : 's'}`,
                ].filter((part): part is string => part !== null).join(' · ') || 'No extra evidence summary'}
              </p>
              <p>{gist.feedback}</p>
              <QualityAnnotationControls
                subject={subject}
                annotation={annotation}
                allowMissedIntervention
                submitting={
                  controller.submittingQualitySubjectKey === qualitySubjectKey(subject)
                }
                onUpsert={controller.upsertQuality}
                onClear={controller.clearQuality}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function TokenUsageView({
  runs,
  retryStatus,
  onRetry,
}: {
  runs: ReflectionGenerationRunDto[];
  retryStatus: ReflectionPageController['generationRetryStatus'];
  onRetry: (runId: string, model?: ReflectionModelChoice) => Promise<void>;
}) {
  return (
    <main className="reflection-usage-view">
      {runs.length === 0 ? (
        <section className="panel reflection-empty-state">
          <h2>No run meta yet</h2>
          <p className="notes">No reflection generation attempts yet.</p>
        </section>
      ) : (
        <section className="panel reflection-run-table-wrap">
          <div className="reflection-run-table" role="table" aria-label="Reflection run meta">
            <div className="reflection-run-table-header" role="row">
              <span>Status</span><span>Run</span><span>Duration</span><span>Input</span><span>Cached</span>
              <span>Output</span><span>Reasoning</span><span>Visible</span>
              <span>Cost</span>
            </div>
            {runs.map((run) => (
              <div className="reflection-run-row" role="row" key={run.runId}>
                <div className="reflection-run-status">
                  <RunStatusControl
                    run={run}
                    retryStatus={retryStatus}
                    onRetry={onRetry}
                  />
                </div>
                <div className="reflection-run-identity">
                  <strong>{formatDateTime(run.completedAt)}</strong>
                  <span>{run.provider}/{run.model}</span>
                  <span>
                    {run.includedItemCount}/{run.eligibleItemCount} items
                    {run.finishReason === null ? '' : ` · finish: ${run.finishReason}`}
                    {run.failureCode === null ? '' : ` · ${humanize(run.failureCode)}`}
                  </span>
                  <span className="reflection-run-schema">
                    bundle {run.bundleSchemaVersion ?? 'unknown'}
                  </span>
                  <span className="reflection-run-schema">
                    result {run.resultSchemaVersion ?? 'unknown'}
                  </span>
                </div>
                <span>{formatRunDuration(run.startedAt, run.completedAt)}</span>
                <span>{formatTokenCount(run.usage.inputTokens)}</span>
                <span>{formatTokenCount(run.usage.cachedInputTokens)}</span>
                <span>{formatTokenCount(run.usage.outputTokens)}</span>
                <span>{formatTokenCount(run.usage.reasoningTokens)}</span>
                <span>{formatTokenCount(visibleOutputTokens(run.usage))}</span>
                <span title={run.estimatedCostUsd === null
                  ? 'Cost estimate unavailable for this run.'
                  : `Rates as of ${run.pricingAsOf}; ${run.pricingSnapshotId}`}
                >
                  {run.estimatedCostUsd === null ? '—' : formatUsd(run.estimatedCostUsd)}
                </span>
                {run.diagnostic === null ? null : <RunDiagnosticView diagnostic={run.diagnostic} />}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function RunDiagnosticView({
  diagnostic,
}: {
  diagnostic: NonNullable<ReflectionGenerationRunDto['diagnostic']>;
}) {
  return (
    <details className="reflection-run-diagnostic">
      <summary>{diagnostic.phase.replaceAll('_', ' ')} diagnostics</summary>
      {diagnostic.issues.length === 0 ? (
        <p className="notes">No structured issue detail was recorded.</p>
      ) : (
        <ul>
          {diagnostic.issues.map((issue, index) => (
            <li key={`${issue.path}-${index}`}>
              <code>{issue.path}</code> · <code>{issue.code}</code> · {issue.message}
              {issue.valueType === null ? '' : ` (value type: ${issue.valueType})`}
            </li>
          ))}
        </ul>
      )}
      {diagnostic.rejectedOutput === null ? (
        <p className="notes">Rejected output context unavailable.</p>
      ) : (
        <pre className="reflection-rejected-output">{diagnostic.rejectedOutput}</pre>
      )}
    </details>
  );
}

function RunStatusControl({
  run,
  retryStatus,
  onRetry,
}: {
  run: ReflectionGenerationRunDto;
  retryStatus: ReflectionPageController['generationRetryStatus'];
  onRetry: (runId: string, model?: ReflectionModelChoice) => Promise<void>;
}) {
  if (retryStatus?.runId === run.runId && retryStatus.state === 'generating') {
    return <span className="reflection-state-pill state-generating" role="status">Generating…</span>;
  }
  if (run.retryable) {
    return (
      <ReflectionRetryControl
        run={run}
        retryFailed={retryStatus?.runId === run.runId && retryStatus.state === 'failed'}
        onRetry={onRetry}
      />
    );
  }
  return run.state === 'succeeded'
    ? <StatusIcon kind="success" label="Reflection generation succeeded" />
    : <StatusIcon kind="failure" label="Reflection generation failed" />;
}

function ReflectionRetryControl({
  run,
  retryFailed,
  onRetry,
}: {
  run: ReflectionGenerationRunDto;
  retryFailed: boolean;
  onRetry: (runId: string, model?: ReflectionModelChoice) => Promise<void>;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const listId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options: ReflectionRetryMenuOption[] = [
    { id: 'same', label: `Same model (${run.model})` },
    ...REFLECTION_RETRY_MODEL_OPTIONS,
  ];
  const label = retryFailed
    ? 'Retry failed. Choose a model to retry this reflection.'
    : `Retry reflection${run.failureCode === null ? '' : `: ${humanize(run.failureCode)}`}. Choose a model.`;

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [menuOpen]);

  function openMenu() {
    setSelectedIndex(0);
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
    setSelectedIndex(0);
  }

  function confirmSelection(index = selectedIndex) {
    const option = options[index];
    if (option === undefined) return;
    closeMenu();
    void onRetry(run.runId, option.model);
  }

  function moveSelection(delta: number) {
    setSelectedIndex((current) => {
      const next = (current + delta + options.length) % options.length;
      return next;
    });
  }

  function handleRootKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (!menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmSelection();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  }

  return (
    <span
      ref={rootRef}
      className="reflection-retry-control"
      onKeyDown={handleRootKeyDown}
    >
      <button
        type="button"
        className="reflection-status-icon reflection-retry-button"
        title={label}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? listId : undefined}
        onClick={() => {
          if (menuOpen) closeMenu();
          else openMenu();
        }}
      >
        <span aria-hidden="true">↻</span>
      </button>
      {menuOpen ? (
        <div className="reflection-retry-menu" role="presentation">
          <p className="reflection-retry-menu-title">Retry with</p>
          <ul
            id={listId}
            className="reflection-retry-menu-list"
            role="listbox"
            aria-label="Choose model for reflection retry"
            aria-activedescendant={`${listId}-option-${selectedIndex}`}
          >
            {options.map((option, index) => {
              const selected = index === selectedIndex;
              return (
                <li key={option.id} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-option-${index}`}
                    className={
                      selected
                        ? 'reflection-retry-menu-option is-selected'
                        : 'reflection-retry-menu-option'
                    }
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => confirmSelection(index)}
                  >
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="reflection-retry-menu-hint">↑↓ to choose · Enter to run</p>
        </div>
      ) : null}
    </span>
  );
}

function StatusIcon({ kind, label }: { kind: 'success' | 'failure'; label: string }) {
  return (
    <span
      className={`reflection-status-icon status-${kind}`}
      title={label}
      aria-label={label}
      role="img"
    >
      <span aria-hidden="true">{kind === 'success' ? '✓' : '×'}</span>
    </span>
  );
}

function abbreviateId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-5)}`;
}

function ArtifactList({
  title,
  emptyLabel,
  artifacts,
  selectedArtifactId,
  unreadableArtifactIds,
  onSelect,
}: {
  title: string;
  emptyLabel: string;
  artifacts: ReflectionArtifactSummaryDto[];
  selectedArtifactId: string | null;
  unreadableArtifactIds: ReadonlySet<string>;
  onSelect: (artifactId: string) => Promise<void>;
}) {
  return (
    <section className="reflection-artifact-list">
      <h2>{title}</h2>
      {artifacts.length === 0 ? (
        <p className="notes">{emptyLabel}</p>
      ) : (
        artifacts.map((artifact) => {
          const unreadable = artifact.readState === 'unreadable'
            || unreadableArtifactIds.has(artifact.artifactId);
          return (
            <button
              type="button"
              className={
                unreadable
                  ? 'reflection-artifact-link unreadable'
                  : artifact.artifactId === selectedArtifactId
                    ? 'reflection-artifact-link active'
                    : 'reflection-artifact-link'
              }
              disabled={unreadable}
              key={artifact.artifactId}
              onClick={() => void onSelect(artifact.artifactId)}
            >
              <strong>{formatDateTime(artifact.generatedAt)}</strong>
              <span>
                {unreadable ? 'Unreadable · ' : ''}
                {artifact.readState === 'available'
                  ? `${artifact.itemCount} item${artifact.itemCount === 1 ? '' : 's'} · `
                  : ''}
                {artifact.openProposalCount} open · {artifact.proposalCount} total
              </span>
            </button>
          );
        })
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
  evidence,
  qualityAnnotation,
  submitting,
  qualitySubmitting,
  withdrawingInvocationId,
  onDefer,
  onDismiss,
  onAccept,
  onReplace,
  onWithdraw,
  onUpsertQuality,
  onClearQuality,
}: {
  proposal: ReflectionProposalDetailDto;
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null;
  qualityAnnotation: ReflectionQualityAnnotation | null;
  submitting: boolean;
  qualitySubmitting: boolean;
  withdrawingInvocationId: string | null;
  onDefer: (proposalId: string) => Promise<void>;
  onDismiss: (
    proposalId: string,
    reason: string | null,
    reasonCode: ReflectionQualityCritiqueReason,
  ) => Promise<void>;
  onAccept: (proposalId: string, operation: ReflectionOperation) => Promise<void>;
  onReplace: (proposalId: string, operation: ReflectionOperation) => Promise<void>;
  onWithdraw: (invocationId: string) => Promise<void>;
  onUpsertQuality: ReflectionPageController['upsertQuality'];
  onClearQuality: ReflectionPageController['clearQuality'];
}) {
  const original = proposal.proposal.operation;
  const [draft, setDraft] = useState(() => cloneReflectionOperation(original));
  const [dismissReason, setDismissReason] = useState('');
  const [dismissReasonCode, setDismissReasonCode] = useState<ReflectionQualityCritiqueReason | null>(
    null,
  );
  const proposalSubject: ReflectionQualitySubject = {
    kind: 'proposal',
    proposalId: proposal.review.proposalId,
  };

  useEffect(() => {
    setDraft(cloneReflectionOperation(original));
    setDismissReason('');
    setDismissReasonCode(null);
  }, [proposal.review.proposalId, proposal.review.updatedAt]);

  const draftState = getOperationDraftState(original, draft, evidence);
  const unresolved = proposal.review.disposition.kind === 'pending'
    || proposal.review.disposition.kind === 'deferred';
  const invocation = proposal.invocation;
  const dismissOptions = critiqueOptionsForSubject('proposal', false);
  const dismissBlocked = dismissReasonCode === null
    || (dismissReasonCode === 'other' && dismissReason.trim().length === 0);

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
        <ProposalDispositionStatus disposition={proposal.review.disposition} />
      </header>

      <p>{proposal.proposal.rationale}</p>
      <SupportNotice support={draftState.applySupport} />
      <QualityAnnotationControls
        subject={proposalSubject}
        annotation={qualityAnnotation}
        allowMissedIntervention={false}
        submitting={qualitySubmitting}
        onUpsert={onUpsertQuality}
        onClear={onClearQuality}
        praiseOnly={unresolved}
      />

      {unresolved ? (
        <>
          <ReflectionOperationEditor operation={draft} onChange={setDraft} />
          <label className="reflection-field">
            <span>Handle</span>
            <select
              aria-label="Handle"
              disabled={submitting}
              value={`${draft.kind}@${draft.version}`}
              onChange={(event) => {
                const [kind, versionText] = event.target.value.split('@');
                setDraft(createReplacementOperation(
                  kind as ReflectionOperation['kind'],
                  Number(versionText),
                  original,
                  evidence,
                ));
              }}
            >
              <option value="suppress_definition_production@1">Suppress definition production</option>
              <option value="create_contrast_cluster@1">Create contrast cluster (v1)</option>
              <option value="create_contrast_cluster@2">Create contrast cluster (v2)</option>
              <option value="repair_production_cue@1">Repair production cue (v1)</option>
              <option value="repair_production_cue@2">Repair production cue (v2)</option>
              <option value="accept_production_alternate@1">Accept production alternate</option>
            </select>
          </label>
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
              onClick={() => void (draftState.acceptanceMode === 'replacement'
                ? onReplace(proposal.review.proposalId, draft)
                : onAccept(proposal.review.proposalId, draft)
              ).catch(() => undefined)}
            >
              {submitting
                ? 'Saving...'
                : draftState.acceptanceMode === 'exact'
                  ? 'Accept unchanged'
                  : draftState.acceptanceMode === 'replacement'
                    ? 'Authorize replacement'
                  : 'Accept revised'}
            </button>
          </div>
          <div className="reflection-dismiss-block">
            <p className="reflection-eyebrow">Dismiss reason</p>
            <div className="reflection-quality-chips" role="group" aria-label="Dismiss critique reason">
              {dismissOptions.map((option) => (
                <button
                  type="button"
                  key={option.code}
                  className={
                    dismissReasonCode === option.code
                      ? 'reflection-quality-chip is-selected'
                      : 'reflection-quality-chip'
                  }
                  disabled={submitting}
                  onClick={() => setDismissReasonCode(option.code)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="reflection-dismiss-row">
              <input
                value={dismissReason}
                placeholder={
                  dismissReasonCode === 'other'
                    ? 'Required note for other'
                    : 'Optional dismissal note'
                }
                aria-label="Optional dismissal note"
                disabled={submitting}
                onChange={(event) => setDismissReason(event.target.value)}
              />
              <button
                type="button"
                className="danger-button"
                disabled={submitting || dismissBlocked}
                onClick={() => {
                  if (dismissReasonCode === null) return;
                  void onDismiss(
                    proposal.review.proposalId,
                    dismissReason.trim().length === 0 ? null : dismissReason.trim(),
                    dismissReasonCode,
                  ).catch(() => undefined);
                }}
              >
                Dismiss
              </button>
            </div>
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
                ) : proposal.review.disposition.kind === 'superseded'
                    && proposal.review.disposition.supersession.source === 'user_replacement' ? (
                      <>
                        <h5>Authorized replacement</h5>
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

function QualityAnnotationControls({
  subject,
  annotation,
  allowMissedIntervention,
  submitting,
  onUpsert,
  onClear,
  praiseOnly = false,
}: {
  subject: ReflectionQualitySubject;
  annotation: ReflectionQualityAnnotation | null;
  allowMissedIntervention: boolean;
  submitting: boolean;
  onUpsert: ReflectionPageController['upsertQuality'];
  onClear: ReflectionPageController['clearQuality'];
  praiseOnly?: boolean;
}) {
  const [note, setNote] = useState(annotation?.note ?? '');
  useEffect(() => {
    setNote(annotation?.note ?? '');
  }, [annotation?.annotationId, annotation?.note, annotation?.updatedAt]);

  const options = critiqueOptionsForSubject(subject.kind, allowMissedIntervention);
  const praised = annotation?.polarity === 'praise';
  const critiqueCode = annotation?.polarity === 'critique' ? annotation.reasonCode : null;

  return (
    <section className="reflection-quality-controls" aria-label="Quality vibe">
      <div className="reflection-quality-row">
        <button
          type="button"
          className={praised ? 'reflection-quality-chip is-praise is-selected' : 'reflection-quality-chip is-praise'}
          disabled={submitting}
          onClick={() => {
            if (praised) {
              void onClear(subject).catch(() => undefined);
              return;
            }
            void onUpsert({ subject, polarity: 'praise' }).catch(() => undefined);
          }}
        >
          {praised ? 'Liked' : 'I really like this'}
        </button>
        {annotation !== null ? (
          <button
            type="button"
            className="secondary-button reflection-quality-clear"
            disabled={submitting}
            onClick={() => void onClear(subject).catch(() => undefined)}
          >
            Clear
          </button>
        ) : null}
      </div>
      {praiseOnly ? null : (
        <>
          <div className="reflection-quality-chips" role="group" aria-label="Critique reasons">
            {options.map((option) => (
              <button
                type="button"
                key={option.code}
                className={
                  critiqueCode === option.code
                    ? 'reflection-quality-chip is-critique is-selected'
                    : 'reflection-quality-chip is-critique'
                }
                disabled={submitting}
                onClick={() => {
                  if (option.code === 'other' && note.trim().length === 0) {
                    return;
                  }
                  void onUpsert({
                    subject,
                    polarity: 'critique',
                    reasonCode: option.code,
                    note: note.trim().length === 0 ? null : note.trim(),
                  }).catch(() => undefined);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            className="reflection-quality-note"
            value={note}
            placeholder="Optional note (required for Other)"
            aria-label="Quality note"
            disabled={submitting}
            onChange={(event) => setNote(event.target.value)}
          />
        </>
      )}
    </section>
  );
}

function QualityStatsView({ stats }: { stats: ReflectionQualityStatsDto | null }) {
  if (stats === null) {
    return (
      <main className="reflection-quality-view">
        <section className="panel reflection-empty-state">
          <h2>Quality vibe</h2>
          <p className="notes">Loading model-arm rates…</p>
        </section>
      </main>
    );
  }
  if (stats.arms.length === 0) {
    return (
      <main className="reflection-quality-view">
        <section className="panel reflection-empty-state">
          <h2>No quality signal yet</h2>
          <p className="notes">
            Accept, dismiss, praise, and critique proposals or items while reviewing to accumulate
            rates by model arm.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="reflection-quality-view">
      <section className="panel">
        <header className="reflection-queue-heading">
          <div>
            <h2>Model-arm quality vibe</h2>
            <p className="notes">
              Terminal user reviews plus praise/critique overlays. Pending, deferred, and system
              supersession are excluded. Small counts are not statistical claims.
            </p>
          </div>
        </header>
        <div className="reflection-quality-table" role="table" aria-label="Quality by model arm">
          <div className="reflection-quality-table-header" role="row">
            <span>Model arm</span>
            <span>Prompt</span>
            <span>Terminal</span>
            <span>Exact</span>
            <span>Revised</span>
            <span>Replace</span>
            <span>Dismiss</span>
            <span>Praise</span>
            <span>Missed</span>
          </div>
          {stats.arms.map((arm) => (
            <div
              className="reflection-quality-table-row"
              role="row"
              key={`${arm.modelArm}:${arm.promptVersion}`}
            >
              <strong>{arm.modelArm}</strong>
              <span>{arm.promptVersion}</span>
              <span>{arm.terminalReviewCount}</span>
              <span>{formatRate(arm.exactAcceptCount, arm.terminalReviewCount)}</span>
              <span>{formatRate(arm.revisedAcceptCount, arm.terminalReviewCount)}</span>
              <span>{formatRate(arm.userReplaceCount, arm.terminalReviewCount)}</span>
              <span title={formatDismissalTitle(arm.dismissalReasons)}>
                {formatRate(arm.dismissCount, arm.terminalReviewCount)}
              </span>
              <span>
                {arm.praiseCount}
                {arm.annotatedSubjectCount === 0
                  ? ''
                  : ` (${Math.round((arm.praiseCount / arm.annotatedSubjectCount) * 100)}%)`}
              </span>
              <span>{arm.missedInterventionCount}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function formatRate(count: number, total: number): string {
  if (total === 0) return '0';
  return `${count} (${Math.round((count / total) * 100)}%)`;
}

function formatDismissalTitle(
  reasons: ReflectionQualityStatsDto['arms'][number]['dismissalReasons'],
): string {
  return Object.entries(reasons)
    .filter(([, count]) => count > 0)
    .map(([code, count]) => `${humanize(code)}: ${count}`)
    .join(' · ') || 'No dismissals';
}

function ProposalDispositionStatus({
  disposition,
}: {
  disposition: ProposalReviewDisposition;
}) {
  switch (disposition.kind) {
    case 'accepted':
      return <StatusIcon kind="success" label={`Accepted ${disposition.acceptanceMode}`} />;
    case 'dismissed':
      return <StatusIcon kind="failure" label="Dismissed" />;
    case 'pending':
    case 'deferred':
    case 'superseded':
      return (
        <span className={`reflection-state-pill state-${disposition.kind}`}>
          {humanize(disposition.kind)}
        </span>
      );
  }
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

function EvidenceView({
  evidence,
}: {
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null;
}) {
  if (evidence === null) {
    return (
      <section className="reflection-evidence">
        <h3>Evidence</h3>
        <p className="notes">The evidence item could not be reconstructed for display.</p>
      </section>
    );
  }

  if (evidence.source === 'production_mistake') {
    const servedCues = 'servedCue' in evidence
      ? [evidence.servedCue]
      : evidence.cuesAsShown;
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
            {servedCues.map((cue, index) => (
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

function itemTitle(evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null): string {
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
