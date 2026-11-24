import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { activityStep, createActivity, recordProviderUsage } from './activity.ts';
import { meterUsage } from './activity-pricing.ts';

test('prices model usage once, preserving reported, estimated, unknown and genuine zero', () => {
  const counts = { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 300, cache_write_tokens: 50 },
    output_tokens_details: { reasoning_tokens: 50 } };
  const estimate = meterUsage('openai','gpt-6.2-sol',counts);
  assert.equal(estimate.cost, (650*2 + 300*.1 + 50*2.5 + 200*10) / 1e6);
  const withRetention = { ...counts, input_tokens_details: { ...counts.input_tokens_details,
    cache_write_tokens_details: { ttl_12h_tokens: 20, ttl_30m_tokens: 30 } } };
  assert.equal(meterUsage('openai','gpt-6.2-sol',withRetention).cost,
    (650*2 + 300*.1 + 30*2.5 + 20*5 + 200*10) / 1e6);
  assert.equal(meterUsage('openai','gpt-6-luna', counts).cost, (650*.1 + 300*.01 + 50*.125 + 200*.5) / 1e6);
  assert.equal(estimate.source, 'estimated');
  assert.equal(estimate.reasoning,50);
  assert.deepEqual(JSON.parse(estimate.basis!).perMillion, { input: 2, cached: .1, write: 2.5, output: 10 });
  assert.equal(meterUsage('openai','gpt-6.2-sol',{ input_tokens: 300000, output_tokens: 100 }).cost,
    (300000*4 + 100*15)/1e6);
  assert.equal(meterUsage('openai','gpt-5.4-mini-2026-03-17',{ input_tokens: 1000, output_tokens: 20 }).cost, .00084);
  assert.equal(meterUsage('openrouter','google/some-model',{ cost: 0 }).cost,0);
  assert.equal(meterUsage('openai','gpt-6.2-sol',{}).cost,null);
  assert.equal(meterUsage('openai','unknown',counts).cost,null);
  assert.equal(meterUsage('openai','gpt-6.2-sol',counts,'priority').cost,null);
  assert.equal(meterUsage('openai','gpt-6.2-sol',{ ...counts, input_tokens: 20 }).cost,null);
});

test('period totals count individual attempts by start time and trace preserves complete action history', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createActivity(db);
    await store.action('Tutor', 'request', async () => {
      await activityStep('model','First', async span => {
        recordProviderUsage(span, { usage: { input_tokens: 100, output_tokens: 0 }, model: 'gpt-6.2-sol' });
      }, { provider: 'openai' });
      store.link('Process notice','event-1');
    });
    const action = store.report(1).actions[0];
    await store.background('Process notice','event-1', async () => {
      await assert.rejects(activityStep('model','Notice', async () => { throw Error('private error content'); }));
    });
    await store.action('Local lookup','other',async () => {});
    const trace = store.trace(action.id)!;
    assert.equal(trace.action.callCount,2);
    assert.equal(trace.action.unpriced,1);
    assert.equal(trace.spans.at(-1)?.phase,'background');
    assert.equal(trace.spans.at(-1)?.outcome,'error');
    assert.ok(!JSON.stringify(trace).includes('private error'));
    assert.deepEqual(store.report(1).behaviors.map(group => [group.label,group.actions,group.calls,group.unpriced]), [
      ['Tutor',1,2,1], ['Local lookup',1,0,0],
    ]);
    assert.equal(store.report(1).summary.calls,2);
    assert.equal(store.report(1).summary.backgroundCalls,1);
    assert.equal(store.report(1).actions.find(r => r.reference === 'other')?.callCount,0);
    db.prepare("UPDATE activity_spans SET startedAt='2020-01-01T00:00:00.000Z' WHERE id=?").run(action.id);
    assert.equal(store.report(1).summary.actions,1);
    assert.equal(store.report(1).summary.calls,2);
    assert.equal(store.trace(action.id)?.action.callCount,2);
    assert.equal(store.trace('missing'),null);
  } finally { db.close(); }
});

test('window totals include calls beyond the row limit and abandoned spans do not acquire a fictitious duration', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createActivity(db);
    await store.action('Load','ref',async () => {
      for (let n=0; n<251; n++) await activityStep('model','Step', async () => {});
    });
    const report = store.report(24);
    assert.equal(report.calls.length,250);
    assert.equal(report.summary.calls,251);
    assert.equal(report.truncatedCalls,true);
    db.prepare('UPDATE activity_spans SET finishedAt=NULL,ownerPid=2147483647 WHERE id=?').run(report.calls[0].id);
    const interrupted = createActivity(db).report(24).calls[0];
    assert.equal(interrupted.outcome,'interrupted');
    assert.equal(interrupted.finishedAt,null);
  } finally { db.close(); }
});
