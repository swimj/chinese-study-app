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
    <ClerkAuthFormView
      heading="Sign in to study"
      error={error}
      targetRef={signInTargetRef}
    />
  );
}

export function ClerkAuthSignUpView({
  error,
  signUpTargetRef,
}: {
  error: string | null;
  signUpTargetRef?: Ref<HTMLDivElement>;
}) {
  return (
    <ClerkAuthFormView
      heading="Set a password to study"
      error={error}
      targetRef={signUpTargetRef}
    />
  );
}

function ClerkAuthFormView({
  heading,
  error,
  targetRef,
}: {
  heading: string;
  error: string | null;
  targetRef?: Ref<HTMLDivElement>;
}) {
  return (
    <main className="container">
      <section className="panel">
        <h1>{heading}</h1>
        {error ? <p className="notes">{error}</p> : null}
        <div ref={targetRef} />
      </section>
    </main>
  );
}
