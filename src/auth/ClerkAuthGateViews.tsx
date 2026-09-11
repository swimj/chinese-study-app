import type { Ref } from 'react';

export function ClerkAuthLoadingView() {
  return (
    <div className="container app-shell" aria-busy="true" aria-label="Loading">
      <nav className="navbar app-primary-nav" aria-label="Primary">
        <div className="nav-brand">
          <strong>闲云无敌锤子</strong>
        </div>
      </nav>
      <div className="app-chrome-main" />
    </div>
  );
}

export function ClerkAuthSignInView({
  error,
  signInTargetRef,
}: {
  error: string | null;
  signInTargetRef?: Ref<HTMLDivElement>;
}) {
  return (
    <main className="container">
      <section className="panel">
        <h1>Sign in to study</h1>
        {error ? <p className="notes">{error}</p> : null}
        <div ref={signInTargetRef} />
      </section>
    </main>
  );
}
