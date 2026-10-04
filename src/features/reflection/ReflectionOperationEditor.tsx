import type { PureCueReflectionItemV1, ReconcilePureCueResponseOperationV1 } from '../../domain/pure-cue-reflection';
import { useEffect, useRef, useState } from 'react';
import type {
  CreateContrastClusterOperation,
  ProductionCueChangeV2,
  ProductionCueDraftV2,
  PromotePureElicitationWordPlanV1,
  ReflectionInputItemV1,
  ReflectionInputItemV2,
  ReflectionItemV3,
  ReflectionItemV5,
  ReflectionOperation,
  PromotePureElicitationOperationV1,
  ReconcileProductionCuesOperationV1,
  PureCuePromotionPureCueSnapshotV2,
  RepairProductionCueOperationV1,
  RepairProductionCueOperationV2,
} from '../../domain/reflection';
import { studyProfile } from '../../study-profile';
import {
  collectEvidenceWordOptions,
  evidenceWordSurfaceLabel,
  reduceReflectionOperationDraft,
  servedCueDisplayText,
  servedCueId,
  type EvidenceWordOption,
  type ReflectionOperationDraftAction,
} from './reflection-page-model';

export function ReflectionOperationEditor({
  operation,
  evidence = null,
  disabled = false,
  targetProductionSuppressed = false,
  onChange,
}: {
  operation: ReflectionOperation;
  evidence?: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | ReflectionItemV5 | PureCueReflectionItemV1 | null;
  disabled?: boolean;
  targetProductionSuppressed?: boolean;
  onChange?: (operation: ReflectionOperation) => void;
}) {
  const wordOptions = collectEvidenceWordOptions(evidence);
  const servedCueText = servedCueDisplayText(evidence);
  const lockedServedCueId = servedCueId(evidence);
  const lockedTargetWordId = evidence?.targetWord?.wordId ?? null;

  function dispatch(action: ReflectionOperationDraftAction) {
    if (disabled || onChange === undefined) {
      return;
    }
    onChange(reduceReflectionOperationDraft(operation, action));
  }

  switch (operation.kind) {
    case 'repair_pure_cue_stimulus':
      return (
        <div className="reflection-operation-fields">
          <Field label="Stimulus shown to the learner">
            <p>{operation.expectedStimulus}</p>
          </Field>
          <Field label="Repaired stimulus">
            <textarea value={operation.stimulus} disabled={disabled}
              onChange={(event) => onChange?.({ ...operation, stimulus: event.target.value })} />
          </Field>
          <p className="notes">The existing axis and accepted answers stay the same. The repaired stimulus will be used for future attempts.</p>
        </div>
      );
    case 'reconcile_pure_cue_response': {
      if (evidence?.source !== 'pure_cue_mistake') {
        return <p className="notes">Pure cue evidence is unavailable.</p>;
      }
      return (
        <PureCueResponseEditor operation={operation} evidence={evidence} disabled={disabled} onChange={onChange} />
      );
    }
    case 'suppress_definition_production':
      return (
        <div className="reflection-operation-fields">
          <Field label={studyProfile.labels.target}>
            <EvidenceWordPicker
              value={operation.wordId}
              options={wordOptions}
              disabled={disabled || targetProductionSuppressed}
              onChange={(wordId) => dispatch({
                type: 'set_suppression_word',
                wordId,
              })}
            />
          </Field>
        </div>
      );
    case 'create_contrast_cluster':
      return (
        <ContrastClusterEditor
          operation={operation}
          wordOptions={wordOptions}
          disabled={disabled}
          dispatch={dispatch}
        />
      );
    case 'repair_production_cue':
      if (operation.version === 2) {
        return (
          <ProductionCueEditorV2
            operation={operation}
            wordOptions={wordOptions}
            servedCueText={servedCueText}
            lockedServedCueId={lockedServedCueId}
            lockedTargetWordId={lockedTargetWordId}
            disabled={disabled}
            dispatch={dispatch}
          />
        );
      }
      return (
        <ProductionCueEditor
          operation={operation}
          wordOptions={wordOptions}
          disabled={disabled}
          dispatch={dispatch}
        />
      );
    case 'accept_production_alternate':
      return (
        <div className="reflection-operation-fields reflection-two-column-fields">
          <Field label={studyProfile.labels.target}>
            <EvidenceWordPicker
              value={operation.targetWordId}
              options={wordOptions}
              excludeWordIds={new Set(
                operation.alternateWordId.length === 0 ? [] : [operation.alternateWordId],
              )}
              disabled={disabled}
              onChange={(wordId) => dispatch({
                type: 'set_alternate_target',
                targetWordId: wordId,
              })}
            />
          </Field>
          <Field label={`Accepted alternate ${studyProfile.labels.target}`}>
            <EvidenceWordPicker
              value={operation.alternateWordId}
              options={wordOptions}
              excludeWordIds={new Set(
                operation.targetWordId.length === 0 ? [] : [operation.targetWordId],
              )}
              disabled={disabled}
              onChange={(wordId) => dispatch({
                type: 'set_alternate_word',
                alternateWordId: wordId,
              })}
            />
          </Field>
        </div>
      );
    case 'add_production_cue_supplement':
      return (
        <div className="reflection-operation-fields">
          <Field label="English usage frame">
            <textarea
              value={operation.englishFrame}
              disabled={disabled}
              onChange={(event) => dispatch({
                type: 'set_supplement_english_frame',
                englishFrame: event.target.value,
              })}
            />
          </Field>
          <Field label="Chinese example sentence">
            <textarea
              value={operation.exampleSentence}
              disabled={disabled}
              onChange={(event) => dispatch({
                type: 'set_supplement_example_sentence',
                exampleSentence: event.target.value,
              })}
            />
          </Field>
          <Field label="English translation">
            <textarea
              value={operation.exampleTranslation}
              disabled={disabled}
              onChange={(event) => dispatch({
                type: 'set_supplement_example_translation',
                exampleTranslation: event.target.value,
              })}
            />
          </Field>
        </div>
      );
    case 'reconcile_production_cues':
    case 'promote_pure_elicitation':
      return (
        <PureElicitationPromotionEditor
          operation={operation}
          evidence={evidence}
          targetProductionSuppressed={targetProductionSuppressed}
          wordOptions={wordOptions}
          disabled={disabled}
          dispatch={dispatch}
        />
      );
  }
}

