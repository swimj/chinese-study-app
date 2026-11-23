import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildFixture } from './fixture.ts';
import { openJournal } from './journal.ts';
import { mediaReport } from './media-report.ts';
import { demoFriend, demoTutor } from './practice.ts';
import type { TurnContext } from './tutor.ts';

test('the media report lists decisions, ceilings, composed levels with reasons, and reactions, without writing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-media-report-'));
  const path = join(dir, 'fixture.sqlite');
  try {
    await buildFixture(path);
    const j = openJournal(path, { mode: 'demo', tutor: async (ctx: TurnContext) => demoTutor(ctx), friend: async (ctx: TurnContext) => demoFriend(ctx) });
    const kiosk = j.get().media.find((m) => m.caption === '旧报刊亭')!;
    await j.act({ type: 'mediaReaction', id: randomUUID(), mediaId: kiosk.id, reaction: 'notForMe' });
    j.close();
    const before = readFileSync(path);
    const mtime = statSync(path).mtimeMs;
    const report = mediaReport(path);
    assert.deepEqual(readFileSync(path), before);
    assert.equal(statSync(path).mtimeMs, mtime);
    assert.match(report.text, /Pictures normal · model turns today \d+\/20 · pending 0 · taste caps none/);
    assert.match(report.text, /旧报刊亭 · image · system · ceiling placed → shown none \(not-for-me\) · notForMe /);
    assert.match(report.text, /鸟食 · image · system · ceiling latent → shown latent/);
    assert.match(report.text, /word 鸟食 · concrete · entity · memory · real · fits → latent \(attached\)/);
    assert.match(report.text, /word 分心 · abstract · none · none · real · fits → none/);
    assert.match(report.text, /addedValue: A Chinese roadside newspaper kiosk/);
    assert.equal(report.decisions.length, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
