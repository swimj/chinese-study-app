import type { ReactNode } from 'react';

/** Shared Home entry chrome; each runtime supplies its readiness and statistics. */
export function SessionStartCard(props: {
  label: ReactNode; helper: ReactNode; helperTitle?: string;
  disabled: boolean; settingsOpen: boolean; settingsSaving: boolean;
  guideToSettings: boolean; settingsTitle?: string;
  onStart: () => void; onToggleSettings: () => void;
}) {
  return <div className={`session-start-shell${props.settingsOpen ? ' is-settings-open' : ''}`}>
    <button type="button" className="session-start-card" disabled={props.disabled} onClick={props.onStart}>
      <span className="session-start-card-label">{props.label}</span>
      <span className="session-start-card-helper" title={props.helperTitle}>{props.helper}</span>
    </button>
    <button type="button" className={`session-settings-gear${props.guideToSettings && !props.settingsOpen ? ' getting-started-attention' : ''}`}
      title={props.settingsTitle ?? 'Session settings'} aria-label="Session settings" aria-expanded={props.settingsOpen}
      aria-controls="session-settings-panel" disabled={props.settingsSaving} onClick={props.onToggleSettings}>
      <SettingsGearIcon />
    </button>
  </div>;
}

export function SettingsGearIcon() {
  return (
    <svg
      className="session-settings-gear-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
      />
    </svg>
  );
}

