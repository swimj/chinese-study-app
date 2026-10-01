import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ClerkAuthenticationBoundary } from './auth/ClerkAuthenticationBoundary';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (import.meta.env.DEV && window.location.pathname === '/intro-lab') {
  void import('./pages/IntroductionLabPage').then(({ IntroductionLabPage }) => {
    root.render(<React.StrictMode><IntroductionLabPage /></React.StrictMode>);
  });
} else {
  root.render(
    <React.StrictMode>
      <ClerkAuthenticationBoundary>
        {(signOut) => <App onSignOut={signOut} />}
      </ClerkAuthenticationBoundary>
    </React.StrictMode>,
  );
}
