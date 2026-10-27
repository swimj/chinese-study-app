import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchServiceAccess, subscribeServiceAccessDenied } from '../services/api';
import { ClerkAuthLoadingView } from './ClerkAuthGateViews';

type AccessState = 'checking' | 'allowed' | 'restricted' | 'error';

/** Remount this boundary when the authenticated account changes. */
export function ServiceAccessBoundary({ children, onSignOut }: {
  children: ReactNode;
  onSignOut?: () => Promise<void>;
}) {
  const [state, setState] = useState<AccessState>('checking');
  const [attempt, setAttempt] = useState(0);
  const [signOutError, setSignOutError] = useState(false);
  const generation = useRef(0);

  useEffect(() => subscribeServiceAccessDenied(() => {
    generation.current += 1;
    setState('restricted');
  }), []);

  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = ++generation.current;
    setState('checking');
    void fetchServiceAccess(controller.signal).then(({ allowed }) => {
      if (requestGeneration === generation.current) setState(allowed ? 'allowed' : 'restricted');
    }).catch(() => {
      if (!controller.signal.aborted && requestGeneration === generation.current) setState('error');
    });
    return () => { controller.abort(); generation.current += 1; };
  }, [attempt]);

  if (state === 'checking') return <ClerkAuthLoadingView />;
  if (state === 'allowed') return <>{children}</>;
  return (
    <main className="container">
      <section className="panel" aria-labelledby="service-access-heading">
        <h1 id="service-access-heading">{state === 'restricted' ? 'Temporarily unavailable' : 'Unable to connect'}</h1>
        <p role="status">{state === 'restricted' ? 'The app is temporarily unavailable. Please try again later.' : 'Could not check service availability. Please try again.'}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
          {onSignOut && <button type="button" onClick={() => {
            setSignOutError(false);
            void onSignOut().catch(() => setSignOutError(true));
          }}>Sign out</button>}
        </div>
        {signOutError && <p role="alert">Could not sign out. Please try again.</p>}
      </section>
    </main>
  );
}
