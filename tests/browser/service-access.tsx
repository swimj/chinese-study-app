import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ServiceAccessBoundary } from '../../src/auth/ServiceAccessBoundary';
import { fetchMyWords, setClientIncidentStorageScope } from '../../src/services/api';
import '../../src/styles.css';

const params = new URLSearchParams(location.search);
let restricted = params.has('restricted');
if (params.has('compact')) {
  const style = document.createElement('style');
  style.textContent = 'html { font-size: 24px; } #root { max-width: 380px; margin: auto; } .container { width: 100%; } aside button { margin-bottom: .5rem; } output { overflow-wrap: anywhere; }';
  document.head.append(style);
}
let account = 'learner';
let appMounts = 0;
let appUnmounts = 0;
let requests = 0;
window.fetch = async (input) => {
  requests += 1;
  const allowed = !restricted || account === 'operator';
  if (String(input).endsWith('/api/service-access')) return Response.json({ allowed });
  return allowed ? Response.json({ words: [] }) : Response.json({ code: 'OPERATOR_ONLY', error: 'The service is temporarily unavailable.' }, { status: 503 });
};
function StudyApp() {
  useEffect(() => { appMounts += 1; return () => { appUnmounts += 1; }; }, []);
  return <section className="panel"><h1>Study app mounted</h1><button onClick={() => void fetchMyWords('deck', '').catch(() => {})}>Make learner request</button></section>;
}
function Fixture() {
  const [scope, setScope] = useState(account);
  const [evidence, setEvidence] = useState('');
  return <>
    <aside className="container" aria-label="Fixture controls">
      <button onClick={() => { restricted = true; }}>Restrict service</button>
      <button onClick={() => { restricted = false; }}>Open service</button>
      <button onClick={() => { account = 'operator'; setClientIncidentStorageScope(account); setScope(account); }}>Switch to operator</button>
      <button onClick={() => setEvidence(JSON.stringify({ appMounts, appUnmounts, requests, account }))}>Inspect lifecycle</button>
      <output>{evidence}</output>
    </aside>
    <ServiceAccessBoundary key={scope} onSignOut={async () => { account = 'signed-out'; setClientIncidentStorageScope(account); setScope(account); }}><StudyApp /></ServiceAccessBoundary>
  </>;
}
setClientIncidentStorageScope(account);
createRoot(document.getElementById('root')!).render(<Fixture />);
