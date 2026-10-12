// Isolated real hook/panel regression. Fake server deadlines are shortened for the fixture.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionCompletion, StageSessionCompletionRequest } from '../../src/domain/session-completion';
import { SessionCompletionPanel } from '../../src/features/session/SessionCompletionPanel';
import { useSessionCompletionFlow } from '../../src/features/session/useSessionCompletionFlow';
import { createSessionSummary } from '../../src/features/session/session-summary';
import '../../src/styles.css';
import '../../src/features/session/session-completion.css';

let server: SessionCompletion | null = null;
let failStage = false;
let stageCalls = 0;
let lastStageRevision: string | null = null;
let closedCount = 0;
let homeCount = 0;
let cancellationCount = 0;
let delayNextRead = false;
let delayedRead: { resolve: (response: Response) => void; snapshot: SessionCompletion } | null = null;
let loseNextUndoResponse = false;
let loseNextCloseResponse = false;
let completionReads = 0;
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('/recovery-highlights')) return Response.json({ highlights: [] });
  if (url.endsWith('/api/session-completions/current')) return Response.json({ completion: server });
  const match = url.match(/\/study-sessions\/([^/]+)\/completion(\/undo|\/close)?$/);
  if (!match) throw new Error(`Unexpected fixture request: ${url}`);
  const [, sessionId, action] = match;
  if (!action && init?.method !== 'POST') {
    completionReads++;
    if (delayNextRead) {
      delayNextRead = false;
      if (!server) throw new Error('No completion to delay');
      const snapshot = { ...server, status: 'cancelled' as const, canUndo: false };
      return new Promise<Response>((resolve) => { delayedRead = { resolve, snapshot }; });
    }
  }
  if (!action && init?.method === 'POST') {
    stageCalls++;
    const body = JSON.parse(String(init.body)) as StageSessionCompletionRequest;
    lastStageRevision = body.revisionId;
    if (failStage) { failStage = false; return Response.json({ error: 'Fixture offline' }, { status: 503 }); }
    server = { sessionId, revisionId: body.revisionId, status: 'pending', canUndo: true,
      closeAt: new Date(Date.now() + 1200).toISOString(), serverNow: new Date().toISOString(),
      completedAt: body.summary.completedAt, report: { newWords: [{ id: 'learn', hanzi: '学', traditional: '學', pinyin: 'xué', meaning: 'learn' }], graduatedWords: [] }, error: null };
  } else if (action === '/undo') {
    if (!server) throw new Error('No pending completion');
    server = { ...server, status: 'cancelled', canUndo: false };
    if (loseNextUndoResponse) { loseNextUndoResponse = false; throw new Error('Fixture lost Undo response'); }
  } else if (action === '/close') {
    if (!server) throw new Error('No completion');
    if (server.status !== 'closed') closedCount++;
    server = { ...server, status: 'closed', canUndo: false };
    if (loseNextCloseResponse) { loseNextCloseResponse = false; throw new Error('Fixture lost close response'); }
  }
  if (!server) throw new Error('Missing fixture completion');
  return Response.json({ ...server, serverNow: new Date().toISOString() });
};

