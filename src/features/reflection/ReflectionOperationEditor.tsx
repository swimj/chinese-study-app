import { useState } from 'react';
import type {
  CreateContrastClusterOperation,
  ProductionCueChangeV2,
  ProductionCueDraftV2,
  ReflectionInputItemV1,
  ReflectionInputItemV2,
  ReflectionItemV3,
  ReflectionItemV5,
  ReflectionOperation,
  PromotePureElicitationOperationV1,
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
  onChange,
}: {
  operation: ReflectionOperation;
  evidence?: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | ReflectionItemV5 | null;
  disabled?: boolean;
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
    case 'suppress_definition_production':
      return (
        <div className="reflection-operation-fields">
          <Field label={studyProfile.labels.target}>
            <EvidenceWordPicker
              value={operation.wordId}
              options={wordOptions}
              disabled={disabled}
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
    case 'promote_pure_elicitation':
      return (
        <PureElicitationPromotionEditor
          operation={operation}
          evidence={evidence}
          wordOptions={wordOptions}
          disabled={disabled}
          dispatch={dispatch}
        />
      );
  }
}

function PureElicitationPromotionEditor({
  operation,
  evidence,
  wordOptions,
  disabled,
  dispatch,
}: {
  operation: PromotePureElicitationOperationV1;
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | ReflectionItemV5 | null;
  wordOptions: EvidenceWordOption[];
  disabled: boolean;
  dispatch: (action: ReflectionOperationDraftAction) => void;
}) {
  const promotionEvidence = evidence !== null && 'promotionEvidence' in evidence
    ? evidence.promotionEvidence
    : null;
  const pureCues = promotionEvidence?.intersectingPureCues ?? [];
  const wordEvidence = new Map(
    (promotionEvidence?.words ?? []).map((word) => [word.wordId, word]),
  );
  const wordLabel = (wordId: string) => {
    const option = wordOptions.find((word) => word.wordId === wordId);
    return option === undefined ? wordId : evidenceWordSurfaceLabel(option);
  };
  const cueTypes = ['definition_gloss', 'minimal_context', 'circumstance'] as const;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const changeCount = 1 + operation.wordPlans.length;

  function toggleExpanded(key: string) {
    setExpandedKey((current) => (current === key ? null : key));
  }

  return (
    <div className="reflection-operation-fields">
      <p className="notes">
        {wordLabel(operation.targetWordId)} ↔ {wordLabel(operation.responseWordId)}
      </p>
      <section className="reflection-cue-change-list" aria-label="Promotion changes">
        <div className="reflection-cue-change-heading">
          <span className="reflection-cue-change-count">
            {changeCount} change{changeCount === 1 ? '' : 's'}
          </span>
        </div>
        <ul className="reflection-cue-change-items">
          <li
            className={
              expandedKey === 'destination'
                ? 'reflection-cue-change-item is-expanded'
                : 'reflection-cue-change-item'
            }
          >
            <div className="reflection-cue-change-row">
              <span
                className="reflection-cue-change-kind kind-replace"
                title={operation.destination.kind === 'existing' ? 'Extend' : 'Create'}
                aria-hidden="true"
              />
              <button
                type="button"
                className="reflection-cue-change-preview"
                aria-expanded={expandedKey === 'destination'}
                aria-label={`Destination: ${compactPromotionDestinationPreview(operation, pureCues)}`}
                onClick={() => toggleExpanded('destination')}
              >
                {compactPromotionDestinationPreview(operation, pureCues)}
              </button>
            </div>
            {expandedKey === 'destination' ? (
              <div className="reflection-cue-change-detail">
                <Field label="Pure elicitation destination">
                  <select
                    value={operation.destination.kind}
                    disabled={disabled}
                    onChange={(event) => dispatch({
                      type: 'set_promotion_destination',
                      destination: event.target.value === 'existing' && pureCues[0] !== undefined
                        ? { kind: 'existing', pureCueId: pureCues[0].id }
                        : { kind: 'create', stimulus: '', axisNote: '' },
                    })}
                  >
                    <option value="create">Create new pure elicitation</option>
                    <option value="existing" disabled={pureCues.length === 0}>
                      Extend existing pure elicitation
                    </option>
                  </select>
                </Field>
                {operation.destination.kind === 'existing' ? (
                  <Field label="Existing pure elicitation">
                    <select
                      value={operation.destination.pureCueId}
                      disabled={disabled}
                      onChange={(event) => dispatch({
                        type: 'set_promotion_destination',
                        destination: { kind: 'existing', pureCueId: event.target.value },
                      })}
                    >
                      {pureCues.map((cue) => (
                        <option value={cue.id} key={cue.id}>
                          {cue.stimulus}{cue.axisNote ? ` — ${cue.axisNote}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <>
                    <Field label="Shared elicitation stimulus">
                      <textarea
                        value={operation.destination.stimulus}
                        disabled={disabled}
                        onChange={(event) => dispatch({
                          type: 'set_promotion_destination',
                          destination: {
                            kind: 'create',
                            stimulus: event.target.value,
                            axisNote: operation.destination.kind === 'create'
                              ? operation.destination.axisNote
                              : '',
                          },
                        })}
                      />
                    </Field>
                    <Field label="Semantic axis note">
                      <textarea
                        value={operation.destination.axisNote}
                        disabled={disabled}
                        onChange={(event) => dispatch({
                          type: 'set_promotion_destination',
                          destination: {
                            kind: 'create',
                            stimulus: operation.destination.kind === 'create'
                              ? operation.destination.stimulus
                              : '',
                            axisNote: event.target.value,
                          },
                        })}
                      />
                    </Field>
                  </>
                )}
              </div>
            ) : null}
          </li>
          {operation.wordPlans.map((plan) => {
            const activeCues = wordEvidence.get(plan.wordId)?.activeProductionCues ?? [];
            const rowKey = `word:${plan.wordId}`;
            const expanded = expandedKey === rowKey;
            const preview = compactPromotionWordPlanPreview(
              plan,
              wordLabel(plan.wordId),
              activeCues,
            );
            return (
              <li
                className={expanded ? 'reflection-cue-change-item is-expanded' : 'reflection-cue-change-item'}
                key={plan.wordId}
              >
                <div className="reflection-cue-change-row">
                  <span
                    className={`reflection-cue-change-kind ${
                      plan.deactivateCueIds.length > 0 ? 'kind-deactivate' : 'kind-create'
                    }`}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="reflection-cue-change-preview"
                    aria-expanded={expanded}
                    aria-label={preview}
                    onClick={() => toggleExpanded(rowKey)}
                  >
                    {preview}
                  </button>
                </div>
                {expanded ? (
                  <div className="reflection-cue-change-detail">
                    <strong>Deactivate broad word-owned cues</strong>
                    {activeCues.length === 0 ? (
                      <p className="notes">No active cues in the saved evidence.</p>
                    ) : (
                      activeCues.map((cue) => (
                        <label key={cue.cueId}>
                          <input
                            type="checkbox"
                            checked={plan.deactivateCueIds.includes(cue.cueId)}
                            disabled={disabled}
                            onChange={() => dispatch({
                              type: 'toggle_promotion_deactivation',
                              wordId: plan.wordId,
                              cueId: cue.cueId,
                            })}
                          />{' '}
                          {cue.text} ({cue.acceptedWordIds.length} accepted)
                        </label>
                      ))
                    )}
                    <EditorCollection
                      title="Distinctive single-word cues"
                      addLabel="Add distinctive cue"
                      disabled={disabled}
                      onAdd={() => dispatch({ type: 'add_promotion_distinctive_cue', wordId: plan.wordId })}
                    >
                      {plan.distinctiveCueDrafts.map((draft, index) => (
                        <div className="reflection-editor-row" key={`${plan.wordId}-draft-${index}`}>
                          <Field label={`Cue ${index + 1} type`}>
                            <select
                              value={draft.cueType}
                              disabled={disabled}
                              onChange={(event) => dispatch({
                                type: 'update_promotion_distinctive_cue',
                                wordId: plan.wordId,
                                index,
                                patch: { cueType: event.target.value as typeof cueTypes[number] },
                              })}
                            >
                              {cueTypes.map((cueType) => (
                                <option value={cueType} key={cueType}>{humanize(cueType)}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Cue text">
                            <textarea
                              value={draft.text}
                              disabled={disabled}
                              onChange={(event) => dispatch({
                                type: 'update_promotion_distinctive_cue',
                                wordId: plan.wordId,
                                index,
                                patch: { text: event.target.value },
                              })}
                            />
                          </Field>
                          {!disabled ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => dispatch({
                                type: 'remove_promotion_distinctive_cue',
                                wordId: plan.wordId,
                                index,
                              })}
                            >
                              Remove cue
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </EditorCollection>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function compactPromotionDestinationPreview(
  operation: PromotePureElicitationOperationV1,
  pureCues: ReadonlyArray<{ id: string; stimulus: string; axisNote: string }>,
): string {
  if (operation.destination.kind === 'existing') {
    const { pureCueId } = operation.destination;
    const cue = pureCues.find((item) => item.id === pureCueId);
    const stimulus = cue?.stimulus.trim() ?? pureCueId;
    const axisNote = cue?.axisNote.trim() ?? '';
    return axisNote.length === 0 ? stimulus : `${stimulus} — ${axisNote}`;
  }
  const stimulus = operation.destination.stimulus.trim();
  const axisNote = operation.destination.axisNote.trim();
  const head = stimulus.length === 0 ? 'New elicitation' : stimulus;
  return axisNote.length === 0 ? head : `${head} — ${axisNote}`;
}

function compactPromotionWordPlanPreview(
  plan: PromotePureElicitationOperationV1['wordPlans'][number],
  label: string,
  activeCues: ReadonlyArray<{ cueId: string; text: string; acceptedWordIds: string[] }>,
): string {
  const parts: string[] = [];
  const deactivated = plan.deactivateCueIds.map((cueId) => {
    const cue = activeCues.find((item) => item.cueId === cueId);
    if (cue === undefined) return cueId;
    return `${cue.text} (${cue.acceptedWordIds.length} accepted)`;
  });
  if (deactivated.length > 0) parts.push(deactivated.join(', '));
  const drafts = plan.distinctiveCueDrafts
    .map((draft) => draft.text.trim())
    .filter((text) => text.length > 0);
  if (drafts.length === 1) parts.push(drafts[0]!);
  else if (drafts.length > 1) parts.push(`${drafts[0]} +${drafts.length - 1}`);
  else if (plan.distinctiveCueDrafts.length > 0) parts.push('New distinctive cue');
  if (parts.length === 0) return `${label} · no cue changes`;
  return `${label} · ${parts.join(' · ')}`;
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
