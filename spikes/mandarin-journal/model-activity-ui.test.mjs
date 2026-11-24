import test from 'node:test';
import assert from 'node:assert/strict';
import { actionSpend, money, sortRows, traceLayout } from './public/model-activity.js';

test('model spend preserves zero, small amounts, partial coverage and missing prices', () => {
  const action = { callCount: 3, unpriced: 1, knownUsd: 0.00002 };
  assert.equal(actionSpend(action), '$0.00002 + unknown');
  assert.equal(actionSpend({ ...action, unpriced: 3 }), 'Unknown');
  assert.equal(actionSpend({ callCount: 0, knownUsd: 0, unpriced: 0 }), '$0.00');
  assert.equal(money(0.000000001), '<$0.000001');
  assert.equal(money(null), 'Unknown');
  assert.equal(money(0), '$0.00');
  assert.deepEqual(sortRows([{ ...action, id: 'unpriced', unpriced: 3 }, { ...action, id: 'zero', knownUsd: 0 }], 'spend', true).map(row => row.id), ['zero', 'unpriced']);
});

const instant = ms => new Date(Date.UTC(2026, 10, 24) + ms).toISOString();
const row = (id, parentId, kind, start, end, props = {}) => ({
  id, parentId, kind, label: id, phase: 'foreground', startedAt: instant(start), finishedAt: end === null ? null : instant(end), ...props,
});

test('timeline places the reply beside overlapping spans and preserves hierarchy and tool dependencies', () => {
  const a = row('Capture', null, 'action', 0, 900);
  const run = row('Agent', a.id, 'run', 0, 1600);
  const call = row('Decide', run.id, 'model', 2, 1499);
  const tool = row('Lookup', run.id, 'tool', 1499, 1600, { dependsOn: [call.id], phase: 'background' });
  const open = row('Next turn', run.id, 'model', 1640, null, { dependsOn: [tool.id], outcome: 'interrupted' });
  const { entries, throughMs } = traceLayout(a, [run, call, tool, open]);
  assert.deepEqual(entries.map(item => item.kind), ['run', 'model', 'reply', 'tool', 'model']);
  assert.equal(throughMs, 1640);
  assert.equal(entries[2].start, 900);
  assert.deepEqual(entries[3].dependencies, ['#2 Decide']);
  assert.equal(entries[3].parent, 1);
  assert.equal(entries[3].depth, 1);
  assert.deepEqual(entries[4].dependencies, ['#4 Lookup']);
  assert.equal(entries[4].duration, null);
});

test('background roots and interrupted requests have no server reply event', () => {
  assert.deepEqual(traceLayout(row('legacy', null, 'action', 0, 600, { phase: 'background' }), []), { entries: [], throughMs: 600 });
  assert.deepEqual(traceLayout(row('incomplete', null, 'action', 0, null), []), { entries: [], throughMs: 0 });
});