function PureCueResponseEditor({
  operation, evidence, disabled, onChange,
}: {
  operation: ReconcilePureCueResponseOperationV1;
  evidence: PureCueReflectionItemV1;
  disabled: boolean;
  onChange?: (operation: ReflectionOperation) => void;
}) {
  const plan = operation.responseWordPlan;
  const updatePlan = (patch: Partial<typeof plan>) => {
    if (disabled || onChange === undefined) return;
    onChange({ ...operation, responseWordPlan: { ...plan, ...patch } });
  };

  function handleCueAction(action: WordCuePlanAction) {
    switch (action.type) {
      case 'toggle_cue':
        updatePlan({ deactivateCueIds: plan.deactivateCueIds.includes(action.cueId)
          ? plan.deactivateCueIds.filter((id) => id !== action.cueId)
          : [...plan.deactivateCueIds, action.cueId] });
        break;
      case 'add_draft':
        updatePlan({ distinctiveCueDrafts: [...plan.distinctiveCueDrafts, { cueType: 'minimal_context', text: '' }] });
        break;
      case 'update_draft':
        updatePlan({ distinctiveCueDrafts: plan.distinctiveCueDrafts.map((draft, index) =>
          index === action.index ? { ...draft, ...action.patch } : draft) });
        break;
      case 'remove_draft':
        updatePlan({ distinctiveCueDrafts: plan.distinctiveCueDrafts.filter((_, index) => index !== action.index) });
        break;
      case 'restore_draft':
        updatePlan({ distinctiveCueDrafts: [...plan.distinctiveCueDrafts, action.draft] });
        break;
    }
  }

  return (
    <div className="reflection-operation-fields">
      <p>{evidence.servedSnapshot.stimulus}</p>
      <p className="notes">Accepted answers: {evidence.currentCue.acceptedWords.map((word) => word.hanzi).join('、')}
        {' → add '}{evidence.submittedWord.hanzi}</p>
      <p className="notes">Accepting restores the pure cue's progress before this first response. Existing members' word cues stay unchanged.</p>
      <Field label="Teaching note">
        <textarea value={operation.teachingNote} disabled={disabled}
          onChange={(event) => onChange?.({ ...operation, teachingNote: event.target.value })} />
      </Field>
      <section className="reflection-promotion-preview" aria-label="Resulting cue set">
        <WordCuePlanEditor
          heading={`${evidence.submittedWord.hanzi} — individual cues`}
          plan={plan}
          activeCues={evidence.activeProductionCues.filter((cue): cue is typeof cue & { cueId: string } => cue.cueId !== null)}
          disabled={disabled}
          onAction={onChange === undefined ? undefined : handleCueAction}
        />
      </section>
    </div>
  );
}

