import type {
  CreateContrastClusterOperationV1,
  ProductionCueDraftV2,
  ReflectionOperation,
  RepairProductionCueOperationV1,
  RepairProductionCueOperationV2,
} from '../../domain/reflection';
import {
  reduceReflectionOperationDraft,
  type ReflectionOperationDraftAction,
} from './reflection-page-model';

export function ReflectionOperationEditor({
  operation,
  disabled = false,
  onChange,
}: {
  operation: ReflectionOperation;
  disabled?: boolean;
  onChange?: (operation: ReflectionOperation) => void;
}) {
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
          <Field label="Word id">
            <input
              value={operation.wordId}
              disabled={disabled}
              onChange={(event) => dispatch({
                type: 'set_suppression_word',
                wordId: event.target.value,
              })}
            />
          </Field>
        </div>
      );
    case 'create_contrast_cluster':
      return (
        <ContrastClusterEditor
          operation={operation}
          disabled={disabled}
          dispatch={dispatch}
        />
      );
    case 'repair_production_cue':
      if (operation.version === 2) {
        return (
          <ProductionCueEditorV2
            operation={operation}
            disabled={disabled}
            dispatch={dispatch}
          />
        );
      }
      return (
        <ProductionCueEditor
          operation={operation}
          disabled={disabled}
          dispatch={dispatch}
        />
      );
    case 'accept_production_alternate':
      return (
        <div className="reflection-operation-fields reflection-two-column-fields">
          <Field label="Target word id">
            <input
              value={operation.targetWordId}
              disabled={disabled}
              onChange={(event) => dispatch({
                type: 'set_alternate_target',
                targetWordId: event.target.value,
              })}
            />
          </Field>
          <Field label="Accepted alternate word id">
            <input
              value={operation.alternateWordId}
              disabled={disabled}
              onChange={(event) => dispatch({
                type: 'set_alternate_word',
                alternateWordId: event.target.value,
              })}
            />
          </Field>
        </div>
      );
  }
}

function ProductionCueEditorV2({
  operation,
  disabled,
  dispatch,
}: {
  operation: RepairProductionCueOperationV2;
  disabled: boolean;
  dispatch: (action: ReflectionOperationDraftAction) => void;
}) {
  const changeKinds = ['create', 'replace', 'deactivate'] as const;
  const judgmentKinds = [
    'accepted_answer_space_omission',
    'misleading_or_overloaded_cue',
  ] as const;

  return (
    <div className="reflection-operation-fields">
      <div className="reflection-two-column-fields">
        <Field label="Word id">
          <input value={operation.wordId} disabled />
        </Field>
        <Field label="Production task id">
          <input value={operation.taskId} disabled />
        </Field>
      </div>

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
                disabled={disabled}
                label="Created cue"
                onPatch={(patch) => dispatch({
                  type: 'update_v2_create_cue',
                  changeIndex,
                  patch,
                })}
              />
            ) : (
              <Field label="Referenced cue id">
                <input
                  value={change.cueId}
                  disabled={disabled}
                  onChange={(event) => dispatch({
                    type: 'set_v2_cue_change_id',
                    index: changeIndex,
                    cueId: event.target.value,
                  })}
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

      <EditorCollection
        title="Source-attempt judgments"
        addLabel="Add judgment"
        disabled={disabled}
        onAdd={() => dispatch({ type: 'add_v2_cue_judgment' })}
      >
        {operation.sourceAttemptJudgments.map((judgment, index) => (
          <div className="reflection-editor-row" key={`judgment-${index}`}>
            <Field label={`Judgment ${index + 1} kind`}>
              <select
                value={judgment.kind}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'set_v2_cue_judgment_kind',
                  index,
                  kind: event.target.value as typeof judgmentKinds[number],
                })}
              >
                {judgmentKinds.map((kind) => (
                  <option value={kind} key={kind}>{humanize(kind)}</option>
                ))}
              </select>
            </Field>
            <Field label="Source attempt id">
              <input
                value={judgment.sourceAttemptId}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'set_v2_cue_judgment_attempt',
                  index,
                  sourceAttemptId: event.target.value,
                })}
              />
            </Field>
            {judgment.kind === 'accepted_answer_space_omission' ? (
              <Field label="Submitted word id">
                <input
                  value={judgment.submittedWordId}
                  disabled={disabled}
                  onChange={(event) => dispatch({
                    type: 'set_v2_cue_judgment_word',
                    index,
                    submittedWordId: event.target.value,
                  })}
                />
              </Field>
            ) : null}
            {!disabled ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => dispatch({ type: 'remove_v2_cue_judgment', index })}
              >
                Remove judgment
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
  disabled,
  label,
  onPatch,
}: {
  draft: ProductionCueDraftV2;
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
      <Field label={`${label} accepted word ids (comma or newline separated)`}>
        <textarea
          value={draft.acceptedWordIds.join('\n')}
          disabled={disabled}
          onChange={(event) => onPatch({
            acceptedWordIds: parseWordIdList(event.target.value),
          })}
        />
      </Field>
    </div>
  );
}

function ContrastClusterEditor({
  operation,
  disabled,
  dispatch,
}: {
  operation: CreateContrastClusterOperationV1;
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
            <Field label={`Member ${index + 1} word id`}>
              <input
                value={member.wordId}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'update_cluster_member',
                  index,
                  patch: { wordId: event.target.value },
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
                  <option value={prompt.targetWordId}>{prompt.targetWordId}</option>
                ) : null}
                {operation.members.map((member, memberIndex) => (
                  <option value={member.wordId} key={`${member.wordId}-${memberIndex}`}>
                    {member.wordId || `Member ${memberIndex + 1}`}
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
  disabled,
  dispatch,
}: {
  operation: RepairProductionCueOperationV1;
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
        <Field label="Word id">
          <input
            value={operation.wordId}
            disabled={disabled}
            onChange={(event) => dispatch({
              type: 'set_cue_word',
              wordId: event.target.value,
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

function parseWordIdList(value: string): string[] {
  return value.split(/[\n,]/).map((wordId) => wordId.trim()).filter((wordId) => wordId.length > 0);
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}
