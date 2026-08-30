import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type {
  EffectRef,
  OperationApplicationState,
  ProposalReviewDisposition,
  ReflectionInputItemV1,
  ReflectionInputItemV2,
  ReflectionItemV3,
  ReflectionOperation,
  ReflectionQualityItemTags,
  ReflectionQualityTag,
} from '../domain/reflection';
import { CURRENT_REFLECTION_PROMPT_VERSION } from '../domain/reflection';
import type { ReflectionModelChoice, ReflectionQualityStatsDto } from '../services/api';
import { ReflectionOperationEditor } from '../features/reflection/ReflectionOperationEditor';
import type { ReflectionPageController } from '../features/reflection/useReflectionPageController';
import { qualityItemKey } from '../features/reflection/useReflectionPageController';
import {
  buildNoDurableChangeGists,
  buildReflectionItemPresentations,
  buildReflectionProposalPresentations,
  buildReflectionHelpCards,
  findQualityItemTags,
  listQualityPromptVersions,
  presentQualityStatsArms,
  REFLECTION_QUALITY_TAG_OPTIONS,
  legacyReflectionUnhandledNeeds,
  reflectionLearnerFeedback,
  cloneReflectionOperation,
  createManualOperation,
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
  type ReflectionHelpCard,
} from '../features/reflection/reflection-page-model';

type ReflectionRetryMenuOption = {
  id: string;
  label: string;
  model?: ReflectionModelChoice;
  disabled?: boolean;
};

const REFLECTION_HANDLE_OPTIONS = [
  { value: 'suppress_definition_production@1', label: 'Suppress definition production' },
  { value: 'create_contrast_cluster@1', label: 'Create contrast cluster (v1)' },
  { value: 'create_contrast_cluster@2', label: 'Create contrast cluster (v2)' },
  { value: 'repair_production_cue@1', label: 'Repair production cue (v1)' },
  { value: 'repair_production_cue@2', label: 'Repair production cue (v2)' },
  { value: 'accept_production_alternate@1', label: 'Accept production alternate' },
] as const;

const REFLECTION_RETRY_MODEL_OPTIONS: ReadonlyArray<Omit<ReflectionRetryMenuOption, 'label'> & {
  label: string;
  model: ReflectionModelChoice;
}> = [
  { id: 'openai:gpt-5.6-luna-high', label: 'Luna high', model: 'openai:gpt-5.6-luna-high' },
  { id: 'zai:glm-5.3-high', label: 'GLM-5.3 high', model: 'zai:glm-5.3-high' },
  { id: 'openrouter:gemini-3.6-flash', label: 'Gemini 3.6 Flash', model: 'openrouter:gemini-3.6-flash' },
  { id: 'openrouter:claude-sonnet-5', label: 'Claude Sonnet 5', model: 'openrouter:claude-sonnet-5' },
  { id: 'openai:gpt-5.6-terra-high', label: 'GPT-5.6 Terra high', model: 'openai:gpt-5.6-terra-high' },
];

function sourceModelIsCurrentlyAvailable(storedModel: string): boolean {
  return REFLECTION_RETRY_MODEL_OPTIONS.some((option) => option.model.endsWith(`:${storedModel}`));
}

type ReflectionView = 'help' | 'deferred' | 'sessions' | 'usage' | 'quality';

export function ReflectionsPage({
  controller,
}: {
  controller: ReflectionPageController;
}) {
  const [view, setView] = useState<ReflectionView>('help');
  const helpCards = buildReflectionHelpCards(controller.artifactDetails);
  const deferredProposals = buildReflectionProposalPresentations(controller.artifactDetails);
  const views: Array<{ key: ReflectionView; label: string; count?: number }> = [
    { key: 'help', label: 'Help', count: helpCards.length },
    { key: 'deferred', label: 'Deferred', count: deferredProposals.length },
    { key: 'sessions', label: 'By session' },
    { key: 'usage', label: 'Run meta' },
    { key: 'quality', label: 'Quality' },
  ];

  return (
    <section className="reflections-page">
      <nav className="reflection-view-rail" aria-label="Reflection views">
        {views.map((option) => (
          <button
            type="button"
            className={view === option.key ? 'reflection-view-rail-tab active' : 'reflection-view-rail-tab'}
            aria-current={view === option.key ? 'page' : undefined}
            aria-pressed={view === option.key}
            key={option.key}
            onClick={() => setView(option.key)}
          >
            <span>{option.label}</span>
            {option.count === undefined ? null : (
              <span className="reflection-view-rail-count">{option.count}</span>
            )}
          </button>
        ))}
        <button
          type="button"
          className="secondary-button reflection-view-rail-refresh"
          disabled={controller.isLoading}
          onClick={() => void controller.refresh()}
        >
          {controller.isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </nav>

      <div className="reflections-page-main">
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
        ) : view === 'help' ? (
          <HelpQueueView cards={helpCards} controller={controller} />
        ) : (
          <ProposalQueueView
            proposals={deferredProposals}
            controller={controller}
          />
        )}
      </div>
    </section>
  );
}

