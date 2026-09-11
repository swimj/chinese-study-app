import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type AppPageKey = 'home' | 'priority' | 'reflections' | 'content';

const NestedNavContext = createContext<HTMLElement | null>(null);

export function NestedNav({ children }: { children: ReactNode }) {
  const target = useContext(NestedNavContext);
  if (target) {
    return createPortal(children, target);
  }
  return children;
}

const PRIMARY_PAGES: ReadonlyArray<{
  key: AppPageKey;
  label: string;
  nested: boolean;
}> = [
  { key: 'home', label: 'Home', nested: false },
  { key: 'priority', label: 'New Words', nested: true },
  { key: 'reflections', label: 'Reflections', nested: true },
  { key: 'content', label: 'Content Bin', nested: false },
];

export function AppChrome({
  currentPage,
  error,
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
  const nestedSlotRef = useRef<HTMLDivElement | null>(null);
  const [nestedSlot, setNestedSlot] = useState<HTMLDivElement | null>(null);
  const navigationLoading = priorityPageLoading || reflectionPageLoading || contentPageLoading;
  const showNested = currentPage === 'priority' || currentPage === 'reflections';
  const openers: Record<AppPageKey, () => void> = {
    home: onOpenHomePage,
    priority: onOpenPriorityPage,
    reflections: onOpenReflectionsPage,
    content: onOpenContentPage,
  };
  const loadingLabels: Partial<Record<AppPageKey, string>> = {
    priority: priorityPageLoading ? 'Loading new words...' : undefined,
    reflections: reflectionPageLoading ? 'Loading reflections...' : undefined,
    content: contentPageLoading ? 'Loading content bin...' : undefined,
  };

  useLayoutEffect(() => {
    setNestedSlot(showNested ? nestedSlotRef.current : null);
  }, [showNested, currentPage]);

  return (
    <NestedNavContext.Provider value={nestedSlot}>
      <div className={
        sessionActive
          ? 'container app-shell app-session-active'
          : currentPage === 'reflections'
            ? 'container app-shell app-reflections-page'
            : currentPage === 'priority'
              ? 'container app-shell app-priority-page'
              : 'container app-shell'
      }>
        <nav className="navbar app-primary-nav" aria-label="Primary">
          <div className="nav-brand">
            <strong>闲云无敌锤子</strong>
          </div>
          <div className="nav-tabs">
            {PRIMARY_PAGES.map((page) => {
              const active = currentPage === page.key;
              return (
                <div key={page.key} className="app-nav-item">
                  <button
                    type="button"
                    className={`nav-tab ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={openers[page.key]}
                    disabled={navigationLoading}
                  >
                    {loadingLabels[page.key] ?? page.label}
                  </button>
                  {active && page.nested ? (
                    <div ref={nestedSlotRef} className="app-nav-nested" />
                  ) : null}
                </div>
              );
            })}
          </div>
          {onSignOut ? (
            <button type="button" className="nav-tab app-nav-sign-out" onClick={() => void onSignOut()}>
              Sign out
            </button>
          ) : null}
        </nav>

        <div className="app-chrome-main">
          {error ? (
            <div className="panel">
              <h2>Error</h2>
              <p className="notes">{error}</p>
            </div>
          ) : null}

          {children}
        </div>
      </div>
    </NestedNavContext.Provider>
  );
}
