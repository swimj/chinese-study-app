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
  const label = requested ? 'Remove reflection request' : 'Ask reflection to review';

  return (
    <button
      type="button"
      className="secondary-button reflection-request-button"
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
