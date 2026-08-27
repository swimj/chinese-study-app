import { useRef, type RefObject } from 'react';
import { useSessionDialogFocus } from './session-dialog-focus';

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
  const containerRef = useRef<HTMLDivElement>(null);
  useSessionDialogFocus({
    open: true,
    containerRef,
    initialFocusRef: inputRef,
    onClose: onCancel,
    closeEnabled: !isSaving,
  });

  return (
    <div
      ref={containerRef}
      className="definition-editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit personal notes"
    >
      <div className="definition-editor-header">
        <strong>Edit personal notes</strong>
        <span className="notes">Applies immediately and persists to backend. Escape closes. Control-Enter saves.</span>
      </div>
      <textarea
        ref={inputRef}
        className="definition-editor-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
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