function PureElicitationPromotionEditor({
  operation,
  evidence,
  wordOptions,
  disabled,
  targetProductionSuppressed,
  dispatch,
}: {
  operation: PromotePureElicitationOperationV1 | ReconcileProductionCuesOperationV1;
  targetProductionSuppressed: boolean;
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | ReflectionItemV5 | PureCueReflectionItemV1 | null;
  wordOptions: EvidenceWordOption[];
  disabled: boolean;
  dispatch: (action: ReflectionOperationDraftAction) => void;
}) {
  const promotionEvidence = evidence !== null && 'promotionEvidence' in evidence
    ? evidence.promotionEvidence
    : null;
  const pureCues = promotionEvidence?.intersectingPureCues ?? [];
  const pureMemberLabels = new Map(pureCues.flatMap((cue) =>
    'acceptedMembers' in cue
      ? (cue as PureCuePromotionPureCueSnapshotV2).acceptedMembers.map((member) => [member.wordId, member.hanzi] as const)
      : []));
  const wordEvidence = new Map(
    (promotionEvidence?.words ?? []).map((word) => [word.wordId, word]),
  );
  const wordLabel = (wordId: string) => {
    const option = wordOptions.find((word) => word.wordId === wordId);
    return option === undefined ? wordId : evidenceWordSurfaceLabel(option);
  };
  const wordHeading = (wordId: string) => {
    const option = wordOptions.find((word) => word.wordId === wordId);
    return option?.hanzi ?? pureMemberLabels.get(wordId) ?? wordId;
  };
  const [destinationExpanded, setDestinationExpanded] = useState(false);
  const destinationAcceptedWordIds = promotionDestinationAcceptedWordIds(operation, pureCues);

  function handleCueAction(wordId: string, action: WordCuePlanAction) {
    switch (action.type) {
      case 'toggle_cue':
        dispatch({ type: 'toggle_promotion_deactivation', wordId, cueId: action.cueId });
        break;
      case 'add_draft':
        dispatch({ type: 'add_promotion_distinctive_cue', wordId });
        break;
      case 'update_draft':
        dispatch({ type: 'update_promotion_distinctive_cue', wordId, index: action.index, patch: action.patch });
        break;
      case 'remove_draft':
        dispatch({ type: 'remove_promotion_distinctive_cue', wordId, index: action.index });
        break;
      case 'restore_draft':
        dispatch({ type: 'restore_promotion_distinctive_cue', wordId, draft: action.draft });
        break;
    }
  }

  function existingDestination(cue: typeof pureCues[number]) {
    const teachingNote = 'teachingNote' in cue && typeof cue.teachingNote === 'string' ? cue.teachingNote : '';
    return operation.kind === 'reconcile_production_cues'
      ? { kind: 'existing' as const, pureCueId: cue.id, teachingNote,
          expectedAcceptedWordIds: [...cue.acceptedWordIds], expectedTeachingNote: teachingNote,
          expectedStimulus: cue.stimulus, expectedAxisNote: cue.axisNote }
      : { kind: 'existing' as const, pureCueId: cue.id };
  }

  return (
    <div className="reflection-operation-fields">
      <p className="notes reflection-promotion-pair">
        {wordLabel(operation.targetWordId)} ↔ {wordLabel(operation.responseWordId)}
      </p>
      {operation.kind === 'reconcile_production_cues' ? (
        <Field label="Original cue fairness">
          <select value={operation.sourceAttemptFairness} disabled={disabled}
            onChange={(event) => dispatch({ type: 'set_reconciliation_fairness', fairness: event.target.value as ReconcileProductionCuesOperationV1['sourceAttemptFairness'] })}>
            <option value="fair">Fair cue — preserve the original assessment</option>
            <option value="misleading_or_overloaded_cue">{targetProductionSuppressed
              ? 'Misleading or overloaded cue — no lapse change'
              : 'Misleading or overloaded cue — restore eligible lapse'}</option>
          </select>
        </Field>
      ) : null}
      <section className="reflection-promotion-preview" aria-label="Resulting cue set">
        {targetProductionSuppressed ? <p className="notes">Target production suppression is recommended. Only response-word cues can be changed here.</p> : <section className="reflection-promotion-group reflection-promotion-shared-group">
          <header className="reflection-promotion-group-heading">
            <h5>{operation.destination === null ? 'Word-specific cleanup' : destinationAcceptedWordIds.map(wordHeading).join(' / ')}</h5>
          </header>
          <div className={`reflection-promotion-cue is-included ${operation.destination?.kind === 'existing' ? 'kind-keep' : operation.destination === null ? '' : 'kind-create'}`}>
            <div className="reflection-promotion-cue-row">
              {operation.destination !== null ? <PromotionCueStatus kind={operation.destination.kind === 'existing' ? 'keep' : 'create'} /> : null}
              <span className="reflection-promotion-cue-copy">
                {compactPromotionDestinationPreview(operation, pureCues)}
              </span>
              <button type="button" className="reflection-promotion-expand"
                aria-expanded={destinationExpanded}
                aria-label={destinationExpanded ? 'Close shared cue editor' : 'Edit shared cue'}
                onClick={() => setDestinationExpanded((current) => !current)}>
                {destinationExpanded ? '▴' : '▾'}
              </button>
            </div>
            {destinationExpanded ? (
              <div className="reflection-promotion-cue-detail">
                <Field label="Shared practice">
                  <select value={operation.destination?.kind ?? 'none'} disabled={disabled}
                    onChange={(event) => {
                      const cue = pureCues[0];
                      const destination = event.target.value === 'none' ? null
                        : event.target.value === 'existing' && cue !== undefined
                          ? existingDestination(cue)
                          : operation.kind === 'reconcile_production_cues'
                            ? { kind: 'create' as const, stimulus: '', axisNote: '', teachingNote: '' }
                            : { kind: 'create' as const, stimulus: '', axisNote: '' };
                      dispatch({ type: 'set_promotion_destination', destination });
                    }}>
                    {operation.kind === 'reconcile_production_cues' ? <option value="none">No shared cue</option> : null}
                    <option value="create">Create new pure elicitation</option>
                    <option value="existing" disabled={pureCues.length === 0}>Extend existing pure elicitation</option>
                  </select>
                </Field>
                {operation.destination?.kind === 'existing' ? (
                  <Field label="Existing pure elicitation">
                    <select value={operation.destination.pureCueId} disabled={disabled}
                      onChange={(event) => {
                        const cue = pureCues.find((entry) => entry.id === event.target.value);
                        if (cue === undefined) throw new Error('Selected pure cue is missing from evidence.');
                        dispatch({ type: 'set_promotion_destination', destination: existingDestination(cue) });
                      }}>
                      {pureCues.map((cue) => <option value={cue.id} key={cue.id}>{cue.stimulus}{cue.axisNote ? ` — ${cue.axisNote}` : ''}</option>)}
                    </select>
                  </Field>
                ) : operation.destination?.kind === 'create' ? (
                  <>
                    <Field label="Shared elicitation stimulus">
                      <textarea value={operation.destination.stimulus} disabled={disabled}
                        onChange={(event) => {
                          if (operation.destination?.kind !== 'create') return;
                          dispatch({ type: 'set_promotion_destination', destination: { ...operation.destination, stimulus: event.target.value } });
                        }} />
                    </Field>
                    <Field label="Semantic axis note">
                      <textarea value={operation.destination.axisNote} disabled={disabled}
                        onChange={(event) => {
                          if (operation.destination?.kind !== 'create') return;
                          dispatch({ type: 'set_promotion_destination', destination: { ...operation.destination, axisNote: event.target.value } });
                        }} />
                    </Field>
                  </>
                ) : null}
                {operation.kind === 'reconcile_production_cues' && operation.destination !== null ? (
                  <Field label="Teaching note shown on reveal">
                    <textarea value={operation.destination.teachingNote} disabled={disabled}
                      onChange={(event) => {
                        if (operation.destination === null) return;
                        dispatch({ type: 'set_promotion_destination', destination: { ...operation.destination, teachingNote: event.target.value } });
                      }} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>}

        {operation.wordPlans.filter((plan) => !targetProductionSuppressed || plan.wordId !== operation.targetWordId).map((plan) => (
          <WordCuePlanEditor
            key={plan.wordId}
            heading={wordHeading(plan.wordId)}
            plan={plan}
            activeCues={wordEvidence.get(plan.wordId)?.activeProductionCues ?? []}
            disabled={disabled}
            onAction={(action) => handleCueAction(plan.wordId, action)}
          />
        ))}
      </section>
    </div>
  );
}

type WordCueDraft = PromotePureElicitationWordPlanV1['distinctiveCueDrafts'][number];
type WordCuePlanAction =
  | { type: 'toggle_cue'; cueId: string }
  | { type: 'add_draft' }
  | { type: 'update_draft'; index: number; patch: Partial<WordCueDraft> }
  | { type: 'remove_draft'; index: number }
  | { type: 'restore_draft'; draft: WordCueDraft };

function WordCuePlanEditor({
  heading, plan, activeCues, disabled, onAction,
}: {
  heading: string;
  plan: PromotePureElicitationWordPlanV1;
  activeCues: ReadonlyArray<{ cueId: string; text: string }>;
  disabled: boolean;
  onAction?: (action: WordCuePlanAction) => void;
}) {
  const cueTypes = ['definition_gloss', 'minimal_context', 'circumstance'] as const;
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [excludedDrafts, setExcludedDrafts] = useState<Array<{ key: number; draft: WordCueDraft }>>([]);
  const excludedDraftKey = useRef(0);
  const localPlanChangePending = useRef(false);

  useEffect(() => {
    if (localPlanChangePending.current) {
      localPlanChangePending.current = false;
      return;
    }
    setExcludedDrafts([]);
  }, [plan]);

  function send(action: WordCuePlanAction) {
    if (disabled || onAction === undefined) return;
    localPlanChangePending.current = true;
    onAction(action);
  }

  return (
    <section className="reflection-promotion-group">
      <header className="reflection-promotion-group-heading"><h5>{heading}</h5></header>
      <ul className="reflection-promotion-cues">
        {activeCues.map((cue) => {
          const included = !plan.deactivateCueIds.includes(cue.cueId);
          return (
            <li className={`reflection-promotion-cue ${included ? 'kind-keep is-included' : 'kind-deactivate is-excluded'}`} key={cue.cueId}>
              <button type="button" className="reflection-promotion-cue-toggle" aria-pressed={included}
                aria-label={`${included ? 'Keep' : 'Deactivate'} cue: ${cue.text}`} disabled={disabled}
                onClick={() => send({ type: 'toggle_cue', cueId: cue.cueId })}>
                <PromotionCueStatus kind={included ? 'keep' : 'deactivate'} />
                <span className="reflection-promotion-cue-copy">{cue.text}</span>
              </button>
            </li>
          );
        })}
        {plan.distinctiveCueDrafts.map((draft, index) => {
          const expanded = expandedIndex === index;
          const preview = draft.text.trim() || 'New distinctive cue';
          return (
            <li className={`reflection-promotion-cue kind-create is-included${expanded ? ' is-expanded' : ''}`} key={index}>
              <div className="reflection-promotion-cue-row">
                <button type="button" className="reflection-promotion-cue-toggle" aria-pressed="true"
                  aria-label={`New cue: ${preview}`} disabled={disabled}
                  onClick={() => {
                    setExcludedDrafts((current) => [...current, { key: excludedDraftKey.current++, draft: { ...draft } }]);
                    setExpandedIndex((current) => current === index ? null : current);
                    send({ type: 'remove_draft', index });
                  }}>
                  <PromotionCueStatus kind="create" />
                  <span className="reflection-promotion-cue-copy">{preview}</span>
                </button>
                <button type="button" className="reflection-promotion-expand" aria-expanded={expanded}
                  aria-label={expanded ? 'Close new cue editor' : 'Edit new cue'}
                  onClick={() => setExpandedIndex((current) => current === index ? null : index)}>
                  {expanded ? '▴' : '▾'}
                </button>
              </div>
              {expanded ? <div className="reflection-promotion-cue-detail">
                <Field label={`Cue ${index + 1} type`}>
                  <select value={draft.cueType} disabled={disabled} onChange={(event) => send({
                    type: 'update_draft', index, patch: { cueType: event.target.value as typeof cueTypes[number] },
                  })}>
                    {cueTypes.map((cueType) => <option value={cueType} key={cueType}>{humanize(cueType)}</option>)}
                  </select>
                </Field>
                <Field label="Cue text">
                  <textarea value={draft.text} disabled={disabled} onChange={(event) => send({
                    type: 'update_draft', index, patch: { text: event.target.value },
                  })} />
                </Field>
              </div> : null}
            </li>
          );
        })}
        {excludedDrafts.map(({ key, draft }) => (
          <li className="reflection-promotion-cue kind-create is-excluded" key={key}>
            <button type="button" className="reflection-promotion-cue-toggle" aria-pressed="false"
              aria-label={`New cue: ${draft.text.trim() || 'New distinctive cue'}`} disabled={disabled}
              onClick={() => {
                setExcludedDrafts((current) => current.filter((entry) => entry.key !== key));
                send({ type: 'restore_draft', draft });
              }}>
              <PromotionCueStatus kind="create" />
              <span className="reflection-promotion-cue-copy">{draft.text.trim() || 'New distinctive cue'}</span>
            </button>
          </li>
        ))}
      </ul>
      {!disabled && onAction !== undefined ? <button type="button"
        className="secondary-button reflection-promotion-add-cue"
        onClick={() => {
          setExpandedIndex(plan.distinctiveCueDrafts.length);
          send({ type: 'add_draft' });
        }}>+ Add cue</button> : null}
    </section>
  );
}

function PromotionCueStatus({
  kind,
}: {
  kind: 'create' | 'keep' | 'deactivate';
}) {
  return (
    <span className={`reflection-promotion-cue-status kind-${kind}`} aria-hidden="true">
      {kind === 'create' ? '+' : kind === 'keep' ? '✓' : '−'}
    </span>
  );
}

function promotionDestinationAcceptedWordIds(
  operation: PromotePureElicitationOperationV1 | ReconcileProductionCuesOperationV1,
  pureCues: ReadonlyArray<{ id: string; acceptedWordIds: string[] }>,
): string[] {
  const existingPureCueId = operation.destination?.kind === 'existing'
    ? operation.destination.pureCueId
    : null;
  const existingIds = existingPureCueId === null
    ? []
    : pureCues.find((cue) => cue.id === existingPureCueId)?.acceptedWordIds ?? [];
  return [...new Set([
    ...existingIds,
    operation.targetWordId,
    operation.responseWordId,
  ])];
}

function compactPromotionDestinationPreview(
  operation: PromotePureElicitationOperationV1 | ReconcileProductionCuesOperationV1,
  pureCues: ReadonlyArray<{ id: string; stimulus: string; axisNote: string }>,
): string {
  if (operation.destination?.kind === 'existing') {
    const { pureCueId } = operation.destination;
    const cue = pureCues.find((item) => item.id === pureCueId);
    const stimulus = cue?.stimulus.trim() ?? '';
    return stimulus.length === 0 ? pureCueId : stimulus;
  }
  if (operation.destination === null) return 'No shared cue; reconcile word-specific cues';
  const stimulus = operation.destination.stimulus.trim();
  return stimulus.length === 0 ? 'New elicitation' : stimulus;
}

function ProductionCueEditorV2({
  operation,
  wordOptions,
  servedCueText,
  lockedServedCueId,
  lockedTargetWordId,
  disabled,
  dispatch,
}: {
  operation: RepairProductionCueOperationV2;
  wordOptions: EvidenceWordOption[];
  servedCueText: string | null;
  lockedServedCueId: string | null;
  lockedTargetWordId: string | null;
  disabled: boolean;
  dispatch: (action: ReflectionOperationDraftAction) => void;
}) {
  const changeKinds = ['create', 'replace', 'deactivate'] as const;
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="reflection-operation-fields">
      {lockedTargetWordId !== null && operation.wordId !== lockedTargetWordId ? (
        <p className="notes" role="status">
          Cue repair is locked to the evidence target.
        </p>
      ) : null}

      <section className="reflection-cue-change-list" aria-label="Cue changes">
        <div className="reflection-cue-change-heading">
          <span className="reflection-cue-change-count">
            {operation.changes.length} change{operation.changes.length === 1 ? '' : 's'}
          </span>
          {!disabled ? (
            <button
              type="button"
              className="secondary-button reflection-cue-change-add"
              aria-label="Add cue change"
              onClick={() => {
                setExpandedIndex(operation.changes.length);
                dispatch({ type: 'add_v2_cue_change' });
              }}
            >
              +
            </button>
          ) : null}
        </div>
        {operation.changes.length === 0 ? (
          <p className="notes">No cue changes yet.</p>
        ) : (
          <ul className="reflection-cue-change-items">
            {operation.changes.map((change, changeIndex) => {
              const expanded = expandedIndex === changeIndex;
              const preview = compactCueChangePreview(change, servedCueText);
              return (
                <li
                  className={
                    expanded
                      ? 'reflection-cue-change-item is-expanded'
                      : 'reflection-cue-change-item'
                  }
                  key={`change-${changeIndex}`}
                >
                  <div className="reflection-cue-change-row">
                    <span
                      className={`reflection-cue-change-kind kind-${change.kind}`}
                      title={humanize(change.kind)}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="reflection-cue-change-preview"
                      aria-expanded={expanded}
                      aria-label={`${humanize(change.kind)}: ${preview}`}
                      onClick={() => setExpandedIndex(expanded ? null : changeIndex)}
                    >
                      {preview}
                    </button>
                    {!disabled ? (
                      <button
                        type="button"
                        className="secondary-button reflection-cue-change-delete"
                        aria-label={`Remove ${humanize(change.kind)} change`}
                        onClick={() => {
                          if (expandedIndex === changeIndex) setExpandedIndex(null);
                          else if (expandedIndex !== null && expandedIndex > changeIndex) {
                            setExpandedIndex(expandedIndex - 1);
                          }
                          dispatch({ type: 'remove_v2_cue_change', index: changeIndex });
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  {expanded ? (
                    <div className="reflection-cue-change-detail">
                      <Field label="Change kind">
                        <select
                          value={change.kind}
                          disabled={disabled}
                          onChange={(event) => dispatch({
                            type: 'set_v2_cue_change_kind',
                            index: changeIndex,
                            kind: event.target.value as typeof changeKinds[number],
                            cueId: lockedServedCueId ?? '',
                          })}
                        >
                          {changeKinds.map((kind) => (
                            <option value={kind} key={kind}>{humanize(kind)}</option>
                          ))}
                        </select>
                      </Field>

                      {change.kind === 'create' ? (
                        <ProductionCueDraftFields
                          draft={change.cue}
                          wordOptions={wordOptions}
                          disabled={disabled}
                          label="New cue"
                          onPatch={(patch) => dispatch({
                            type: 'update_v2_create_cue',
                            changeIndex,
                            patch,
                          })}
                        />
                      ) : (
                        <Field label={change.kind === 'replace' ? 'Cue to replace' : 'Tested cue'}>
                          <input
                            value={servedCueText ?? 'Served cue'}
                            disabled
                            readOnly
                          />
                        </Field>
                      )}

                      {change.kind === 'replace' ? (
                        <EditorCollection
                          title="Replacement cues"
                          addLabel="Add replacement"
                          disabled={disabled}
                          onAdd={() => dispatch({ type: 'add_v2_replacement', changeIndex })}
                        >
                          {change.replacements.map((replacement, replacementIndex) => (
                            <div
                              className="reflection-editor-row"
                              key={`replacement-${changeIndex}-${replacementIndex}`}
                            >
                              <ProductionCueDraftFields
                                draft={replacement}
                                wordOptions={wordOptions}
                                disabled={disabled}
                                label={`Replacement ${replacementIndex + 1}`}
                                onPatch={(patch) => dispatch({
                                  type: 'update_v2_replacement',
                                  changeIndex,
                                  replacementIndex,
                                  patch,
                                })}
                              />
                              {!disabled ? (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => dispatch({
                                    type: 'remove_v2_replacement',
                                    changeIndex,
                                    replacementIndex,
                                  })}
                                >
                                  Remove replacement
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </EditorCollection>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function compactCueChangePreview(
  change: ProductionCueChangeV2,
  servedCueText: string | null,
): string {
  if (change.kind === 'create') {
    const text = change.cue.text.trim();
    return text.length === 0 ? 'New cue' : text;
  }
  if (change.kind === 'deactivate') {
    const text = servedCueText?.trim() ?? '';
    return text.length === 0 ? 'Served cue' : text;
  }
  const texts = change.replacements
    .map((replacement) => replacement.text.trim())
    .filter((text) => text.length > 0);
  if (texts.length === 0) return 'Replacement cue';
  if (texts.length === 1) return texts[0]!;
  return `${texts[0]} +${texts.length - 1}`;
}

function ProductionCueDraftFields({
  draft,
  wordOptions,
  disabled,
  label,
  onPatch,
}: {
  draft: ProductionCueDraftV2;
  wordOptions: EvidenceWordOption[];
  disabled: boolean;
  label: string;
  onPatch: (patch: Partial<ProductionCueDraftV2>) => void;
}) {
  const cueTypes: ProductionCueDraftV2['cueType'][] = [
    'definition_gloss',
    'minimal_context',
    'circumstance',
  ];
  return (
    <div className="reflection-operation-fields">
      <Field label={`${label} type`}>
        <select
          value={draft.cueType}
          disabled={disabled}
          onChange={(event) => onPatch({
            cueType: event.target.value as ProductionCueDraftV2['cueType'],
          })}
        >
          {cueTypes.map((cueType) => (
            <option value={cueType} key={cueType}>{humanize(cueType)}</option>
          ))}
        </select>
      </Field>
      <Field label={`${label} text`}>
        <textarea
          value={draft.text}
          disabled={disabled}
          onChange={(event) => onPatch({ text: event.target.value })}
        />
      </Field>
      <AcceptedWordChips
        wordOptions={wordOptions}
        acceptedWordIds={draft.acceptedWordIds}
      />
    </div>
  );
}

export function AcceptedWordChips({
  wordOptions,
  acceptedWordIds,
}: {
  wordOptions: EvidenceWordOption[];
  acceptedWordIds: string[];
}) {
  const chips = acceptedWordIds.map((wordId) => (
    wordOptions.find((option) => option.wordId === wordId)
      ?? { wordId, hanzi: wordId, pinyin: '' }
  ));

  if (chips.length === 0) {
    return (
      <div className="reflection-accepted-words">
        <span className="reflection-accepted-words-label">Accepted</span>
        <p className="notes">No accepted answers.</p>
      </div>
    );
  }

  return (
    <div className="reflection-accepted-words">
      <span className="reflection-accepted-words-label">Accepted</span>
      <div className="reflection-accepted-word-chips" aria-label="Accepted words (read-only)">
        {chips.map((option) => (
            <span
              key={option.wordId}
              className="reflection-accepted-word-chip is-accepted"
            >
              {option.pinyin.trim() ? evidenceWordSurfaceLabel(option) : option.hanzi}
            </span>
        ))}
      </div>
    </div>
  );
}

function ContrastClusterEditor({
  operation,
  wordOptions,
  disabled,
  dispatch,
}: {
  operation: CreateContrastClusterOperation;
  wordOptions: EvidenceWordOption[];
  disabled: boolean;
  dispatch: (action: ReflectionOperationDraftAction) => void;
}) {
  return (
    <div className="reflection-operation-fields">
      <Field label="Cluster title">
        <input
          value={operation.title}
          disabled={disabled}
          onChange={(event) => dispatch({
            type: 'set_cluster_title',
            title: event.target.value,
          })}
        />
      </Field>
      <Field label="Cluster note">
        <textarea
          value={operation.clusterNote ?? ''}
          disabled={disabled}
          onChange={(event) => dispatch({
            type: 'set_cluster_note',
            clusterNote: nullableText(event.target.value),
          })}
        />
      </Field>

      <EditorCollection
        title="Members"
        addLabel="Add member"
        disabled={disabled}
        onAdd={() => dispatch({ type: 'add_cluster_member' })}
      >
        {operation.members.map((member, index) => (
          <div className="reflection-editor-row" key={`member-${index}`}>
            <Field label={`Member ${index + 1} ${studyProfile.labels.target}`}>
              <EvidenceWordPicker
                value={member.wordId}
                options={wordOptions}
                excludeWordIds={new Set(
                  operation.members
                    .map((entry) => entry.wordId)
                    .filter((wordId) => wordId.length > 0 && wordId !== member.wordId),
                )}
                disabled={disabled}
                onChange={(wordId) => dispatch({
                  type: 'update_cluster_member',
                  index,
                  patch: { wordId },
                })}
              />
            </Field>
            <Field label="Nuance note">
              <textarea
                value={member.nuanceNote ?? ''}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'update_cluster_member',
                  index,
                  patch: { nuanceNote: nullableText(event.target.value) },
                })}
              />
            </Field>
            {!disabled ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => dispatch({ type: 'remove_cluster_member', index })}
              >
                Remove member
              </button>
            ) : null}
          </div>
        ))}
      </EditorCollection>

      <EditorCollection
        title="Prompts"
        addLabel="Add prompt"
        disabled={disabled}
        onAdd={() => dispatch({ type: 'add_cluster_prompt' })}
      >
        {operation.prompts.map((prompt, index) => (
          <div className="reflection-editor-row" key={`prompt-${index}`}>
            <Field label={`Prompt ${index + 1} target`}>
              <select
                value={prompt.targetWordId}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'update_cluster_prompt',
                  index,
                  patch: { targetWordId: event.target.value },
                })}
              >
                {!operation.members.some((member) => member.wordId === prompt.targetWordId) ? (
                  <option value={prompt.targetWordId}>
                    {surfaceLabelForWord(prompt.targetWordId, wordOptions)}
                  </option>
                ) : null}
                {operation.members.map((member, memberIndex) => (
                  <option value={member.wordId} key={`${member.wordId}-${memberIndex}`}>
                    {member.wordId.length === 0
                      ? `Member ${memberIndex + 1}`
                      : surfaceLabelForWord(member.wordId, wordOptions)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prompt text">
              <textarea
                value={prompt.promptText}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'update_cluster_prompt',
                  index,
                  patch: { promptText: event.target.value },
                })}
              />
            </Field>
            <Field label="Explanation">
              <textarea
                value={prompt.explanation ?? ''}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'update_cluster_prompt',
                  index,
                  patch: { explanation: nullableText(event.target.value) },
                })}
              />
            </Field>
            {!disabled ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => dispatch({ type: 'remove_cluster_prompt', index })}
              >
                Remove prompt
              </button>
            ) : null}
          </div>
        ))}
      </EditorCollection>
    </div>
  );
}

function ProductionCueEditor({
  operation,
  wordOptions,
  disabled,
  dispatch,
}: {
  operation: RepairProductionCueOperationV1;
  wordOptions: EvidenceWordOption[];
  disabled: boolean;
  dispatch: (action: ReflectionOperationDraftAction) => void;
}) {
  const repairIntents: RepairProductionCueOperationV1['repairIntent'][] = [
    'narrow_to_learner_relevant_sense',
    'add_distinguishing_anchor',
    'add_contextual_triangulation',
    'split_overloaded_cue',
  ];
  const cueTypes: RepairProductionCueOperationV1['proposedCues'][number]['cueType'][] = [
    'definition_gloss',
    'cloze',
    'minimal_context',
    'register_or_domain_hint',
  ];

  return (
    <div className="reflection-operation-fields">
      <div className="reflection-two-column-fields">
        <Field label={studyProfile.labels.target}>
          <EvidenceWordPicker
            value={operation.wordId}
            options={wordOptions}
            disabled={disabled}
            onChange={(wordId) => dispatch({
              type: 'set_cue_word',
              wordId,
            })}
          />
        </Field>
        <Field label="Repair intent">
          <select
            value={operation.repairIntent}
            disabled={disabled}
            onChange={(event) => dispatch({
              type: 'set_repair_intent',
              repairIntent: event.target.value as RepairProductionCueOperationV1['repairIntent'],
            })}
          >
            {repairIntents.map((intent) => (
              <option value={intent} key={intent}>{humanize(intent)}</option>
            ))}
          </select>
        </Field>
      </div>
      <EditorCollection
        title="Replacement cues"
        addLabel="Add cue"
        disabled={disabled}
        onAdd={() => dispatch({ type: 'add_replacement_cue' })}
      >
        {operation.proposedCues.map((cue, index) => (
          <div className="reflection-editor-row" key={`cue-${index}`}>
            <Field label={`Cue ${index + 1} type`}>
              <select
                value={cue.cueType}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'update_replacement_cue',
                  index,
                  patch: {
                    cueType: event.target.value as RepairProductionCueOperationV1['proposedCues'][number]['cueType'],
                  },
                })}
              >
                {cueTypes.map((cueType) => (
                  <option value={cueType} key={cueType}>{humanize(cueType)}</option>
                ))}
              </select>
            </Field>
            <Field label="Cue text">
              <textarea
                value={cue.text}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'update_replacement_cue',
                  index,
                  patch: { text: event.target.value },
                })}
              />
            </Field>
            {!disabled ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => dispatch({ type: 'remove_replacement_cue', index })}
              >
                Remove cue
              </button>
            ) : null}
          </div>
        ))}
      </EditorCollection>
    </div>
  );
}

function EvidenceWordPicker({
  value,
  options,
  excludeWordIds = new Set(),
  disabled,
  onChange,
}: {
  value: string;
  options: EvidenceWordOption[];
  excludeWordIds?: ReadonlySet<string>;
  disabled: boolean;
  onChange: (wordId: string) => void;
}) {
  const visibleOptions = options.filter((option) => (
    option.wordId === value || !excludeWordIds.has(option.wordId)
  ));
  const valueInOptions = visibleOptions.some((option) => option.wordId === value);

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {value.length === 0 || valueInOptions ? (
        <option value="">Select {studyProfile.labels.target}</option>
      ) : (
        <option value={value}>{surfaceLabelForWord(value, options)}</option>
      )}
      {visibleOptions.map((option) => (
        <option value={option.wordId} key={option.wordId}>
          {evidenceWordSurfaceLabel(option)}
        </option>
      ))}
    </select>
  );
}

function surfaceLabelForWord(wordId: string, options: EvidenceWordOption[]): string {
  const match = options.find((option) => option.wordId === wordId);
  return match === undefined ? wordId : evidenceWordSurfaceLabel(match);
}

function EditorCollection({
  title,
  addLabel,
  disabled,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  disabled: boolean;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="reflection-editor-collection">
      <div className="reflection-section-heading">
        <h5>{title}</h5>
        {!disabled ? (
          <button type="button" className="secondary-button" onClick={onAdd}>
            {addLabel}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="reflection-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function nullableText(value: string): string | null {
  return value.length === 0 ? null : value;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}
