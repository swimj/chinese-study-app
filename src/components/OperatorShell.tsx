import type { ReactNode } from 'react';
import { OPERATOR_TABS, operatorPath, type OperatorTab } from '../features/operator/routes';

/** Operator-only chrome. It does not depend on learner controllers or navigation. */
export function OperatorShell({ tab, onNavigate, children, onSignOut }: {
  tab: OperatorTab | null;
  onNavigate?: (tab: OperatorTab) => void;
  children: ReactNode;
  onSignOut?: () => Promise<void>;
}) {
  return <div className="operator-shell">
    <aside className="operator-rail">
      <h1>Operator</h1>
      <nav aria-label="Operator views">{OPERATOR_TABS.map(item => <a key={item.id}
        href={operatorPath(item.id)} aria-current={tab === item.id ? 'page' : undefined}
        onClick={event => {
          if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); onNavigate(item.id);
        }}>{item.label}</a>)}</nav>
      <a className="operator-return" href="/">Return to study</a>
      {onSignOut && <button className="secondary-button" onClick={() => void onSignOut()}>Sign out</button>}
    </aside>
    <main className="operator-main" id="operator-main">{children}</main>
  </div>;
}

