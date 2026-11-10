import { useEffect, useState } from 'react';
import type { VocabularyFallbackGenerationInput, VocabularyFallbackRepertoire } from '../../domain/vocabulary-case-queue';
import type { VocabularyOperatorApi, VocabularyReassessmentModel } from './api';

type Props = {
  api: VocabularyOperatorApi;
  caseId: string;
  caseVersion: number;
  disabled: boolean;
  onGenerate: (input: VocabularyFallbackGenerationInput, model: VocabularyReassessmentModel) => void;
};

export function FallbackRepertoireReview(props: Props) {
  const [open, setOpen] = useState(false);
  return <details className="vocabulary-sense-coverage" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Review repertoire</summary>
    {open && <RepertoireSelection {...props}/>}
  </details>;
}

function RepertoireSelection({api, caseId, caseVersion, disabled, onGenerate}: Props) {
  const [repertoire, setRepertoire] = useState<VocabularyFallbackRepertoire | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [model, setModel] = useState<VocabularyReassessmentModel>('openai:gpt-6-sol-high');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    setRepertoire(null);
    setError('');
    void api.fallbackRepertoire(caseId).then(value => {
      if (!current) return;
      setRepertoire(value);
      setSelected(value.defaultSenseIds);
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : 'Could not load the repertoire.');
    });
    return () => { current = false; };
  }, [api, caseId, caseVersion, reload]);

  if (error) return <p role="alert">{error} <button onClick={() => setReload(value => value + 1)}>Retry</button></p>;
  if (!repertoire) return <p role="status">Loading repertoire…</p>;

  const other = repertoire.exercises.filter(exercise => !repertoire.senses.some(sense => sense.senseId === exercise.senseId));
  return <form onSubmit={event => {
    event.preventDefault();
    if (disabled || !selected.length) return;
    onGenerate({
      expectedVersion: caseVersion, expectedContentVersion: repertoire.sourceVersion,
      expectedCatalogVersion: repertoire.catalogVersion, expectedWordVersion: repertoire.wordVersion,
      senseIds: selected,
    }, model);
  }}>
    <fieldset disabled={disabled}>
      <legend>Senses for generation</legend>
      {repertoire.senses.map(sense => {
        const exercises = repertoire.exercises.filter(exercise => exercise.senseId === sense.senseId);
        return <div className="vocabulary-sense-group" key={sense.senseId}>
          <label className="vocabulary-action-checkbox"><input type="checkbox" checked={selected.includes(sense.senseId)} onChange={event => {
            setSelected(event.currentTarget.checked ? [...selected, sense.senseId] : selected.filter(id => id !== sense.senseId));
          }}/><span>{sense.label}{repertoire.defaultSenseIds.includes(sense.senseId) && <small> · Default</small>}</span></label>
          {exercises.length ? <details><summary>{exercises.length} published {exercises.length === 1 ? 'exercise' : 'exercises'}</summary>
            <ul>{exercises.map(exercise => <li key={exercise.contentId}>{exercise.prompt}</li>)}</ul>
          </details> : <p className="vocabulary-operator-meta">No published exercises</p>}
        </div>;
      })}
    </fieldset>
    {other.length > 0 && <details><summary>Other published exercises ({other.length})</summary>
      <ul>{other.map(exercise => <li key={exercise.contentId}>{exercise.prompt}</li>)}</ul>
    </details>}
    <div className="vocabulary-operator-actions">
      <label>Model <select value={model} disabled={disabled} onChange={event => setModel(event.target.value as VocabularyReassessmentModel)}>
        <option value="openai:gpt-6-sol-high">GPT-6 Sol high</option>
        <option value="openai:gpt-6-luna-high">Luna high</option>
        <option value="zai:glm-5.3-flash-high">GLM-5.3 Flash high</option>
      </select></label>
      <button disabled={disabled || !selected.length}>Generate for selected</button>
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => setReload(value => value + 1)}>Reload repertoire</button>
    </div>
  </form>;
}
