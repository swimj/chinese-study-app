import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, test } from 'node:test';
import type { RecoveryHighlight } from '../src/domain/recovery-highlights.ts';
import { RecoveryHighlightList, SessionSummaryPanel } from '../src/features/session/SessionSummaryPanel.tsx';
import { createSessionSummary } from '../src/features/session/session-summary.ts';
import { fetchSessionRecoveryHighlights } from '../src/services/api.ts';

const recognition: RecoveryHighlight = {
  id: 'recovery-one', ruleVersion: 'word_recovery.v1', wordId: 'word-one',
  hanzi: '报备', traditional: '報備', skill: 'recognition',
  troubleRules: ['three_of_five'], troubleAttempts: [], successAttempts: [],
  latestMiss: { attemptId: 'miss', actionId: 'action', sessionId: 'earlier', occurredAt: '2026-10-01T00:00:00Z' },
};
const production: RecoveryHighlight = { ...recognition, id: 'recovery-two', skill: 'production' };

test('recovery list stays absent when no word qualifies', () => {
  assert.equal(renderToStaticMarkup(createElement(RecoveryHighlightList, {
    highlights: [], characterPresentation: 'simplified',
  })), '');
});

test('recovery list shares one heading and distinguishes skills while respecting character preference', () => {
  const markup = renderToStaticMarkup(createElement(RecoveryHighlightList, {
    highlights: [recognition, production], characterPresentation: 'traditional',
  }));
  assert.equal((markup.match(/<h4>/g) ?? []).length, 1);
  assert.equal((markup.match(/<li>/g) ?? []).length, 2);
  assert.match(markup, /Coming back more reliably/);
  assert.match(markup, /Meaning/);
  assert.match(markup, /Word recall/);
  assert.match(markup, /報備/);
  assert.doesNotMatch(markup, /报备|mastered|three_of_five|recovery-one/);
});

test('recovery request component is mounted only after durable finalization', () => {
  const summary = createSessionSummary({ sessionId: 'session', startedAt: '2026-10-06T00:00:00Z', initialQueueLength: 1 });
  for (const kind of ['unfinalized', 'finalizing'] as const) {
    const panel = SessionSummaryPanel({ summary, finalization: { kind }, onRetryReflection() {} });
    assert.equal(panel.props.children[2], null);
  }
  for (const reflection of [{ kind: 'skipped' }, { kind: 'generating' }, { kind: 'failed', error: 'offline', retryable: true }] as const) {
    const panel = SessionSummaryPanel({ summary, finalization: { kind: 'finalized', reflection }, onRetryReflection() {} });
    assert.equal(panel.props.children[2].key, 'session');
    assert.equal(panel.props.children[2].props.sessionId, 'session');
  }
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('recovery API unwraps independent highlights and propagates cancellation', async () => {
  const controller = new AbortController();
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/api\/study-sessions\/session%2Fone\/recovery-highlights$/);
    assert.equal(init?.signal, controller.signal);
    return new Response(JSON.stringify({ highlights: [recognition] }), { status: 200 });
  };
  assert.deepEqual(await fetchSessionRecoveryHighlights('session/one', controller.signal), [recognition]);
});
