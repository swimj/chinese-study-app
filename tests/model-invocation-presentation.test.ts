import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModelInvocationRow } from '../src/domain/model-invocations.ts';
import { ModelInvocationTable } from '../src/pages/ModelInvocationsPanel.tsx';
import { columnHasFilter } from '../src/pages/InvocationColumnDialog.tsx';
import { defaultInvocationFilters, filterInvocations, groupedInvocationRows, invocationWindowSummaries, nextInvocationLimit, isFailedInvocation, type InvocationFilters, formatInvocationLatency, formatInvocationSpend, groupInvocations, invocationDateRange, sortInvocations, summarizeInvocations } from '../src/pages/model-invocation-presentation.ts';

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

const allHistory = (): InvocationFilters => ({ from: '', to: '', discrete: {}, numeric: {} });

test('UTC summaries use whole calendar days and remain independent of column selection or rendering limit', () => {
  const now = new Date('2026-10-01T00:01:00.000Z');
  const rows = [
    row('before', { timestamp: '2026-09-24T23:59:59.999Z', spendUsd: 50 }),
    row('first', { timestamp: '2026-09-25T00:00:00.000Z', spendUsd: 2 }),
    ...Array.from({ length: 75 }, (_, i) => row(`today-${i}`, { timestamp: '2026-10-01T23:59:59.999Z', spendUsd: 1 })),
    row('unknown', { timestamp: '2026-10-01T00:00:00Z', spendUsd: null, spendSource: 'unknown' }),
    row('tomorrow', { timestamp: '2026-10-02T00:00:00.000Z', spendUsd: 100 }),
  ];
  const defaults = defaultInvocationFilters(now);
  assert.equal(filterInvocations(rows, defaults).length, 77);
  const selected = filterInvocations(rows, { ...allHistory(), from: '2026-09-24', to: '2026-09-24' });
  const summaries = invocationWindowSummaries(rows, selected, now);
  assert.deepEqual(summaries.map(({ label, count, knownSpendUsd, unknownCount }) => ({ label, count, knownSpendUsd, unknownCount })), [
    { label: 'Today', count: 76, knownSpendUsd: 75, unknownCount: 1 },
    { label: 'Last 7 days', count: 77, knownSpendUsd: 77, unknownCount: 1 },
    { label: 'Current selection', count: 1, knownSpendUsd: 50, unknownCount: 0 },
  ]);
  assert.equal(invocationWindowSummaries(rows, filterInvocations(rows, defaults), now)[2].count, 77);
});

test('discrete multiselect All includes newly loaded values, None excludes all, fields intersect', () => {
  const rows = [row('a'), row('b', { model: 'model-b', status: 'failed', provider: 'openrouter' }), row('c', { model: 'model-b', learnerId: 'learner-2' })];
  assert.equal(filterInvocations(rows, allHistory()).length, 3);
  assert.equal(filterInvocations(rows, { ...allHistory(), discrete: { model: [] } }).length, 0);
  assert.deepEqual(filterInvocations(rows, { ...allHistory(), discrete: { model: ['model-b'], status: ['failed'], provider: ['openrouter'] } }).map((item) => item.id), ['b']);
  assert.deepEqual(filterInvocations(rows, { ...allHistory(), discrete: { learnerId: ['learner-2'], invocationType: ['reflection'], spendSource: ['estimated'] } }).map((item) => item.id), ['c']);
  assert.equal(filterInvocations([...rows, row('new-model', { model: 'fresh-model' })], allHistory()).length, 4);
});

test('numeric bounds are inclusive, preserve zero and give unknowns explicit semantics; latency uses seconds', () => {
  const rows = [row('zero', { spendUsd: 0, latencyMs: 0 }), row('low', { spendUsd: 0.1, latencyMs: 1000 }), row('high', { spendUsd: 1, latencyMs: 2000 }), row('unknown', { spendUsd: null, latencyMs: null })];
  const filtered = (unknown: 'include' | 'exclude' | 'only') => filterInvocations(rows, { ...allHistory(), numeric: { spendUsd: { min: '0', max: '0.1', unknown } } }).map((item) => item.id);
  assert.deepEqual(filtered('include'), ['zero', 'low', 'unknown']);
  assert.deepEqual(filtered('exclude'), ['zero', 'low']);
  assert.deepEqual(filtered('only'), ['unknown']);
  assert.deepEqual(filterInvocations(rows, { ...allHistory(), numeric: { latencyMs: { min: '1', max: '2', unknown: 'exclude' } } }).map((item) => item.id), ['low', 'high']);
});

