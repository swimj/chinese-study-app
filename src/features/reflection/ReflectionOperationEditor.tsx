import type {
  CreateContrastClusterOperationV1,
  ReflectionOperation,
  RepairProductionCueOperationV1,
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

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}
