import type { Ref } from 'react';

export function ClerkAuthLoadingView() {
  return (
    <div className="container" aria-busy="true" aria-label="Loading">
      <nav className="navbar" aria-label="Primary">
        <div className="nav-brand">
          <strong>法华挣路</strong>
        </div>
      </nav>
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
