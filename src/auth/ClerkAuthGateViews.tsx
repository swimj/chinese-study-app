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
  serviceRestricted,
  signInTargetRef,
}: {
  error: string | null;
  serviceRestricted?: boolean;
  signInTargetRef?: Ref<HTMLDivElement>;
}) {
  return (
    <ClerkAuthFormView
      heading="Sign in to study"
      error={error}
      serviceRestricted={serviceRestricted}
      targetRef={signInTargetRef}
    />
  );
}

export function ClerkAuthSignUpView({
  error,
  serviceRestricted,
  signUpTargetRef,
}: {
  error: string | null;
  serviceRestricted?: boolean;
  signUpTargetRef?: Ref<HTMLDivElement>;
}) {
  return (
    <ClerkAuthFormView
      heading="Set a password to study"
      error={error}
      serviceRestricted={serviceRestricted}
      targetRef={signUpTargetRef}
    />
  );
}

function ClerkAuthFormView({
  heading,
  error,
  serviceRestricted,
  targetRef,
}: {
  heading: string;
  error: string | null;
  serviceRestricted?: boolean;
  targetRef?: Ref<HTMLDivElement>;
}) {
  return (
    <main className="container">
      <section className="panel">
        <h1>{serviceRestricted ? 'Temporarily unavailable' : heading}</h1>
        {serviceRestricted && <p role="status">The app is temporarily unavailable. Operator sign-in remains available.</p>}
        {error ? <p className="notes">{error}</p> : null}
        <div ref={targetRef} />
      </section>
    </main>
  );
}