function HelpQueueView({
  cards,
  controller,
}: {
  cards: ReflectionHelpCard[];
  controller: ReflectionPageController;
}) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const safeIndex = cards.length === 0 ? 0 : Math.min(index, cards.length - 1);
  const card = cards[safeIndex] ?? null;
  const cardKey = card?.cardKey ?? 'empty';

  useEffect(() => {
    setIndex((current) => (cards.length === 0 ? 0 : Math.min(current, cards.length - 1)));
  }, [cards.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [cardKey, safeIndex]);

  if (cards.length === 0) {
    return (
      <main className="reflection-help-shell is-empty">
        <section className="panel reflection-empty-state">
          <p className="notes">
            No remaining session help to review. Explanation-only cards you marked Done stay in By session.
          </p>
        </section>
      </main>
    );
  }

  if (card === null) {
    throw new Error('Invariant violated: help queue has cards but no current card.');
  }

  const sessionDate = formatCompactDateTime(
    card.artifact.evidenceBundle.session.endedAt ?? card.artifact.generatedAt,
  );

  return (
    <main className="reflection-help-shell">
      <header className="reflection-help-chrome">
        <div className="reflection-help-pager">
          <button
            type="button"
            className="secondary-button reflection-help-pager-button"
            disabled={safeIndex === 0}
            aria-label="Previous help card"
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
          >
            ‹
          </button>
          <span className="reflection-help-pager-index" aria-live="polite">
            {safeIndex + 1} / {cards.length}
          </span>
          <button
            type="button"
            className="secondary-button reflection-help-pager-button"
            disabled={safeIndex >= cards.length - 1}
            aria-label="Next help card"
            onClick={() => setIndex((current) => Math.min(cards.length - 1, current + 1))}
          >
            ›
          </button>
        </div>
        <div className="reflection-help-chrome-meta">
          <ItemIdentityHeading evidence={card.evidence} />
          <p className="notes">{sessionDate}</p>
        </div>
      </header>
      {card.kind === 'explanation' ? (
        <HelpExplanationCard
          key={card.cardKey}
          card={card}
          controller={controller}
          scrollRef={scrollRef}
        />
      ) : (
        <HelpProposalCard
          key={card.cardKey}
          card={card}
          controller={controller}
          scrollRef={scrollRef}
        />
      )}
    </main>
  );
}

