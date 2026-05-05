import type { RefObject } from 'react';

export function PersonalNotesEditorOverlay({
  inputRef,
  value,
  isSaving,
  error,
  canSubmit,
  onChange,
  onCancel,
  onSave,
}: {
  inputRef: RefObject<HTMLTextAreaElement>;
  value: string;
  isSaving: boolean;
  error: string | null;
  canSubmit: boolean;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="definition-editor-overlay" role="dialog" aria-modal="true" aria-label="Edit personal notes">
      <div className="definition-editor-header">
        <strong>Edit personal notes</strong>
        <span className="notes">Applies immediately and persists to backend.</span>
      </div>
      <textarea
        ref={inputRef}
        className="definition-editor-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isSaving) {
            event.preventDefault();
            onCancel();
            return;
          }

          if (event.key === 'Enter' && event.ctrlKey && canSubmit) {
            event.preventDefault();
            onSave();
          }
        }}
        disabled={isSaving}
        autoFocus
        rows={4}
      />
      {error ? <p className="notes definition-editor-error">{error}</p> : null}
      <div className="definition-editor-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={!canSubmit}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
