import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionCompletion } from '../src/domain/session-completion.ts';
import { SessionCompletionPanel, resolveCompletionKey, type SessionCompletionPanelProps } from '../src/features/session/SessionCompletionPanel.tsx';
import { createSessionSummary } from '../src/features/session/session-summary.ts';

const completion: SessionCompletion = {
  sessionId: 's', revisionId: 'r', status: 'pending', closeAt: '2026-10-12T00:00:15Z',
  serverNow: '2026-10-12T00:00:00Z', completedAt: '2026-10-12T00:00:00Z', canUndo: true,
  report: { newWords: [{ id: 'w1', hanzi: '新', traditional: null, pinyin: 'xīn', meaning: 'new' }], graduatedWords: [] }, error: null,
};
const noop = () => {};
function render(patch: Partial<SessionCompletionPanelProps> = {}) {
  return renderToStaticMarkup(createElement(SessionCompletionPanel, {
    summary: createSessionSummary({ sessionId: 's', startedAt: completion.completedAt, initialQueueLength: 1 }),
    completion, saving: false, busy: false, error: null, hasUndo: true,
    onUndo: noop, onReturnHome: noop, onKeepOpen: noop, onRetry: noop,
    keepOpen: false, remainingSeconds: 15, characterPresentation: 'simplified', ...patch,
  }));
}

test('acknowledged completion shows provisional report, countdown, and Undo without generated content', () => {
  const html = render();
  assert.match(html, /Returning to Home in 15 seconds/);
  assert.match(html, /New words studied/);
  assert.match(html, /新/);
  assert.match(html, /provisional/);
  assert.match(html, /Undo last action/);
  assert.doesNotMatch(html, /recall attempts|answers/);
  assert.doesNotMatch(html, /Graduated to Review|Connections|Feedback/);
});

test('saving cannot promise a countdown or allow Undo or returning before acknowledgement', () => {
  const html = render({ completion: null, saving: true, remainingSeconds: null });
  assert.match(html, /Saving…/);
  assert.doesNotMatch(html, /Returning to Home in/);
  assert.match(html, /disabled=""[^>]*>Return to Home/);
  assert.match(html, /disabled=""[^>]*>Undo last action/);
});

test('expiry disables Undo and retains its inert layout space after closure', () => {
  assert.match(render({ remainingSeconds: 0 }), /disabled=""[^>]*>Undo last action/);
  const html = render({ completion: { ...completion, status: 'closed', canUndo: false }, keepOpen: true });
  assert.match(html, /session-completion-status session-completion-transient is-expired/);
  assert.match(html, /disabled="" aria-hidden="true" tabindex="-1"[^>]*>Undo last action/);
  assert.doesNotMatch(html, /Keep summary open/);
});

test('keep open explains backend closure and failures expose saving retry', () => {
  assert.match(render({ keepOpen: true }), /session will still close automatically/);
  assert.match(render({ error: 'Offline' }), /role="alert">Offline/);
  assert.match(render({ error: 'Offline' }), /Try saving again/);
});

test('completion words honor traditional and both character preferences', () => {
  const withForms = { ...completion, report: { newWords: [{ ...completion.report.newWords[0], hanzi: '学', traditional: '學' }], graduatedWords: [] } };
  assert.match(render({ completion: withForms, characterPresentation: 'traditional' }), /<strong>學<\/strong>/);
  assert.match(render({ completion: withForms, characterPresentation: 'both' }), /<strong>学 \/ 學<\/strong>/);
});

test('immediate actions precede reports and long word groups have native disclosures', () => {
  const longReport = { ...completion, report: { newWords: Array.from({ length: 7 }, (_, index) => ({ ...completion.report.newWords[0], id: `w-${index}` })), graduatedWords: [] } };
  const html = render({ completion: longReport });
  assert.ok(html.indexOf('session-completion-actions') < html.indexOf('session-completion-report'));
  assert.match(html, /session-completion-count">7<\/span>/);
  assert.match(html, /<details><summary>View words<\/summary><ul>/);
  assert.equal((html.match(/<li>/g) ?? []).length, 7);
  assert.doesNotMatch(render(), /<details>/);
});

test('completion shortcuts preserve modifiers, native targets, repeats, and composition', () => {
  const event = { key: ' ', keyCode: 32, isComposing: false };
  assert.equal(resolveCompletionKey(event, false, true), 'home');
  assert.equal(resolveCompletionKey({ ...event, key: 'Backspace' }, false, true), 'undo');
  assert.equal(resolveCompletionKey({ ...event, key: 'u' }, false, true), 'undo');
  assert.equal(resolveCompletionKey({ ...event, key: 'U' }, false, true), 'undo');
  assert.equal(resolveCompletionKey({ ...event, key: 'U', shiftKey: true }, false, true), 'undo');
  assert.equal(resolveCompletionKey({ ...event, key: 'z' }, false, true), 'undo');
  assert.equal(resolveCompletionKey({ ...event, key: 'u' }, false, false), null);
  assert.equal(resolveCompletionKey({ ...event, key: 'Backspace' }, false, false), null);
  assert.equal(resolveCompletionKey(event, true, true), null);
  for (const patch of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { repeat: true }, { defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { key: 'Enter' }]) {
    assert.equal(resolveCompletionKey({ ...event, ...patch }, false, true), null);
  }
});