function HelpExplanationCard({
  card,
  controller,
  scrollRef,
}: {
  card: Extract<ReflectionHelpCard, { kind: 'explanation' }>;
  controller: ReflectionPageController;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const [draft, setDraft] = useState<ReflectionOperation | null>(null);
  const submitting = controller.submittingHelpInboxItemKey === qualityItemKey(
    card.artifact.artifactId,
    card.result.itemId,
  );
  const draftState = draft === null
    ? null
    : getOperationDraftState(draft, draft, card.evidence);

  return (
    <>
      <div className="reflection-help-scroll" ref={scrollRef}>
        <EvidenceView evidence={card.evidence} />
        <section className="reflection-analysis">
          <h3>Feedback</h3>
          <p>{reflectionLearnerFeedback(card.result)}</p>
        </section>
        {card.result.questions.length > 0 ? (
          <InfoList
            title="Questions"
            entries={card.result.questions.map((question) => ({
              title: question.question,
              detail: question.reason,
            }))}
          />
        ) : null}
        {draftState?.applySupport === 'unsupported' ? <SupportNotice /> : null}
        {draft !== null ? (
          <ReflectionOperationEditor
            operation={draft}
            evidence={card.evidence}
            onChange={setDraft}
          />
        ) : null}
      </div>
      <div className="reflection-help-footer">
        <div className="reflection-help-quality">
          <ItemQualityTagControls
            artifactId={card.artifact.artifactId}
            itemId={card.result.itemId}
            annotation={findQualityItemTags(
              card.artifact.qualityItemTags,
              card.artifact.artifactId,
              card.result.itemId,
            )}
            submitting={
              controller.submittingQualityItemKey
                === qualityItemKey(card.artifact.artifactId, card.result.itemId)
            }
            onUpsert={controller.upsertQuality}
            onClear={controller.clearQuality}
          />
        </div>
        {draftState !== null && draftState.validationErrors.length > 0 ? (
          <div className="reflection-validation" role="alert">
            <strong>Fix before accepting:</strong>
            <ul>
              {draftState.validationErrors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </div>
        ) : null}
        <HelpReviewToolbar
          submitting={submitting}
          handleValue={draft === null ? '' : `${draft.kind}@${draft.version}`}
          handleDisabled={submitting}
          onHandleChange={(value) => {
            const [kind, versionText] = value.split('@');
            setDraft(createManualOperation(
              kind as ReflectionOperation['kind'],
              Number(versionText),
              card.evidence,
            ));
          }}
          resetDisabled={submitting || draft === null}
          onReset={() => setDraft(null)}
          deferDisabled
          onDefer={() => undefined}
          acceptDisabled={
            submitting
            || (draftState !== null && draftState.validationErrors.length > 0)
          }
          acceptLabel={submitting ? 'Saving...' : 'Accept'}
          onAccept={() => {
            if (draft === null) {
              void controller.markHelpInboxDone({
                artifactId: card.artifact.artifactId,
                itemId: card.result.itemId,
              }).catch(() => undefined);
              return;
            }
            void controller.authorizeManualOperation({
              artifactId: card.artifact.artifactId,
              itemId: card.result.itemId,
              operation: draft,
            }).catch(() => undefined);
          }}
          dismissDisabled={submitting || draft === null}
          onDismiss={() => {
            void controller.markHelpInboxDone({
              artifactId: card.artifact.artifactId,
              itemId: card.result.itemId,
            }).catch(() => undefined);
          }}
        />
      </div>
    </>
  );
}

function HelpProposalCard({
  card,
  controller,
  scrollRef,
}: {
  card: Extract<ReflectionHelpCard, { kind: 'proposal' }>;
  controller: ReflectionPageController;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const original = card.proposal.proposal.operation;
  const [draft, setDraft] = useState(() => cloneReflectionOperation(original));
  const submitting = controller.submittingProposalId === card.proposal.review.proposalId;
  const draftState = getOperationDraftState(original, draft, card.evidence);

  return (
    <>
      <div className="reflection-help-scroll" ref={scrollRef}>
        <EvidenceView evidence={card.evidence} />
        <section className="reflection-analysis">
          <h3>Feedback</h3>
          <p>{reflectionLearnerFeedback(card.result)}</p>
        </section>
        {card.result.questions.length > 0 ? (
          <InfoList
            title="Questions"
            entries={card.result.questions.map((question) => ({
              title: question.question,
              detail: question.reason,
            }))}
          />
        ) : null}
        <p>{card.proposal.proposal.rationale}</p>
        {draftState.applySupport === 'unsupported' ? <SupportNotice /> : null}
        <ReflectionOperationEditor
          operation={draft}
          evidence={card.evidence}
          onChange={setDraft}
        />
      </div>
      <div className="reflection-help-footer">
        <div className="reflection-help-quality">
          <ItemQualityTagControls
            artifactId={card.artifact.artifactId}
            itemId={card.result.itemId}
            annotation={findQualityItemTags(
              card.artifact.qualityItemTags,
              card.artifact.artifactId,
              card.result.itemId,
            )}
            submitting={
              controller.submittingQualityItemKey === qualityItemKey(
                card.artifact.artifactId,
                card.result.itemId,
              )
            }
            onUpsert={controller.upsertQuality}
            onClear={controller.clearQuality}
          />
        </div>
        {draftState.validationErrors.length > 0 ? (
          <div className="reflection-validation" role="alert">
            <strong>Fix before accepting:</strong>
            <ul>
              {draftState.validationErrors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </div>
        ) : null}
        <HelpReviewToolbar
          submitting={submitting}
          handleValue={`${draft.kind}@${draft.version}`}
          handleDisabled={submitting}
          onHandleChange={(value) => {
            const [kind, versionText] = value.split('@');
            setDraft(createReplacementOperation(
              kind as ReflectionOperation['kind'],
              Number(versionText),
              original,
              card.evidence,
            ));
          }}
          resetDisabled={submitting || draftState.acceptanceMode === 'exact'}
          onReset={() => setDraft(cloneReflectionOperation(original))}
          deferDisabled={submitting}
          onDefer={() => {
            void controller.deferProposal(card.proposal.review.proposalId).catch(() => undefined);
          }}
          acceptDisabled={submitting || draftState.validationErrors.length > 0}
          acceptLabel={
            submitting
              ? 'Saving...'
              : draftState.acceptanceMode === 'exact'
                ? 'Accept'
                : draftState.acceptanceMode === 'replacement'
                  ? 'Accept replacement'
                  : 'Accept'
          }
          onAccept={() => {
            void (draftState.acceptanceMode === 'replacement'
              ? controller.replaceProposal(card.proposal.review.proposalId, draft)
              : controller.acceptProposal(card.proposal.review.proposalId, draft)
            ).catch(() => undefined);
          }}
          dismissDisabled={submitting}
          onDismiss={() => {
            void controller.dismissProposal(card.proposal.review.proposalId, null).catch(() => undefined);
          }}
        />
      </div>
    </>
  );
}

function ProposalQueueView({
  proposals,
  controller,
}: {
  proposals: ReflectionProposalPresentation[];
  controller: ReflectionPageController;
}) {
  return (
    <main className="reflection-queue">
      <header className="reflection-queue-heading">
        <div>
          <h2>Deferred proposals</h2>
          <p className="notes">
            {proposals.length} proposal{proposals.length === 1 ? '' : 's'} across recent reflections
          </p>
        </div>
      </header>
      {proposals.length === 0 ? (
        <section className="panel reflection-empty-state">
          <h2>All clear</h2>
          <p className="notes">No proposals are deferred.</p>
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
              <ItemIdentityHeading evidence={presentation.evidence} />
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
          <ProposalCard
            proposal={presentation.proposal}
            evidence={presentation.evidence}
            qualityArtifactId={presentation.artifact.artifactId}
            qualityItemId={presentation.result.itemId}
            qualityAnnotation={findQualityItemTags(
              presentation.artifact.qualityItemTags,
              presentation.artifact.artifactId,
              presentation.result.itemId,
            )}
            qualitySubmitting={
              controller.submittingQualityItemKey === qualityItemKey(
                presentation.artifact.artifactId,
                presentation.result.itemId,
              )
            }
            submitting={
              controller.submittingProposalId === presentation.proposal.review.proposalId
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
                <p className="reflection-eyebrow">
                  {controller.selectedArtifact.sourceSessionId === null
                    ? 'Legacy prompt remediation'
                    : 'Source session'}
                </p>
                <h2>{formatDateTime(
                  controller.selectedArtifact.evidenceBundle.session.endedAt
                    ?? controller.selectedArtifact.generatedAt,
                )}</h2>
                <p className="notes reflection-long-metadata">
                  {controller.selectedArtifact.sourceSessionId === null
                    ? 'Sessionless reflection'
                    : `Session ${controller.selectedArtifact.sourceSessionId}`}
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
                    <ItemIdentityHeading evidence={item.evidence} />
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
                    <>
                      <p className="notes">
                        {item.result.diagnosisTags.includes('ordinary_retrieval_noise')
                          ? 'Judged as ordinary forgetting / retrieval noise; no durable change proposed.'
                          : 'Informational reflection only; no change was proposed.'}
                      </p>
                      <ItemQualityTagControls
                        artifactId={selectedArtifact.artifactId}
                        itemId={item.result.itemId}
                        annotation={findQualityItemTags(
                          selectedArtifact.qualityItemTags,
                          selectedArtifact.artifactId,
                          item.result.itemId,
                        )}
                        submitting={
                          controller.submittingQualityItemKey === qualityItemKey(
                            selectedArtifact.artifactId,
                            item.result.itemId,
                          )
                        }
                        onUpsert={controller.upsertQuality}
                        onClear={controller.clearQuality}
                      />
                    </>
                  ) : (
                    <div className="reflection-proposal-list">
                      {item.proposals.map((proposal) => (
                        <ProposalCard
                          key={proposal.review.proposalId}
                          proposal={proposal}
                          evidence={item.evidence}
                          qualityArtifactId={selectedArtifact.artifactId}
                          qualityItemId={item.result.itemId}
                          qualityAnnotation={findQualityItemTags(
                            selectedArtifact.qualityItemTags,
                            selectedArtifact.artifactId,
                            item.result.itemId,
                          )}
                          qualitySubmitting={
                            controller.submittingQualityItemKey === qualityItemKey(
                              selectedArtifact.artifactId,
                              item.result.itemId,
                            )
                          }
                          submitting={
                            controller.submittingProposalId === proposal.review.proposalId
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
          const annotation = controller.selectedArtifact === null
            ? null
            : findQualityItemTags(
              controller.selectedArtifact.qualityItemTags,
              gist.artifactId,
              gist.itemId,
            );
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
              <ItemQualityTagControls
                artifactId={gist.artifactId}
                itemId={gist.itemId}
                annotation={annotation}
                submitting={
                  controller.submittingQualityItemKey
                    === qualityItemKey(gist.artifactId, gist.itemId)
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
                <span title={costTitle(run)}
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

function costTitle(run: ReflectionGenerationRunDto): string {
  if (run.estimatedCostUsd === null) return 'Cost estimate unavailable for this run.';
  if (isOpenRouterReportedCostBasis(run.pricingBasis)) {
    return `Amount charged and reported by OpenRouter on ${run.pricingAsOf}; ${run.pricingSnapshotId}`;
  }
  return `Rates as of ${run.pricingAsOf}; ${run.pricingSnapshotId}`;
}

function isOpenRouterReportedCostBasis(value: unknown): value is { source: 'openrouter.usage.cost' } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'source' in value
    && value.source === 'openrouter.usage.cost';
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
  const sameModelAvailable = sourceModelIsCurrentlyAvailable(run.model);
  const options: ReflectionRetryMenuOption[] = [
    {
      id: 'same',
      label: sameModelAvailable
        ? `Same model (${run.model})`
        : `Same model (${run.model}) — no longer available`,
      disabled: !sameModelAvailable,
    },
    ...REFLECTION_RETRY_MODEL_OPTIONS,
  ];
  const firstEnabledIndex = Math.max(0, options.findIndex((option) => !option.disabled));
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
    setSelectedIndex(firstEnabledIndex);
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
    setSelectedIndex(firstEnabledIndex);
  }

  function confirmSelection(index = selectedIndex) {
    const option = options[index];
    if (option === undefined || option.disabled) return;
    closeMenu();
    void onRetry(run.runId, option.model);
  }

  function moveSelection(delta: number) {
    setSelectedIndex((current) => {
      for (let step = 1; step <= options.length; step += 1) {
        const next = (current + delta * step + options.length * step) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return current;
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
          {sameModelAvailable ? null : (
            <p className="reflection-retry-menu-notice" role="status">
              {run.model} is no longer available. Choose another model.
            </p>
          )}
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
                    aria-disabled={option.disabled === true}
                    disabled={option.disabled === true}
                    tabIndex={-1}
                    onMouseEnter={() => {
                      if (!option.disabled) setSelectedIndex(index);
                    }}
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
  qualityArtifactId,
  qualityItemId,
  qualityAnnotation,
  qualitySubmitting,
  submitting,
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
  qualityArtifactId: string;
  qualityItemId: string;
  qualityAnnotation: ReflectionQualityItemTags | null;
  qualitySubmitting: boolean;
  submitting: boolean;
  withdrawingInvocationId: string | null;
  onDefer: (proposalId: string) => Promise<void>;
  onDismiss: (
    proposalId: string,
    reason: string | null,
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

  useEffect(() => {
    setDraft(cloneReflectionOperation(original));
    setDismissReason('');
  }, [proposal.review.proposalId, proposal.review.updatedAt]);

  const draftState = getOperationDraftState(original, draft, evidence);
  const unresolved = proposal.review.disposition.kind === 'pending'
    || proposal.review.disposition.kind === 'deferred';
  const invocation = proposal.invocation;

  const qualityControls = (
    <ItemQualityTagControls
      artifactId={qualityArtifactId}
      itemId={qualityItemId}
      annotation={qualityAnnotation}
      submitting={qualitySubmitting}
      onUpsert={onUpsertQuality}
      onClear={onClearQuality}
    />
  );

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
      {draftState.applySupport === 'unsupported' ? <SupportNotice /> : null}

      {unresolved ? (
        <>
          <ReflectionOperationEditor
            operation={draft}
            evidence={evidence}
            onChange={setDraft}
          />
          <label className="reflection-field">
            <span>Handle</span>
            <ReflectionHandleSelect
              disabled={submitting}
              value={`${draft.kind}@${draft.version}`}
              onChange={(value) => {
                const [kind, versionText] = value.split('@');
                setDraft(createReplacementOperation(
                  kind as ReflectionOperation['kind'],
                  Number(versionText),
                  original,
                  evidence,
                ));
              }}
            />
          </label>
          {draftState.validationErrors.length > 0 ? (
            <div className="reflection-validation" role="alert">
              <strong>Fix before accepting:</strong>
              <ul>
                {draftState.validationErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </div>
          ) : null}
          {qualityControls}
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
            <div className="reflection-dismiss-row">
              <input
                value={dismissReason}
                placeholder="Optional dismissal note"
                aria-label="Optional dismissal note"
                disabled={submitting}
                onChange={(event) => setDismissReason(event.target.value)}
              />
              <button
                type="button"
                className="danger-button"
                disabled={submitting}
                onClick={() => {
                  void onDismiss(
                    proposal.review.proposalId,
                    dismissReason.trim().length === 0 ? null : dismissReason.trim(),
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
          <ReflectionOperationEditor operation={original} evidence={evidence} disabled />
          <ReviewOutcome disposition={proposal.review.disposition} />
          {invocation !== null ? (
            <>
              {proposal.review.disposition.kind === 'accepted'
                && proposal.review.disposition.acceptanceMode === 'revised' ? (
                  <>
                    <h5>Authorized revision</h5>
                    <ReflectionOperationEditor
                      operation={invocation.invocation.operation}
                      evidence={evidence}
                      disabled
                    />
                  </>
                ) : proposal.review.disposition.kind === 'superseded'
                    && proposal.review.disposition.supersession.source === 'user_replacement' ? (
                      <>
                        <h5>Authorized replacement</h5>
                        <ReflectionOperationEditor
                          operation={invocation.invocation.operation}
                          evidence={evidence}
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
          {qualityControls}
        </>
      )}
    </article>
  );
}

function ItemQualityTagControls({
  artifactId,
  itemId,
  annotation,
  submitting,
  onUpsert,
  onClear,
}: {
  artifactId: string;
  itemId: string;
  annotation: ReflectionQualityItemTags | null;
  submitting: boolean;
  onUpsert: ReflectionPageController['upsertQuality'];
  onClear: ReflectionPageController['clearQuality'];
}) {
  const noteInputRef = useRef<HTMLInputElement>(null);
  const committedNote = annotation?.note ?? null;
  const committedTags = annotation?.tags ?? [];
  const [note, setNote] = useState(committedNote ?? '');
  const [tags, setTags] = useState<ReflectionQualityTag[]>(committedTags);
  const [editingNote, setEditingNote] = useState(false);

  useEffect(() => {
    setNote(committedNote ?? '');
    setTags(committedTags);
    setEditingNote(false);
  }, [annotation?.annotationId, annotation?.updatedAt, committedNote, committedTags.join('|')]);

  useEffect(() => {
    if (!editingNote) return;
    noteInputRef.current?.focus();
    noteInputRef.current?.select();
  }, [editingNote]);

  const selected = new Set(tags);

  function persist(nextTags: ReflectionQualityTag[], nextNote: string) {
    const trimmed = nextNote.trim();
    if (nextTags.length === 0) {
      setTags([]);
      void onClear({ artifactId, itemId }).catch(() => undefined);
      return;
    }
    if (nextTags.includes('other') && trimmed.length === 0) {
      setTags(nextTags);
      setEditingNote(true);
      return;
    }
    setTags(nextTags);
    void onUpsert({
      artifactId,
      itemId,
      tags: nextTags,
      note: trimmed.length === 0 ? null : trimmed,
    }).catch(() => undefined);
  }

  function commitNoteEdit() {
    const trimmed = note.trim();
    if (tags.length === 0) {
      setNote(committedNote ?? '');
      setEditingNote(false);
      return;
    }
    if (tags.includes('other') && trimmed.length === 0) {
      return;
    }
    if (
      trimmed === (committedNote ?? '')
      && tags.length === committedTags.length
      && tags.every((tag) => committedTags.includes(tag))
    ) {
      setEditingNote(false);
      return;
    }
    persist(tags, note);
    setEditingNote(false);
  }

  return (
    <section className="reflection-quality-controls" aria-label="Quality tags">
      <div className="reflection-quality-chips" role="group" aria-label="Item quality tags">
        {REFLECTION_QUALITY_TAG_OPTIONS.map((option) => {
          const isSelected = selected.has(option.code);
          return (
            <button
              type="button"
              key={option.code}
              className={
                isSelected
                  ? option.code === 'praise'
                    ? 'reflection-quality-chip is-praise is-selected'
                    : 'reflection-quality-chip is-critique is-selected'
                  : option.code === 'praise'
                    ? 'reflection-quality-chip is-praise'
                    : 'reflection-quality-chip is-critique'
              }
              disabled={submitting}
              onClick={() => {
                const next = new Set(selected);
                if (isSelected) next.delete(option.code);
                else next.add(option.code);
                if (option.code === 'other' && !isSelected && note.trim().length === 0) {
                  setEditingNote(true);
                }
                persist([...next], note);
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="reflection-quality-row">
        {editingNote ? (
          <input
            ref={noteInputRef}
            className="reflection-quality-note"
            value={note}
            placeholder="Optional note (required for Other)"
            aria-label="Quality note"
            disabled={submitting}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => commitNoteEdit()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitNoteEdit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setNote(committedNote ?? '');
                setEditingNote(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={
              committedNote === null || committedNote.length === 0
                ? 'reflection-quality-note-display is-empty'
                : 'reflection-quality-note-display'
            }
            disabled={submitting}
            onClick={() => setEditingNote(true)}
          >
            {committedNote === null || committedNote.length === 0
              ? 'Add note…'
              : committedNote}
          </button>
        )}
        {annotation !== null ? (
          <button
            type="button"
            className="secondary-button reflection-quality-clear"
            disabled={submitting}
            onClick={() => void onClear({ artifactId, itemId }).catch(() => undefined)}
          >
            Clear
          </button>
        ) : null}
      </div>
    </section>
  );
}

function QualityStatsView({ stats }: { stats: ReflectionQualityStatsDto | null }) {
  const [promptVersionFilter, setPromptVersionFilter] = useState<string | 'all'>(
    CURRENT_REFLECTION_PROMPT_VERSION,
  );
  const [expandedModels, setExpandedModels] = useState<Set<string>>(() => new Set());

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
            Accept, dismiss, and tag reflection items while reviewing to accumulate rates by model
            arm.
          </p>
        </section>
      </main>
    );
  }

  const promptVersions = listQualityPromptVersions(stats.arms);
  const rows = presentQualityStatsArms(stats.arms, {
    promptVersionFilter,
  });

  return (
    <main className="reflection-quality-view">
      <section className="panel">
        <header className="reflection-queue-heading">
          <div>
            <h2>Model-arm quality vibe</h2>
            <p className="notes">
              Terminal user reviews plus item tag overlays. Pending, deferred, and system
              supersession are excluded from disposition rates. Tags count whenever present.
              Run cost sums priced generation attempts, including validation failures. Small
              counts are not statistical claims.
            </p>
          </div>
        </header>
        <div className="reflection-quality-toolbar" role="group" aria-label="Quality table controls">
          <label className="reflection-field reflection-quality-filter">
            <span>Reflection version</span>
            <select
              aria-label="Filter by reflection version"
              value={promptVersionFilter}
              onChange={(event) => {
                const value = event.target.value;
                setPromptVersionFilter(value === 'all' ? 'all' : value);
                setExpandedModels(new Set());
              }}
            >
              <option value={CURRENT_REFLECTION_PROMPT_VERSION}>
                Current ({CURRENT_REFLECTION_PROMPT_VERSION})
              </option>
              <option value="all">All versions</option>
              {promptVersions
                .filter((version) => version !== CURRENT_REFLECTION_PROMPT_VERSION)
                .map((version) => (
                  <option key={version} value={version}>{version}</option>
                ))}
            </select>
          </label>
        </div>
        {rows.length === 0 ? (
          <p className="notes">No rows match this reflection version filter.</p>
        ) : (
          <div className="reflection-quality-table" role="table" aria-label="Quality by model arm">
            <div className="reflection-quality-table-header" role="row">
              <span>Model arm</span>
              <span>Terminal</span>
              <span>Exact</span>
              <span>Revised</span>
              <span>Replace</span>
              <span>Dismiss</span>
              <span>Tagged</span>
              <span>Praise</span>
              <span>Missed</span>
              <span>Failed</span>
              <span>Cost</span>
              <span>$/Exact</span>
            </div>
            {rows.flatMap((arm) => {
              const expandable = arm.promptBreakdown.length > 0;
              const expanded = expandedModels.has(arm.modelArm);
              const mainRow = (
                <QualityStatsTableRow
                  key={arm.groupLabel}
                  arm={arm}
                  expandable={expandable}
                  expanded={expanded}
                  onToggle={() => {
                    setExpandedModels((current) => {
                      const next = new Set(current);
                      if (next.has(arm.modelArm)) {
                        next.delete(arm.modelArm);
                      } else {
                        next.add(arm.modelArm);
                      }
                      return next;
                    });
                  }}
                />
              );
              if (!expandable || !expanded) {
                return [mainRow];
              }
              return [
                mainRow,
                ...arm.promptBreakdown.map((breakdown) => (
                  <QualityStatsTableRow
                    key={`${arm.groupLabel}:${breakdown.promptVersion}`}
                    arm={breakdown}
                    isBreakdown
                  />
                )),
              ];
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function QualityStatsTableRow({
  arm,
  expandable = false,
  expanded = false,
  isBreakdown = false,
  onToggle,
}: {
  arm: ReflectionQualityStatsDto['arms'][number];
  expandable?: boolean;
  expanded?: boolean;
  isBreakdown?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={isBreakdown
        ? 'reflection-quality-table-row is-breakdown'
        : 'reflection-quality-table-row'}
      role="row"
    >
      <span className="reflection-quality-model-cell">
        {expandable ? (
          <button
            type="button"
            className="reflection-quality-expand"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse prompt versions' : 'Expand prompt versions'}
            onClick={onToggle}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : null}
        <strong>{isBreakdown ? arm.promptVersion : arm.modelArm}</strong>
      </span>
      <span>{arm.terminalReviewCount}</span>
      <span>{formatRate(arm.exactAcceptCount, arm.terminalReviewCount)}</span>
      <span>{formatRate(arm.revisedAcceptCount, arm.terminalReviewCount)}</span>
      <span>{formatRate(arm.userReplaceCount, arm.terminalReviewCount)}</span>
      <span>{formatRate(arm.dismissCount, arm.terminalReviewCount)}</span>
      <span>{arm.taggedItemCount}</span>
      <span>{arm.tagCounts.praise}</span>
      <span>{arm.tagCounts.missed_intervention}</span>
      <span>{arm.failedRunCount}</span>
      <span>{formatQualityCost(arm.totalCostUsd)}</span>
      <span>{formatQualityCost(arm.avgCostPerExactAcceptUsd)}</span>
    </div>
  );
}

function formatQualityCost(value: number | null): string {
  return value === null ? '—' : formatUsd(value);
}

function formatRate(count: number, total: number): string {
  if (total === 0) return '0';
  return `${count} (${Math.round((count / total) * 100)}%)`;
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

function SupportNotice() {
  return (
    <div className="reflection-support">
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
      <section className="reflection-tested-cue">
        <p className="notes">The evidence item could not be reconstructed for display.</p>
      </section>
    );
  }

  if (evidence.source === 'production_mistake') {
    const servedCues = 'servedCue' in evidence
      ? [evidence.servedCue]
      : evidence.cuesAsShown;
    return <TestedCueLine label="Tested cue" texts={servedCues.map((cue) => cue.text)} />;
  }

  if (evidence.source === 'contrast_selection') {
    return (
      <TestedCueLine
        label="Prompt"
        texts={evidence.promptAsShown.promptText.length === 0
          ? []
          : [evidence.promptAsShown.promptText]}
      />
    );
  }

  return (
    <>
      <TestedCueLine
        label="Session note"
        texts={evidence.sessionNote === null || evidence.sessionNote.length === 0
          ? []
          : [evidence.sessionNote]}
      />
      {evidence.relatedWords.length > 0 ? (
        <p className="notes">Related: {evidence.relatedWords.map(wordLabel).join(', ')}</p>
      ) : null}
    </>
  );
}

function TestedCueLine({
  label,
  texts,
}: {
  label: string;
  texts: string[];
}) {
  const visible = texts.map((text) => text.trim()).filter((text) => text.length > 0);
  if (visible.length === 0) return null;
  const [first, ...rest] = visible;
  return (
    <section className="reflection-tested-cue">
      <h3>{label}</h3>
      <details>
        <summary>{first}</summary>
        {rest.length === 0 ? null : (
          <ul>
            {rest.map((text, index) => <li key={`${text}-${index}`}>{text}</li>)}
          </ul>
        )}
      </details>
    </section>
  );
}

function ItemIdentityHeading({
  evidence,
}: {
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null;
}) {
  const target = itemTitle(evidence);
  const typed = evidence?.source === 'production_mistake'
    ? evidence.rawResponse ?? 'No response'
    : null;
  return (
    <h2>
      {target}
      {typed === null ? null : (
        <span className="reflection-identity-typed"> / {typed}</span>
      )}
    </h2>
  );
}

function HelpReviewToolbar({
  submitting,
  handleValue,
  handleDisabled,
  onHandleChange,
  resetDisabled,
  onReset,
  deferDisabled,
  onDefer,
  acceptDisabled,
  acceptLabel,
  onAccept,
  dismissDisabled,
  onDismiss,
}: {
  submitting: boolean;
  handleValue: string;
  handleDisabled: boolean;
  onHandleChange: (value: string) => void;
  resetDisabled: boolean;
  onReset: () => void;
  deferDisabled: boolean;
  onDefer: () => void;
  acceptDisabled: boolean;
  acceptLabel: string;
  onAccept: () => void;
  dismissDisabled: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="reflection-help-toolbar">
      <ReflectionHandleSelect
        disabled={handleDisabled || submitting}
        value={handleValue}
        onChange={onHandleChange}
      />
      <button
        type="button"
        className="secondary-button"
        disabled={resetDisabled || submitting}
        onClick={onReset}
      >
        Reset
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={deferDisabled || submitting}
        onClick={onDefer}
      >
        Defer
      </button>
      <button
        type="button"
        disabled={acceptDisabled || submitting}
        onClick={onAccept}
      >
        {acceptLabel}
      </button>
      <button
        type="button"
        className="danger-button"
        disabled={dismissDisabled || submitting}
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

function ReflectionHandleSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const knownValue = REFLECTION_HANDLE_OPTIONS.some((option) => option.value === value);
  return (
    <select
      className="reflection-handle-select"
      aria-label="Handle"
      disabled={disabled}
      value={knownValue ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    >
      {knownValue ? null : <option value="">—</option>}
      {REFLECTION_HANDLE_OPTIONS.map((option) => (
        <option value={option.value} key={option.value}>{option.label}</option>
      ))}
    </select>
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

function formatCompactDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
