import type { ReactNode } from 'react';

export type AppPageKey = 'home' | 'priority' | 'intake' | 'reflections' | 'content';

export function AppChrome({
  currentPage,
  error,
  version,
  sessionActive,
  priorityPageLoading,
  intakePageLoading,
  reflectionPageLoading,
  contentPageLoading,
  children,
  onOpenHomePage,
  onOpenPriorityPage,
  onOpenIntakePage,
  onOpenReflectionsPage,
  onOpenContentPage,
}: {
  currentPage: AppPageKey;
  error: string | null;
  version: string;
  sessionActive: boolean;
  priorityPageLoading: boolean;
  intakePageLoading: boolean;
  reflectionPageLoading: boolean;
  contentPageLoading: boolean;
  children: ReactNode;
  onOpenHomePage: () => void;
  onOpenPriorityPage: () => void;
  onOpenIntakePage: () => void;
  onOpenReflectionsPage: () => void;
  onOpenContentPage: () => void;
}) {
  const navigationLoading = priorityPageLoading || intakePageLoading || reflectionPageLoading || contentPageLoading;

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
          <button
            type="button"
            className={`nav-tab ${currentPage === 'reflections' ? 'active' : ''}`}
            onClick={onOpenReflectionsPage}
            disabled={navigationLoading}
          >
            {reflectionPageLoading ? 'Loading reflections...' : 'Reflections'}
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPage === 'content' ? 'active' : ''}`}
            onClick={onOpenContentPage}
            disabled={navigationLoading}
          >
            {contentPageLoading ? 'Loading content...' : 'Content'}
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
