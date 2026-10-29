import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUpdateNotice, serviceBannerMessage } from '../src/features/operator/service-banner.ts';

test('operator UTC and local perspectives identify the same future kickoff', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const now = Date.parse('2030-01-01T00:00:00Z');
    assert.deepEqual(buildUpdateNotice('2030-07-02T18:30', now), { kickoffAt: '2030-07-02T22:30:00.000Z' });
    assert.deepEqual(buildUpdateNotice('2030-07-02T22:30', now, 'utc'), buildUpdateNotice('2030-07-02T18:30', now));
    assert.equal(buildUpdateNotice('2030-03-10T02:30', now), null); // nonexistent local time
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('learner kickoff uses viewer date and DST offset, independent of authored fallback text', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const summer = serviceBannerMessage({ message: 'fallback', kickoffAt: '2030-07-02T00:30:00.000Z' });
    assert.match(summer, /Jul 1, 2030.*5:30 PM PDT/);
    const winter = serviceBannerMessage({ message: 'fallback', kickoffAt: '2030-01-02T00:30:00.000Z' });
    assert.match(winter, /Jan 1, 2030.*4:30 PM PST/);
    process.env.TZ = 'Asia/Tokyo';
    assert.match(serviceBannerMessage({ message: 'fallback', kickoffAt: '2030-07-02T00:30:00.000Z' }), /Jul 2, 2030.*9:30 AM GMT\+9/);
    assert.equal(serviceBannerMessage({ message: 'Authored time: 18:30 UTC' }), 'Authored time: 18:30 UTC');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('blank, malformed, invalid calendar, past, and present kickoff times cannot produce a notice', () => {
  const now = new Date('2030-10-12T18:30').getTime();
  for (const input of ['', 'invalid', '2030-10-11T18:30', '2030-10-12T18:30', '2031-02-30T18:30']) {
    assert.equal(buildUpdateNotice(input, now), null);
  }
});
