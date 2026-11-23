import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildFixture } from './fixture.ts';
import { compose } from './public/media-policy.js';

test('the fixture shows one placed picture (报刊亭) and one latent picture (鸟食)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-media-fixture-'));
  try {
    const state = await buildFixture(join(dir, 'fixture.sqlite'));
    const levels = compose(state, Date.now());
    const shown = state.media.map((m) => [m.caption, levels[m.id].level]);
    assert.deepEqual(shown.sort(), [['旧报刊亭', 'placed'], ['鸟食', 'latent']]);
    for (const m of state.media) {
      assert.equal(m.origin, 'system');
      assert.ok(m.credit?.text && m.license?.url && m.source.pageUrl.startsWith('https://commons.wikimedia.org/'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
