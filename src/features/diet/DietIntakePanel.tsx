import type { DietIntakeInput, DietSelfSelect } from '../../services/api';
import type { DietIntakeSubmissionState } from './diet-intake-submission';

/**
 * First-run placement intake (SPECS/diet-deck-distribution.md §2.5).
 * Delivered through the app's card-style interaction grammar; answers are
 * profile evidence, never study actions. The deck machinery is never
 * mentioned — the learner just knows they are being assessed.
 */

const INTAKE_PROMPTS = [
  { id: 'background', prompt: 'What is your background with Chinese?' },
  { id: 'goals', prompt: 'What do you want to be able to do with it?' },
] as const;

const SELF_SELECT_OPTIONS: Array<{ value: DietSelfSelect; label: string }> = [
  { value: 'complete-beginner', label: 'Complete beginner' },
  { value: 'some-basics', label: 'Some basics' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced-or-heritage', label: 'Advanced / heritage' },
];

export function DietIntakePanel({
  submitting,
  submission,
  drafts,
  selfSelect,
  onDraftsChange,
  onSelfSelectChange,
  onAssess,
  onSubmitManual,
  onRetryRefresh,
}: {
  submitting: boolean;
  submission: DietIntakeSubmissionState;
  drafts: Record<string, string>;
  selfSelect: DietSelfSelect | null;
  onDraftsChange: (drafts: Record<string, string>) => void;
  onSelfSelectChange: (value: DietSelfSelect | null) => void;
  onAssess: (input: Pick<DietIntakeInput, 'answers'>) => void;
  onSubmitManual: (input: DietIntakeInput) => void;
  onRetryRefresh: () => void;
}) {
  const placementLocked = submitting || submission.phase === 'refresh-error';
  const answers = buildDietIntakeAnswers(drafts);
  const savedButRefreshFailed = submission.phase === 'refresh-error';

  return (
    <div className="panel diet-intake-panel" role="dialog" aria-label="A few questions before your first session">
      <h2>Before your first session</h2>
      <p className="notes">
        A couple of quick questions can help choose a sensible place to start. Your answers will be sent to the
        configured AI provider, which will assess and set your starting point. You can also choose it yourself.
      </p>
      {INTAKE_PROMPTS.map(({ id, prompt }) => (
        <label key={id} className="diet-intake-field">
          <span className="diet-intake-prompt">{prompt}</span>
          <textarea
            className="diet-intake-answer"
            rows={2}
            disabled={placementLocked}
            value={drafts[id] ?? ''}
            onChange={(event) => onDraftsChange({ ...drafts, [id]: event.target.value })}
          />
        </label>
      ))}
      <div className="diet-intake-self-select" role="group" aria-label="Roughly where are you?">
        {SELF_SELECT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`diet-chip${selfSelect === option.value ? ' diet-chip-selected' : ''}`}
            disabled={placementLocked}
            aria-pressed={selfSelect === option.value}
            onClick={() => onSelfSelectChange(selfSelect === option.value ? null : option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {submission.error ? <p className="form-error" role="alert">{submission.error}</p> : null}
      <div className="diet-intake-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={placementLocked}
          onClick={() => onSubmitManual({ answers: [], selfSelect: null })}
        >
          Skip — start from the beginning
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={placementLocked || selfSelect === null}
          onClick={() => onSubmitManual({ answers, selfSelect })}
        >
          Set my starting point myself
        </button>
        <button
          type="button"
          disabled={placementLocked || answers.length === 0}
          onClick={() => onAssess({ answers })}
        >
          {submission.phase === 'assessing'
            ? 'Assessing...'
            : submission.phase === 'refreshing'
              ? 'Refreshing session...'
              : 'Assess and set my starting point'}
        </button>
      </div>
      {savedButRefreshFailed ? (
        <button type="button" disabled={submitting} onClick={onRetryRefresh}>
          Retry session refresh
        </button>
      ) : null}
    </div>
  );
}

export function buildDietIntakeAnswers(drafts: Record<string, string>): DietIntakeInput['answers'] {
  return INTAKE_PROMPTS
    .map(({ id, prompt }) => ({ prompt, answer: (drafts[id] ?? '').trim() }))
    .filter((answer) => answer.answer.length > 0);
}
