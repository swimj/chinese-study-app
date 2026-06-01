import type { ReactNode } from 'react';

export type AppPageKey = 'home' | 'priority' | 'intake';

export function AppChrome({
  currentPage,
  error,
  version,
  sessionActive,
  priorityPageLoading,
  intakePageLoading,
  children,
  onOpenHomePage,
  onOpenPriorityPage,
  onOpenIntakePage,
}: {
  currentPage: AppPageKey;
  error: string | null;
  version: string;
  sessionActive: boolean;
  priorityPageLoading: boolean;
  intakePageLoading: boolean;
  children: ReactNode;
  onOpenHomePage: () => void;
  onOpenPriorityPage: () => void;
  onOpenIntakePage: () => void;
}) {
  const navigationLoading = priorityPageLoading || intakePageLoading;

  return (
    <div className={sessionActive ? 'container app-session-active' : 'container'}>
      <nav className="navbar" aria-label="Primary">
        <div className="nav-brand">
          <strong>法华挣路</strong>
          <span>add french support, flexible skill architecture· v{version}</span>
        </div>
        <div className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${currentPage === 'home' ? 'active' : ''}`}
            onClick={onOpenHomePage}
            disabled={navigationLoading}
          >
            Home
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPage === 'priority' ? 'active' : ''}`}
            onClick={onOpenPriorityPage}
            disabled={navigationLoading}
          >
            {priorityPageLoading ? 'Loading priority...' : 'Priority'}
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPage === 'intake' ? 'active' : ''}`}
            onClick={onOpenIntakePage}
            disabled={navigationLoading}
          >
            {intakePageLoading ? 'Loading intake...' : 'Intake'}
          </button>
        </div>
      </nav>

      {error ? (
        <div className="panel">
          <h2>Error</h2>
          <p className="notes">{error}</p>
        </div>
      ) : null}

      {children}

      <footer className="footer">
        v{version} ·  if you are reading this then you are a top learner &#59;&#41;
      </footer>
    </div>
  );
}
