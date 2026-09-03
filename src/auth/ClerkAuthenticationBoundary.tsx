import { useEffect, useRef, useState, type ReactNode } from 'react';
import { setApiAuthenticationTokenProvider } from '../services/api';
import { resolveClerkAuthGatePhase } from './clerk-auth-gate';
import { ClerkAuthLoadingView, ClerkAuthSignInView } from './ClerkAuthGateViews';

type ClerkSession = {
  getToken(): Promise<string | null>;
};

type ClerkClient = {
  load(options: Record<string, unknown>): Promise<void>;
  mountSignIn(element: HTMLDivElement, options: Record<string, unknown>): void;
  signOut(options: { redirectUrl: string }): Promise<void>;
  session: ClerkSession | null;
  user: unknown;
  addListener(listener: (resource: { user: unknown; session: ClerkSession | null }) => void): () => void;
};

declare global {
  interface Window {
    Clerk?: ClerkClient;
    __internal_ClerkUICtor?: unknown;
  }
}

const publishableKey = import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY;
const enabled = import.meta.env?.VITE_AUTH_MODE === 'clerk';

export function ClerkAuthenticationBoundary({ children }: { children: (signOut?: () => Promise<void>) => ReactNode }) {
  const signInTarget = useRef<HTMLDivElement>(null);
  const [client, setClient] = useState<ClerkClient | null>(null);
  const [clerkReady, setClerkReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(() => (
    enabled && !publishableKey
      ? 'VITE_CLERK_PUBLISHABLE_KEY is required when VITE_AUTH_MODE=clerk.'
      : null
  ));

  useEffect(() => {
    if (!enabled) return;
    if (!publishableKey) return;

    let removeListener: (() => void) | null = null;
    let cancelled = false;
    void loadClerkClient(publishableKey).then(async (loadedClient) => {
      if (cancelled) return;
      const origin = window.location.origin;
      await loadedClient.load({
        ui: { ClerkUI: await loadClerkUi(deriveClerkDomain(publishableKey)) },
        signInForceRedirectUrl: origin,
        signUpForceRedirectUrl: origin,
        signInFallbackRedirectUrl: origin,
        signUpFallbackRedirectUrl: origin,
      });
      if (cancelled) return;

      const updateSession = () => {
        const hasSession = Boolean(loadedClient.user && loadedClient.session);
        if (hasSession) {
          setApiAuthenticationTokenProvider(() => loadedClient.session?.getToken() ?? Promise.resolve(null));
        } else {
          setApiAuthenticationTokenProvider(null);
        }
        setClient(loadedClient);
        setClerkReady(true);
        setSignedIn(hasSession);
      };
      removeListener = loadedClient.addListener(updateSession);
      updateSession();
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to initialize Clerk.');
    });

    return () => {
      cancelled = true;
      removeListener?.();
      setApiAuthenticationTokenProvider(null);
    };
  }, []);

  useEffect(() => {
    if (!client || signedIn || error || !signInTarget.current) return;
    const origin = window.location.origin;
    client.mountSignIn(signInTarget.current, {
      forceRedirectUrl: origin,
      signUpForceRedirectUrl: origin,
      signUpFallbackRedirectUrl: origin,
    });
  }, [client, signedIn, error]);

  const phase = resolveClerkAuthGatePhase({ enabled, clerkReady, signedIn, error });
  if (phase === 'app') {
    return <>{children(enabled && client ? () => client.signOut({ redirectUrl: window.location.origin }) : undefined)}</>;
  }
  if (phase === 'loading') {
    return <ClerkAuthLoadingView />;
  }
  return <ClerkAuthSignInView error={error} signInTargetRef={signInTarget} />;
}

async function loadClerkClient(key: string): Promise<ClerkClient> {
  if (window.Clerk) return window.Clerk;
  const domain = deriveClerkDomain(key);
  await loadScript(
    `https://${domain}/npm/@clerk/clerk-js@6.29.2/dist/clerk.browser.js`,
    { publishableKey: key },
  );
  if (!window.Clerk) throw new Error('Clerk browser client did not initialize.');
  return window.Clerk;
}

async function loadClerkUi(domain: string): Promise<unknown> {
  if (!window.__internal_ClerkUICtor) {
    await loadScript(`https://${domain}/npm/@clerk/ui@1.30.5/dist/ui.browser.js`);
  }
  if (!window.__internal_ClerkUICtor) throw new Error('Clerk UI bundle did not initialize.');
  return window.__internal_ClerkUICtor;
}

function loadScript(source: string, options: { publishableKey?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.async = true;
    script.crossOrigin = 'anonymous';
    if (options.publishableKey) {
      script.dataset.clerkPublishableKey = options.publishableKey;
    }
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Clerk browser assets.'));
    document.head.appendChild(script);
  });
}

function deriveClerkDomain(key: string): string {
  const encodedDomain = key.split('_')[2];
  if (!encodedDomain) throw new Error('Clerk publishable key domain is invalid.');
  const domain = atob(encodedDomain.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedDomain.length / 4) * 4, '='));
  if (!domain.endsWith('$')) throw new Error('Clerk publishable key domain is invalid.');
  const hostname = domain.slice(0, -1);
  const url = new URL(`https://${hostname}`);
  if (url.hostname !== hostname) throw new Error('Clerk publishable key domain is invalid.');
  return hostname;
}
