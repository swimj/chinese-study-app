import type { ReactNode } from 'react';

export type AppPageKey = 'home' | 'words' | 'priority';

export function AppChrome({
  currentPage,
  error,
  version,
  wordsPageLoading,
  priorityPageLoading,
  children,
  onOpenHomePage,
  onOpenWordsPage,
  onOpenPriorityPage,
}: {
  currentPage: AppPageKey;
  error: string | null;
  version: string;
  wordsPageLoading: boolean;
  priorityPageLoading: boolean;
  children: ReactNode;
  onOpenHomePage: () => void;
  onOpenWordsPage: () => void;
  onOpenPriorityPage: () => void;
}) {
  return (
    <div className="container">
      <nav className="navbar" aria-label="Primary">
        <div className="nav-brand">
          <strong>Mandarin SRS App</strong>
          <span>Study workflow and inspection tools · v{version}</span>
        </div>
        <div className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${currentPage === 'home' ? 'active' : ''}`}
            onClick={onOpenHomePage}
            disabled={wordsPageLoading}
          >
            Home
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPage === 'words' ? 'active' : ''}`}
            onClick={onOpenWordsPage}
            disabled={wordsPageLoading || priorityPageLoading}
          >
            {wordsPageLoading ? 'Loading words...' : 'Words'}
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPage === 'priority' ? 'active' : ''}`}
            onClick={onOpenPriorityPage}
            disabled={wordsPageLoading || priorityPageLoading}
          >
            {priorityPageLoading ? 'Loading priority...' : 'Priority'}
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
        v{version} · Session coverage is now determined entirely in frontend state before durable backend updates are committed.
      </footer>
    </div>
  );
}
