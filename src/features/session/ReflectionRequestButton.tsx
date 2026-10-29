import type { ReactNode } from 'react';

export function ReflectionRequestButton({
  requested,
  disabled,
  onToggle,
  children,
}: {
  requested: boolean;
  disabled: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const label = requested ? 'Feedback requested' : 'Request feedback';

  return (
    <button
      type="button"
      className="secondary-button reflection-request-button"
      title={requested ? 'Remove your post-session feedback request' : 'Include this exercise in your post-session feedback'}
      aria-pressed={requested}
      aria-keyshortcuts="R"
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="reflection-request-faces">
        <span className="reflection-request-face">{label}</span>
        <span className="reflection-request-face reflection-request-fill" aria-hidden="true">{label}</span>
      </span>
      {children}
    </button>
  );
}
