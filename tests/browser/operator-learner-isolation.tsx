import React from 'react';
import { createRoot } from 'react-dom/client';
import VocabularyApp from '../../src/VocabularyApp';
import '../../src/styles.css';

// Exercise the real app/hook wiring; no backend or learner data is involved.
const requests: string[] = [];
let releasePreview: (() => void) | undefined;
let releaseRecovery: (() => void) | undefined;
window.fetch = async input => {
  const path = new URL(String(input), location.origin).pathname;
  requests.push(path);
  if (path.endsWith('/session-preview')) return new Promise<Response>(resolve => {
    releasePreview = () => resolve(Response.json({ itemCount: 0, previewSeed: 'fixture', preparationPending: true }));
  });
  if (path.endsWith('/completion/current')) return new Promise<Response>(resolve => {
    releaseRecovery = () => resolve(Response.json(null));
  });
  if (path === '/api/attention-badges') return Response.json({ reflectionUnseenCount: 0, reflectionGenerating: false, failedReflectionRunIds: [] });
  if (path === '/api/whats-new-attention') return Response.json({ serverNow: new Date().toISOString(), items: [], unseenPostIds: [] });
  if (path === '/api/whats-new') return Response.json({ posts: [] });
  if (path.endsWith('/feedback/attention')) return Response.json({ unseenCount: 0, hasFailure: false, generating: false });
  if (path.startsWith('/api/operator/vocabulary/')) return Response.json({ items: [] });
  // Unneeded dashboard/usage payloads fail explicitly; they must still be counted.
  return Response.json({ error: 'Unavailable in isolation fixture' }, { status: 503 });
};
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const learnerRequests = () => requests.filter(path => !path.startsWith('/api/operator/'));
const lines: string[] = [];
function check(condition: boolean, description: string) {
  if (!condition) throw new Error(`${description}: ${JSON.stringify(requests)}`);
  lines.push(`PASS ${description}`);
  document.getElementById('results')!.textContent = lines.join('\n');
}
function focus() { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }
async function run() {
  for (const hash of ['#operator-usage', '#operator-vocabulary']) {
    history.replaceState(null, '', hash);
    requests.length = 0;
    const root = createRoot(document.getElementById('root')!);
    root.render(<VocabularyApp />);
    await wait(100);
    focus();
    await wait(5200);
    check(requests.some(path => path.startsWith('/api/operator/')), `${hash}: operator requests run`);
    check(learnerRequests().length === 0, `${hash}: no learner requests on mount, focus, visibility, or polling`);
    const home = [...document.querySelectorAll('button')].find(button => button.textContent === 'Home');
    if (!home) throw new Error('Home navigation missing');
    home.click();
    await wait(150);
    check(requests.includes('/api/vocabulary/session-preview') && requests.includes('/api/status')
      && requests.includes('/api/vocabulary/completion/current') && requests.includes('/api/attention-badges'), 'Home resumes learner reads');
    location.hash = '#operator-vocabulary';
    await wait(150);
    const before = learnerRequests().length;
    releasePreview?.(); releaseRecovery?.();
    focus();
    await wait(5300);
    check(learnerRequests().length === before, 'Returning to operator stops polling and ignores late Home/recovery results');
    root.unmount();
    await wait(50);
  }
  lines.push('ALL CHECKS PASSED');
  document.getElementById('results')!.textContent = lines.join('\n');
}
void run().catch(error => { document.getElementById('results')!.textContent = `${lines.join('\n')}\nFAIL ${String(error)}`; });
