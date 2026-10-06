import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { SessionRecoveryHighlights } from '../src/features/session/SessionSummaryPanel.tsx';
import { SessionDebriefCard } from '../src/features/session/SessionDebriefPanel.tsx';
import { resolveSessionDebriefKey } from '../src/features/session/session-debrief-keyboard.ts';
import type { SessionDebriefLoadState } from '../src/features/session/session-debrief-loader.ts';
import { SessionSettingsPanel } from '../src/pages/HomeOverviewPanel.tsx';
import type { BackendStatus } from '../src/services/api.ts';

const state: SessionDebriefLoadState = { loading: false, retrying: false, error: null,
  debrief: { sessionId: 'one', completedAt: '2026-10-06T00:00:00.000Z', exerciseCount: 3, status: 'ready', attemptCount: 1, error: null,
    notes: [{ text: 'First paragraph\nwith preserved breaks.', refs: ['w1'], followUp: 'Never show this chat invitation' }, { text: 'Second paragraph', refs: ['w2'], followUp: null }] } };
function render(value = state, index = 0) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(SessionDebriefCard, { sessionId: 'session', state: value, index, busy: false, onNext: noop, onBack: noop,
    onDone: noop, onRetry: noop, onReload: noop, onGuide: noop }));
}
test('one connection per card with only exact text and progress; final card has Done', () => {
  const first = render(); assert.match(first, /First paragraph\nwith preserved breaks/); assert.doesNotMatch(first, /Second paragraph|w1|Never show this/);
  assert.match(first, /Connection 1 of 2/); assert.match(first, /Next connection/); assert.match(first, /disabled="">Back/);
  const last = render(state, 1); assert.match(last, /Second paragraph/); assert.doesNotMatch(last, /First paragraph|Next connection/); assert.match(last, />Done/);
});
test('pending, failed, empty, and read-error summaries all allow leaving with the right recovery action', () => {
  const pending = render({ ...state, debrief: { ...state.debrief!, status: 'running', notes: null } });
  assert.match(pending, /Finding a few connections/); assert.match(pending, /Back to Home/); assert.doesNotMatch(pending, /First paragraph|remaining|Practice again/);
  const failed = render({ ...state, debrief: { ...state.debrief!, status: 'failed', notes: null } });
  assert.match(failed, /Try again/); assert.match(failed, /Your session is saved/);
  assert.match(render({ ...state, debrief: { ...state.debrief!, notes: [] } }), /Nothing extra to add/);
  assert.match(render({ ...state, error: 'Offline' }), /Try loading again/);
});
const context = { editable: false, native: false, guideOpen: false, busy: false, ready: true, canGoBack: true };
const event = { key: ' ', isComposing: false, keyCode: 32 };
test('summary keys step without replaying study actions and respect IME, native controls, typing, guide and modifiers', () => {
  for (const key of [' ', 'Enter', 'ArrowRight']) assert.equal(resolveSessionDebriefKey({ ...event, key }, context), 'next');
  assert.equal(resolveSessionDebriefKey({ ...event, key: 'ArrowLeft' }, context), 'back');
  assert.equal(resolveSessionDebriefKey({ ...event, key: 'ArrowLeft' }, { ...context, canGoBack: false }), null);
  assert.equal(resolveSessionDebriefKey({ ...event, key: '?' }, context), 'guide');
  for (const override of [{ editable: true }, { native: true }, { guideOpen: true }, { busy: true }, { ready: false }]) {
    assert.equal(resolveSessionDebriefKey(event, { ...context, ...override }), null);
  }
  for (const override of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    assert.equal(resolveSessionDebriefKey({ ...event, ...override }, context), null);
  }
  for (const key of ['u', 'e', '1', '2']) assert.equal(resolveSessionDebriefKey({ ...event, key }, context), null);
});
test('optional interests are blank by default, remembered verbatim, bounded, and Mandarin only', () => {
  function settings(studyProfile: BackendStatus['studyProfile'], debriefInterests?: string) {
    return renderToStaticMarkup(createElement(SessionSettingsPanel, { backendStatus: { studyProfile, debriefInterests, dailyNewWordLimit: 10 } as BackendStatus,
      onSaveSessionSettings: async () => {}, onSavingChange: () => {}, onClose: () => {} }));
  }
  assert.match(settings('mandarin'), /<textarea[^>]*maxLength="1000"[^>]*><\/textarea>/);
  assert.match(settings('mandarin', '  A topic\nAnother  '), /  A topic\nAnother  /);
  assert.doesNotMatch(settings('french', 'A topic'), /debrief-interests|A topic/);
});

test('recovery highlights stay independent of generated connections and retain session identity and script', () => {
  const noop = () => {};
  const states: SessionDebriefLoadState[] = [
    state,
    { ...state, loading: true, debrief: null },
    { ...state, debrief: { ...state.debrief!, status: 'running', notes: null } },
    { ...state, debrief: { ...state.debrief!, status: 'failed', notes: null } },
    { ...state, debrief: { ...state.debrief!, notes: [] } },
    { ...state, error: 'Offline' },
  ];
  for (const value of states) {
    const card = SessionDebriefCard({
      sessionId: 'saved-session', characterPresentation: 'traditional', state: value, index: 0,
      busy: false, onNext: noop, onBack: noop, onDone: noop, onRetry: noop, onReload: noop, onGuide: noop,
    });
    const recovery = card.props.children[0].props.children[3];
    assert.equal(recovery.type, SessionRecoveryHighlights);
    assert.equal(recovery.key, 'saved-session');
    assert.equal(recovery.props.sessionId, 'saved-session');
    assert.equal(recovery.props.characterPresentation, 'traditional');
  }
});
