import { useEffect, useState } from 'react';
import { OperatorPanel } from './pages/OperatorUsagePulsePage';
import { operatorPath, operatorTabFromPath, type OperatorTab } from './features/operator/routes';
import './OperatorApp.css';
import { OperatorShell } from './components/OperatorShell';
export { OperatorShell } from './components/OperatorShell';

export default function OperatorApp({ onSignOut }: { onSignOut?: () => Promise<void> }) {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [openedImprovement, setOpenedImprovement] = useState(() => operatorTabFromPath(window.location.pathname) === 'improvement');
  function selectPath(path: string) {
    if (operatorTabFromPath(path) === 'improvement') setOpenedImprovement(true);
    setPathname(path);
  }
  useEffect(() => {
    const onPopState = () => selectPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const tab = operatorTabFromPath(pathname);
  function navigate(next: OperatorTab) {
    const path = operatorPath(next);
    if (path === pathname) return;
    history.pushState(null, '', path); selectPath(path);
  }
  return <OperatorShell tab={tab} onNavigate={navigate} onSignOut={onSignOut}>
    {tab !== 'improvement' && (tab ? <OperatorPanel key={tab} tab={tab} /> : <section><h2>Operator view not found</h2><a href="/operator/usage">Open usage</a></section>)}
    {openedImprovement && <div hidden={tab !== 'improvement'}><OperatorPanel tab="improvement" /></div>}
  </OperatorShell>;
}
