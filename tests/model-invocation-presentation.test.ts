import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModelInvocationRow } from '../src/domain/model-invocations.ts';
import { ModelInvocationTable } from '../src/pages/ModelInvocationsPanel.tsx';
import { formatInvocationLatency, formatInvocationSpend, groupInvocations, invocationDateRange, sortInvocations, summarizeInvocations } from '../src/pages/model-invocation-presentation.ts';

function row(id: string, overrides: Partial<ModelInvocationRow> = {}): ModelInvocationRow {
  return { id, timestamp: '2026-10-06T02:03:04.000Z', provider: 'openai', model: 'model-a', invocationType: 'reflection', learnerId: 'learner-1', userDisplayName: 'Avery', spendUsd: 0.1, spendSource: 'estimated', status: 'completed', latencyMs: null, ...overrides };
}

test('group totals preserve unknown spend and reported zero-cost calls', () => {
  const rows = [row('a'), row('b', { spendUsd: 0, spendSource: 'reported' }), row('c', { spendUsd: null, spendSource: 'unknown', status: 'failed' }), row('d', { learnerId: 'learner-2', spendUsd: null, spendSource: 'unknown' })];
  assert.deepEqual(summarizeInvocations(rows), { count: 4, knownSpendUsd: 0.1, unknownCount: 2, estimatedCount: 1, reportedCount: 1 });
  assert.deepEqual(groupInvocations(rows, 'learnerId'), [
    { key: 'learner-1', count: 3, knownSpendUsd: 0.1, unknownCount: 1, estimatedCount: 1, reportedCount: 1 },
    { key: 'learner-2', count: 1, knownSpendUsd: 0, unknownCount: 1, estimatedCount: 0, reportedCount: 0 },
  ]);
});

test('sorting uses numeric spend, keeps unknown last both ways, and does not mutate API data', () => {
  const rows = [row('unknown', { spendUsd: null }), row('ten', { spendUsd: 10 }), row('two', { spendUsd: 2 }), row('zero', { spendUsd: 0 })];
  assert.deepEqual(sortInvocations(rows, 'spendUsd', 'asc').map((value) => value.id), ['zero', 'two', 'ten', 'unknown']);
  assert.deepEqual(sortInvocations(rows, 'spendUsd', 'desc').map((value) => value.id), ['ten', 'two', 'zero', 'unknown']);
  assert.deepEqual(rows.map((value) => value.id), ['unknown', 'ten', 'two', 'zero']);
});

test('seven-day default and daily grouping use UTC across month boundaries', () => {
  assert.deepEqual(invocationDateRange(new Date('2026-10-01T00:01:00Z')), { from: '2026-09-25', to: '2026-10-01' });
  assert.deepEqual(groupInvocations([row('a', { timestamp: '2026-09-30T23:59:59Z' }), row('b', { timestamp: '2026-10-01T00:00:00Z' })], 'day').map((group) => group.key), ['2026-09-30', '2026-10-01']);
});

test('model/type/user grouping retains distinct values and combines repeated calls', () => {
  const rows = [row('a'), row('b'), row('c', { model: 'model-b', invocationType: 'session_debrief' })];
  assert.deepEqual(groupInvocations(rows, 'model').map((group) => [group.key, group.count]), [['model-a', 2], ['model-b', 1]]);
  assert.deepEqual(groupInvocations(rows, 'invocationType').map((group) => [group.key, group.count]), [['reflection', 2], ['session_debrief', 1]]);
  assert.deepEqual(sortInvocations(rows, 'invocationType', 'desc').map((value) => value.id), ['c', 'a', 'b']);
});

test('call table identifies users, provider, timestamp, source and unavailable spend', () => {
  const html = renderToStaticMarkup(createElement(ModelInvocationTable, { rows: [row('a'), row('b', { spendUsd: null, spendSource: 'unknown', status: 'failed' }), row('c', { spendUsd: 0, spendSource: 'reported' })] }));
  for (const text of ['Avery', 'learner-1', 'model-a', 'openai', '2026-10-06 02:03:04', 'estimated', 'reported', 'Unknown', 'Failed', '$0.0000']) assert.ok(html.includes(text), text);
  assert.equal(formatInvocationSpend(0.0000001), '<$0.0001');
  assert.equal(formatInvocationSpend(null), 'Unknown');
});


test('latency sorts numerically with missing historical values last and displays timeout and validation status', () => {
  const rows = [row('old'), row('timeout', { latencyMs: 180000, status: 'timed_out' }),
    row('invalid', { latencyMs: 1234, status: 'invalid_response' })];
  assert.deepEqual(sortInvocations(rows, 'latencyMs', 'asc').map((item) => item.id), ['invalid', 'timeout', 'old']);
  assert.deepEqual(sortInvocations(rows, 'latencyMs', 'desc').map((item) => item.id), ['timeout', 'invalid', 'old']);
  const markup = renderToStaticMarkup(createElement(ModelInvocationTable, { rows }));
  assert.match(markup, /Timed out/);
  assert.match(markup, /Invalid response/);
  assert.match(markup, /180 s/);
  assert.match(markup, /1.234 s/);
  assert.equal(formatInvocationLatency(0), '0 ms');
  assert.equal(formatInvocationLatency(null), '—');
});
