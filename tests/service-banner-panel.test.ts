import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUpdateNotice } from '../src/features/operator/service-banner.ts';

test('planned notice uses kickoff in its message and expires 24 hours after kickoff', () => {
  const kickoff = '2030-10-12T18:30';
  const result = buildUpdateNotice(kickoff, new Date('2030-10-10T00:00:00Z').getTime());
  assert.ok(result);
  assert.match(result.message, /service update is planned to start around/);
  assert.match(result.message, /Oct 12, 2030/);
  assert.match(result.message, /finish your study session/);
  assert.ok(result.message.length <= 280);
  assert.equal(new Date(result.expiresAt).getTime() - new Date(kickoff).getTime(), 24 * 60 * 60 * 1000);
});

test('blank, invalid, past, and present kickoff times cannot produce a notice', () => {
  const now = new Date('2030-10-12T18:30').getTime();
  for (const input of ['', 'invalid', '2030-10-11T18:30', '2030-10-12T18:30']) {
    assert.equal(buildUpdateNotice(input, now), null);
  }
});