let flow: ReturnType<typeof useSessionCompletionFlow>;
let start: (id: string) => void;
function Harness({ initialSessionId }: { initialSessionId: string | null }) {
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [studyResumed, setStudyResumed] = useState(false);
  start = (id) => { setStudyResumed(false); setSessionId(id); };
  flow = useSessionCompletionFlow({ sessionId, surfaceVisible: true,
    buildRequest: (revisionId) => ({ revisionId, startedAt: new Date().toISOString(), studyDayKey: '2026-10-12',
      pendingCommit: null, reflectionEvidence: null,
      summary: { completedAt: new Date().toISOString(), completedReviewActionCount: 1, failedReviewActionCount: 0, activeDurationMs: 3000 } }),
    onCancelled: () => { cancellationCount++; setStudyResumed(true); setSessionId(null); },
    onReturnHome: async () => { homeCount++; setStudyResumed(false); setSessionId(null); },
  });
  return sessionId ? <SessionCompletionPanel summary={createSessionSummary({ sessionId, startedAt: new Date().toISOString(), initialQueueLength: 1 })}
    {...flow} hasUndo onUndo={() => void flow.undo()} onReturnHome={() => void flow.finish()}
    onKeepOpen={flow.keepSummaryOpen} onRetry={() => void flow.retry()} characterPresentation="both" /> : <p>{studyResumed ? 'Study resumed' : 'Home overview'}</p>;
}
let root = createRoot(document.getElementById('root')!);
const parameters = new URLSearchParams(location.search);
function Preview() {
  const [left, setLeft] = useState(15);
  const [keepOpen, setKeepOpen] = useState(true);
  const [closed, setClosed] = useState(false);
  const [returned, setReturned] = useState(false);
  const empty = parameters.get('empty');
  const longLists = parameters.has('long');
  const words = [
    { hanzi: '理解', traditional: null, pinyin: 'lǐ jiě', meaning: 'to understand; to make sense of an explanation even when the wording is unfamiliar or the sentence is unusually long' },
    { hanzi: '学会', traditional: '學會', pinyin: 'xué huì', meaning: 'to learn how to do something; to acquire a skill through repeated practice' },
    { hanzi: '坚持', traditional: '堅持', pinyin: 'jiān chí', meaning: 'to persevere; to keep going despite difficulties' },
    { hanzi: '复杂', traditional: '複雜', pinyin: 'fù zá', meaning: 'complex; complicated; involving several connected parts' },
    { hanzi: '逐渐', traditional: '逐漸', pinyin: 'zhú jiàn', meaning: 'gradually; little by little' },
  ];
  const previewCompletion: SessionCompletion = { sessionId: 'preview', revisionId: 'preview-revision',
    status: closed ? 'closed' : 'pending', canUndo: !closed,
    closeAt: new Date(Date.now() + left * 1000).toISOString(), serverNow: new Date().toISOString(), completedAt: new Date().toISOString(),
    report: {
      newWords: empty === '1' || empty === 'new' ? [] : Array.from({ length: longLists ? 24 : 5 }, (_, index) => ({ ...words[index % words.length], id: `new-${index}` })),
      graduatedWords: empty === '1' || empty === 'graduated' ? [] : Array.from({ length: longLists ? 12 : 3 }, (_, index) => ({ ...words[index % words.length], id: `graduated-${index}` })),
    }, error: null };
  useEffect(() => {
    const timer = window.setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (left === 0) setClosed(true); }, [left]);
  const summary = { ...createSessionSummary({ sessionId: 'preview', startedAt: new Date().toISOString(), initialQueueLength: 120 }), answeredCount: 1234, activeDurationMs: 9_825_000 };
  return <div className="container app-shell">
    <nav className="navbar app-primary-nav" aria-label="Primary">
      <div className="nav-brand"><strong>中文</strong></div>
      <div className="nav-tabs"><button type="button" className="nav-tab active" onClick={() => setReturned(true)}>Home</button><button type="button" className="nav-tab" onClick={() => setReturned(true)}>Words</button></div>
    </nav>
    <main className="app-chrome-main"><div className="home-page home-session-active"><div className="grid home-grid">
      <section className="panel" aria-hidden="true" />
      {returned ? <p>Home overview — reload to restore the completion preview.</p> : <SessionCompletionPanel
        summary={summary} completion={previewCompletion} saving={false} busy={false} error={null} hasUndo={!closed}
        remainingSeconds={left} keepOpen={keepOpen} characterPresentation="both"
        onUndo={() => { setLeft(15); setClosed(false); }} onKeepOpen={() => setKeepOpen(true)}
        onReturnHome={() => { setClosed(true); setReturned(true); }} onRetry={() => {}} />}
    </div></div></main>
  </div>;
}
if (parameters.has('large')) {
  const style = document.createElement('style');
  style.textContent = ':root { font-size: 200%; }';
  document.head.append(style);
}
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
async function until(condition: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('Timed out waiting for completion'); await delay(); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
async function run() {
  failStage = true;
  root.render(<Harness initialSessionId="saving-failure" />);
  await until(() => !!flow?.error);
  assert(flow.remainingSeconds === null && !flow.completion, 'Failed acknowledgement must not start countdown');
  const firstRevision = lastStageRevision;
  await flow.retry();
  await until(() => flow.completion?.status === 'pending');
  assert(lastStageRevision === firstRevision && stageCalls === 2, 'Retry must reuse completion revision');
  const keepButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Keep summary open');
  if (!keepButton) throw new Error('Missing keep-open action');
  keepButton.click();
  await until(() => flow.completion?.status === 'closed');
  assert(homeCount === 0 && !!document.querySelector('.session-completion'), 'Keep open must preserve summary while backend closes');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
  await until(() => document.body.textContent?.includes('Home overview') === true);
  assert(homeCount === 1 && closedCount === 1, 'Return Home must not close backend twice');
  start('undo');
  await until(() => flow.completion?.status === 'pending');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true }));
  await until(() => !document.querySelector('.session-completion'));
  assert(server?.status === 'cancelled', 'Undo must cancel backend completion');

  start('external-cancel');
  await until(() => flow.completion?.status === 'pending');
  server = { ...server!, status: 'cancelled', canUndo: false };
  document.dispatchEvent(new Event('visibilitychange'));
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => cancellationCount === 2 && !flow.completion);
  assert(document.body.textContent?.includes('Study resumed') === true, 'External cancellation must restore study once');

  start('same-session-race');
  await until(() => flow.completion?.status === 'pending');
  const previousRevision = flow.completion!.revisionId;
  delayNextRead = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => delayedRead !== null);
  await flow.undo();
  await until(() => !flow.completion);
  start('same-session-race');
  await until(() => flow.completion?.status === 'pending' && flow.completion.revisionId !== previousRevision);
  const nextRevision = flow.completion!.revisionId;
  const staleRead = delayedRead!;
  delayedRead = null;
  staleRead.resolve(Response.json(staleRead.snapshot));
  await delay(); await delay();
  assert(flow.completion?.revisionId === nextRevision && flow.completion.status === 'pending'
    && cancellationCount === 3, 'Stale visibility response must not cancel a new revision');

  const readsBeforeLostUndo = completionReads;
  loseNextUndoResponse = true;
  await flow.undo();
  await until(() => !flow.completion && cancellationCount === 4);
  assert(completionReads === readsBeforeLostUndo + 1 && !flow.error
    && document.body.textContent?.includes('Study resumed') === true, 'Lost Undo response must reconcile cancellation and restore study once');

  start('reload');
  await until(() => flow.completion?.status === 'pending');
  const completionBeforeReload = server;
  const stagesBeforeReload = stageCalls;
  const homesBeforeReload = homeCount;
  root.unmount();
  root = createRoot(document.getElementById('root')!);
  root.render(<Harness initialSessionId={null} />);
  await until(() => document.body.textContent?.includes('Home overview') === true);
  await delay();
  assert(flow.completion === null && server === completionBeforeReload && stageCalls === stagesBeforeReload
    && homeCount === homesBeforeReload, 'Reload must leave Home without restoring, cancelling, or restaging pending completion');
  start('lost-close');
  await until(() => flow.completion?.status === 'pending');
  const readsBeforeLostClose = completionReads;
  loseNextCloseResponse = true;
  assert(await flow.finish(), 'Lost close response must reconcile successful completion');
  await until(() => homeCount === 2);
  assert(completionReads === readsBeforeLostClose + 1 && !flow.error, 'Lost close response must return Home without a second close');
  document.getElementById('result')!.textContent = 'PASS: saving retry, keep open, Undo, external cancellation, stale-revision reads, lost Undo/close responses, Home after remount, and automatic Home return.';
}
if (parameters.has('preview')) {
  document.getElementById('result')!.hidden = true;
  root.render(<Preview />);
} else {
  void run().catch((error: unknown) => { document.getElementById('result')!.textContent = `FAIL: ${String(error)}`; console.error(error); });
}
