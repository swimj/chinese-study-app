import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import { resolveClerkAuthGatePhase } from '../src/auth/clerk-auth-gate.ts';
import { ClerkAuthLoadingView, ClerkAuthSignInView } from '../src/auth/ClerkAuthGateViews.tsx';

describe('Clerk auth gate', () => {
  test('keeps the signed-in app visible and does not treat Clerk startup as sign-out', () => {
    assert.equal(resolveClerkAuthGatePhase({
      enabled: false,
      clerkReady: false,
      signedIn: false,
      error: null,
    }), 'app');
    assert.equal(resolveClerkAuthGatePhase({
      enabled: true,
      clerkReady: false,
      signedIn: false,
      error: null,
    }), 'loading');
    assert.equal(resolveClerkAuthGatePhase({
      enabled: true,
      clerkReady: true,
      signedIn: true,
      error: null,
    }), 'app');
    assert.equal(resolveClerkAuthGatePhase({
      enabled: true,
      clerkReady: true,
      signedIn: false,
      error: null,
    }), 'sign-in');
  });

  test('shows the sign-in heading only after Clerk is ready or has failed', () => {
    assert.equal(resolveClerkAuthGatePhase({
      enabled: true,
      clerkReady: false,
      signedIn: false,
      error: 'Unable to initialize Clerk.',
    }), 'sign-in');

    const loading = renderToStaticMarkup(createElement(ClerkAuthLoadingView));
    assert.match(loading, /aria-busy="true"/);
    assert.match(loading, /法华挣路/);
    assert.doesNotMatch(loading, /Sign in to study/);

    const signIn = renderToStaticMarkup(createElement(ClerkAuthSignInView, { error: null }));
    assert.match(signIn, /Sign in to study/);
    assert.doesNotMatch(signIn, /Loading secure sign-in/);

    const failed = renderToStaticMarkup(createElement(ClerkAuthSignInView, {
      error: 'Unable to initialize Clerk.',
    }));
    assert.match(failed, /Sign in to study/);
    assert.match(failed, /Unable to initialize Clerk\./);
  });
});
