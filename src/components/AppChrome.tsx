import type { ReactNode } from 'react';

export type AppPageKey = 'home' | 'priority' | 'reflections' | 'content';

export function AppChrome({
  currentPage,
  error,
  version,
  sessionActive,
  priorityPageLoading,
  reflectionPageLoading,
  contentPageLoading,
  children,
  onOpenHomePage,
  onOpenPriorityPage,
  onOpenReflectionsPage,
  onOpenContentPage,
  onSignOut,
}: {
  currentPage: AppPageKey;
  error: string | null;
  version: string;
  sessionActive: boolean;
  priorityPageLoading: boolean;
  reflectionPageLoading: boolean;
  contentPageLoading: boolean;
  children: ReactNode;
  onOpenHomePage: () => void;
  onOpenPriorityPage: () => void;
  onOpenReflectionsPage: () => void;
  onOpenContentPage: () => void;
  onSignOut?: () => Promise<void>;
}) {
  const navigationLoading = priorityPageLoading || reflectionPageLoading || contentPageLoading;

  return (
    <div className={
      sessionActive
        ? 'container app-session-active'
        : currentPage === 'reflections'
          ? 'container app-reflections-page'
          : currentPage === 'priority'
            ? 'container app-priority-page'
            : 'container'
    }>
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
          {onSignOut ? (
            <button type="button" className="nav-tab" onClick={() => void onSignOut()}>
              Sign out
            </button>
          ) : null}
        </div>
      </nav>

      {error ? (
        <div className="panel">
          <h2>Error</h2>
          <p className="notes">{error}</p>
        </div>
      ) : null}

      {children}
    </div>
  );
}
