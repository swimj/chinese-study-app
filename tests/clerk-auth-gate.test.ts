import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import {
  hasClerkInvitationTicket,
  resolveClerkAuthGatePhase,
  resolveClerkAuthMountedComponent,
} from '../src/auth/clerk-auth-gate.ts';
import { ClerkAuthLoadingView, ClerkAuthSignInView, ClerkAuthSignUpView } from '../src/auth/ClerkAuthGateViews.tsx';

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
    assert.equal(resolveClerkAuthGatePhase({
      enabled: true,
      clerkReady: true,
      signedIn: false,
      error: null,
      invitationTicket: true,
    }), 'sign-up');
    assert.equal(resolveClerkAuthMountedComponent(true), 'sign-up');
    assert.equal(resolveClerkAuthMountedComponent(false), 'sign-in');
  });

  test('treats a Clerk invitation ticket as in-app sign-up, not Account Portal', () => {
    assert.equal(hasClerkInvitationTicket({ search: '?__clerk_ticket=ticket_secret' }), true);
    assert.equal(hasClerkInvitationTicket({ search: '', hash: '#/sign-up?__clerk_ticket=ticket_secret' }), true);
    assert.equal(hasClerkInvitationTicket({ search: '?redirect_url=https://example.test' }), false);
    assert.equal(hasClerkInvitationTicket({ search: '' }), false);
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
    assert.match(loading, /aria-label="Primary"/);
    assert.match(loading, /class="nav-brand"/);
    assert.match(loading, /闲云无敌锤子/);
    assert.doesNotMatch(loading, /Sign in to study/);

    const signIn = renderToStaticMarkup(createElement(ClerkAuthSignInView, { error: null }));
    assert.match(signIn, /Sign in to study/);
    assert.doesNotMatch(signIn, /Set a password to study/);

    const signUp = renderToStaticMarkup(createElement(ClerkAuthSignUpView, { error: null }));
    assert.match(signUp, /Set a password to study/);
    assert.doesNotMatch(signUp, /Sign in to study/);

    const failed = renderToStaticMarkup(createElement(ClerkAuthSignInView, {
      error: 'Unable to initialize Clerk.',
    }));
    assert.match(failed, /Sign in to study/);
    assert.match(failed, /Unable to initialize Clerk\./);
  });
});