test('filtering precedes grouping, grouped rows retain within-group sort, and partial rendering keeps full group totals', () => {
  const rows = [row('b1', { model: 'model-b', spendUsd: 4 }), row('a1', { spendUsd: 1 }), row('b2', { model: 'model-b', spendUsd: 2 }), row('excluded', { spendUsd: 3, status: 'failed' })];
  const selection = filterInvocations(rows, { ...allHistory(), discrete: { status: ['completed'] } });
  const grouped = groupedInvocationRows(sortInvocations(selection, 'spendUsd', 'desc'), 'model', 'asc');
  assert.deepEqual(grouped.map((item) => item.id), ['a1', 'b1', 'b2']);
  const markup = renderToStaticMarkup(createElement(ModelInvocationTable, { rows: grouped.slice(0, 2), allSelectedRows: selection, groupBy: 'model' }));
  assert.match(markup, /2 calls/);
  assert.match(markup, /\$6\.0000 known spend/);
  assert.ok(!markup.includes('excluded'));
  for (const label of ['Timestamp (UTC)', 'Model', 'Invocation type', 'Spend (USD)', 'User', 'Latency', 'Status']) assert.ok(markup.includes(label));
});

test('numeric grouping is numeric, unknown last, and progressive rendering stops at total', () => {
  const rows = [row('unknown', { spendUsd: null }), row('ten', { spendUsd: 10 }), row('two', { spendUsd: 2 })];
  assert.deepEqual(groupedInvocationRows(rows, 'spendUsd', 'asc').map((item) => item.id), ['two', 'ten', 'unknown']);
  assert.deepEqual(groupedInvocationRows(rows, 'spendUsd', 'desc').map((item) => item.id), ['ten', 'two', 'unknown']);
  assert.equal(nextInvocationLimit(50, 121), 100);
  assert.equal(nextInvocationLimit(100, 121), 121);
  assert.equal(nextInvocationLimit(121, 121), 121);
});

test('failure shading is opt-in and includes all three failure outcomes', () => {
  const rows = (['completed', 'running', 'failed', 'timed_out', 'invalid_response'] as const).map((status) => row(status, { status }));
  assert.deepEqual(rows.filter(isFailedInvocation).map((item) => item.id), ['failed', 'timed_out', 'invalid_response']);
  assert.ok(!renderToStaticMarkup(createElement(ModelInvocationTable, { rows })).includes('operator-ledger-failure'));
  assert.equal(renderToStaticMarkup(createElement(ModelInvocationTable, { rows, shadeFailures: true })).match(/class="operator-ledger-failure"/g)?.length, 3);
});

test('header filter indicators include secondary provider/source filters and explicit None', () => {
  assert.equal(columnHasFilter('model', { ...allHistory(), discrete: { provider: ['openai'] } }), true);
  assert.equal(columnHasFilter('spendUsd', { ...allHistory(), discrete: { spendSource: [] } }), true);
  assert.equal(columnHasFilter('status', { ...allHistory(), discrete: { status: [] } }), true);
  assert.equal(columnHasFilter('timestamp', defaultInvocationFilters(new Date('2026-10-01T00:00:00Z'))), true);
  assert.equal(columnHasFilter('timestamp', allHistory()), false);
});

test('exact numeric group labels distinguish values that round to the same table display', () => {
  const spendRows = [row('a', { spendUsd: 0.000113 }), row('b', { spendUsd: 0.000119 })];
  const spend = renderToStaticMarkup(createElement(ModelInvocationTable, { rows: spendRows, groupBy: 'spendUsd' }));
  assert.match(spend, /\$0\.000113 USD/);
  assert.match(spend, /\$0\.000119 USD/);
  const latency = renderToStaticMarkup(createElement(ModelInvocationTable, { rows: [row('a', { latencyMs: 10.1 }), row('b', { latencyMs: 10.2 })], groupBy: 'latencyMs' }));
  assert.match(latency, /10\.1 ms/);
  assert.match(latency, /10\.2 ms/);
});
