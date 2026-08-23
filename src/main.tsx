import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ClerkAuthenticationBoundary } from './auth/ClerkAuthenticationBoundary';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkAuthenticationBoundary>
      {(signOut) => <App onSignOut={signOut} />}
    </ClerkAuthenticationBoundary>
  </React.StrictMode>,
);
