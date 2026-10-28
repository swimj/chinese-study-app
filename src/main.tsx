import './features/session/session-completion.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { resetPreviewWelcome } from './features/welcome/reset-preview-welcome';
import { ClerkAuthenticationBoundary } from './auth/ClerkAuthenticationBoundary';
import './styles.css';
import './features/content-quality/styles.css';
import './pages/ContentQualityPanel.css';
import './features/introduction-lab/styles.css';
import './features/word-introduction/styles.css';
import './features/session/session-desk.css';
import './features/session/home-connections.css';

if (import.meta.env.DEV && import.meta.env.VITE_NEW_LEARNER_PREVIEW === 'true'
  && import.meta.env.VITE_AUTH_MODE === 'trusted_local') {
  try {
    const resetUrl = resetPreviewWelcome(new URL(window.location.href), window.localStorage);
    if (resetUrl !== null) window.history.replaceState(null, '', resetUrl);
  } catch {
    console.warn('Could not reset welcome progress: browser storage is unavailable.');
  }
}

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (import.meta.env.DEV && window.location.pathname === '/intro-lab') {
  void import('./pages/IntroductionLabPage').then(({ IntroductionLabPage }) => {
    root.render(<React.StrictMode><IntroductionLabPage /></React.StrictMode>);
  });
} else {
  root.render(
    <React.StrictMode>
      <ClerkAuthenticationBoundary>
        {(signOut, accountScope) => <App key={accountScope} accountScope={accountScope} onSignOut={signOut} />}
      </ClerkAuthenticationBoundary>
    </React.StrictMode>,
  );
}
