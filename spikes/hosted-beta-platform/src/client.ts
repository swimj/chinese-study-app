import { Buffer } from 'node:buffer';

export function renderSpikeClient(publishableKey: string): string {
  if (!publishableKey.startsWith('pk_')) {
    throw new Error('SWI46_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key.');
  }

  const serializedPublishableKey = JSON.stringify(publishableKey).replaceAll('<', '\\u003c');
  const clerkDomain = deriveClerkDomain(publishableKey);
  const serializedClerkDomain = JSON.stringify(clerkDomain).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SWI-46 platform spike</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { max-width: 44rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.5; }
    button { margin: .35rem .35rem .35rem 0; padding: .55rem .8rem; }
    pre { padding: 1rem; overflow-wrap: anywhere; white-space: pre-wrap; background: rgba(127,127,127,.12); }
    .muted { opacity: .72; }
  </style>
</head>
<body>
  <h1>SWI-46 disposable platform spike</h1>
  <p class="muted">Synthetic data only. This harness proves authentication, persistence, recovery, and observability.</p>
  <div id="auth">Loading authentication…</div>
  <div id="controls" hidden>
    <button id="whoami" type="button">Check account</button>
    <button id="write" type="button">Write sentinel</button>
    <button id="signout" type="button">Sign out</button>
  </div>
  <pre id="result" aria-live="polite"></pre>
  <script
    crossorigin="anonymous"
    data-clerk-publishable-key=${serializedPublishableKey}
    src="https://${clerkDomain}/npm/@clerk/clerk-js@6.29.2/dist/clerk.browser.js"
  ></script>
  <script>
    const publishableKey = ${serializedPublishableKey};
    const clerkDomain = ${serializedClerkDomain};
    const authNode = document.getElementById('auth');
    const controls = document.getElementById('controls');
    const result = document.getElementById('result');
    let authStage = 'not-started';

    async function showResponse(response) {
      const body = await response.json();
      result.textContent = JSON.stringify({ status: response.status, body }, null, 2);
    }

    async function loadClerkUi() {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://' + clerkDomain + '/npm/@clerk/ui@1.30.5/dist/ui.browser.js';
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load the Clerk UI bundle.'));
        document.head.appendChild(script);
      });
      if (!window.__internal_ClerkUICtor) throw new Error('Clerk UI bundle did not initialize.');
      return window.__internal_ClerkUICtor;
    }

    async function start() {
      authStage = 'load-ui-bundle';
      const ClerkUI = await loadClerkUi();
      authStage = 'resolve-clerk-client';
      const clerk = window.Clerk;
      if (!clerk || typeof clerk.load !== 'function') {
        throw new TypeError('Clerk browser client did not initialize.');
      }
      authStage = 'load-clerk';
      const appOrigin = window.location.origin;
      await clerk.load({
        ui: { ClerkUI },
        signInForceRedirectUrl: appOrigin,
        signUpForceRedirectUrl: appOrigin,
        signInFallbackRedirectUrl: appOrigin,
        signUpFallbackRedirectUrl: appOrigin,
      });
      if (!clerk.user) {
        authStage = 'mount-sign-in';
        authNode.textContent = '';
        clerk.mountSignIn(authNode, {
          forceRedirectUrl: appOrigin,
          signUpForceRedirectUrl: appOrigin,
          signUpFallbackRedirectUrl: appOrigin,
        });
        authStage = 'ready';
        return;
      }

      authStage = 'ready';
      authNode.textContent = 'Authenticated synthetic test identity.';
      controls.hidden = false;
      document.getElementById('whoami').onclick = async () => showResponse(await fetch('/api/me'));
      document.getElementById('write').onclick = async () => showResponse(await fetch('/api/sentinels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }));
      document.getElementById('signout').onclick = async () => {
        await clerk.signOut({ redirectUrl: '/' });
      };
    }

    start().catch((error) => {
      authNode.textContent = 'Authentication failed to initialize.';
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.textContent = authStage + ': ' + errorName + ': ' + errorMessage;
    });
  </script>
</body>
</html>`;
}

export function deriveClerkDomain(publishableKey: string): string {
  const encodedDomain = publishableKey.split('_')[2];
  if (!encodedDomain) throw new Error('Clerk publishable key did not contain a Frontend API domain.');
  const decodedDomain = Buffer.from(encodedDomain, 'base64url').toString('utf8');
  if (!decodedDomain.endsWith('$')) throw new Error('Clerk publishable key domain marker was invalid.');
  const domain = decodedDomain.slice(0, -1);
  const url = new URL(`https://${domain}`);
  if (url.hostname !== domain || url.origin !== `https://${domain}`) {
    throw new Error('Clerk publishable key Frontend API domain was invalid.');
  }
  return domain;
}
