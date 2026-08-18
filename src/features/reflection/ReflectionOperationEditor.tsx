import type {
  CreateContrastClusterOperation,
  ProductionCueDraftV2,
  ReflectionInputItemV1,
  ReflectionInputItemV2,
  ReflectionItemV3,
  ReflectionOperation,
  RepairProductionCueOperationV1,
  RepairProductionCueOperationV2,
} from '../../domain/reflection';
import { studyProfile } from '../../study-profile';
import {
  collectEvidenceWordOptions,
  evidenceWordSurfaceLabel,
  reduceReflectionOperationDraft,
  servedCueDisplayText,
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
  evidence?: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null;
  disabled?: boolean;
  onChange?: (operation: ReflectionOperation) => void;
}) {
  const wordOptions = collectEvidenceWordOptions(evidence);
  const servedCueText = servedCueDisplayText(evidence);
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
  }
}

function ProductionCueEditorV2({
  operation,
  wordOptions,
  servedCueText,
  lockedTargetWordId,
  disabled,
  dispatch,
}: {
  operation: RepairProductionCueOperationV2;
  wordOptions: EvidenceWordOption[];
  servedCueText: string | null;
  lockedTargetWordId: string | null;
  disabled: boolean;
  dispatch: (action: ReflectionOperationDraftAction) => void;
}) {
  const changeKinds = ['create', 'replace', 'deactivate'] as const;
  const targetOption = wordOptions.find((option) => option.wordId === operation.wordId)
    ?? (operation.wordId.length === 0
      ? null
      : { wordId: operation.wordId, hanzi: operation.wordId, pinyin: '' });

  return (
    <div className="reflection-operation-fields">
      <Field label={studyProfile.labels.target}>
        <input
          value={targetOption === null ? '' : evidenceWordSurfaceLabel(targetOption)}
          disabled
          readOnly
          aria-label={studyProfile.labels.target}
        />
      </Field>
      {lockedTargetWordId !== null && operation.wordId !== lockedTargetWordId ? (
        <p className="notes" role="status">
          Cue repair is locked to the evidence target.
        </p>
      ) : null}

      <EditorCollection
        title="Cue lifecycle changes"
        addLabel="Add change"
        disabled={disabled}
        onAdd={() => dispatch({ type: 'add_v2_cue_change' })}
      >
        {operation.changes.map((change, changeIndex) => (
          <div className="reflection-editor-row" key={`change-${changeIndex}`}>
            <Field label={`Change ${changeIndex + 1} kind`}>
              <select
                value={change.kind}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'set_v2_cue_change_kind',
                  index: changeIndex,
                  kind: event.target.value as typeof changeKinds[number],
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
                label="Created cue"
                onPatch={(patch) => dispatch({
                  type: 'update_v2_create_cue',
                  changeIndex,
                  patch,
                })}
              />
            ) : (
              <Field label="Served cue">
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

            {!disabled ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => dispatch({ type: 'remove_v2_cue_change', index: changeIndex })}
              >
                Remove change
              </button>
            ) : null}
          </div>
        ))}
      </EditorCollection>
    </div>
  );
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
      <EditorCollection
        title={`${label} accepted ${studyProfile.labels.target}`}
        addLabel="Add word"
        disabled={disabled || wordOptions.every((option) => draft.acceptedWordIds.includes(option.wordId))}
        onAdd={() => {
          const next = wordOptions.find((option) => !draft.acceptedWordIds.includes(option.wordId));
          if (next === undefined) return;
          onPatch({ acceptedWordIds: [...draft.acceptedWordIds, next.wordId] });
        }}
      >
        {draft.acceptedWordIds.map((wordId, index) => (
          <div className="reflection-editor-row" key={`accepted-${wordId}-${index}`}>
            <Field label={studyProfile.labels.target}>
              <EvidenceWordPicker
                value={wordId}
                options={wordOptions}
                excludeWordIds={new Set(draft.acceptedWordIds.filter((id) => id !== wordId))}
                disabled={disabled}
                onChange={(nextWordId) => {
                  const next = [...draft.acceptedWordIds];
                  next[index] = nextWordId;
                  onPatch({ acceptedWordIds: next });
                }}
              />
            </Field>
            {!disabled ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onPatch({
                  acceptedWordIds: draft.acceptedWordIds.filter((_, wordIndex) => wordIndex !== index),
                })}
              >
                Remove word
              </button>
            ) : null}
          </div>
        ))}
      </EditorCollection>
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
