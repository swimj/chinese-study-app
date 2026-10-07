import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { after, before, test } from 'node:test';

const envKeys = ['APP_MODE', 'APP_DATA_DIR', 'APP_LEARNER_ID', 'APP_AUTH_MODE'] as const;
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let dir: string;
let server: http.Server;
let base: string;
let db: typeof import('../server/db.ts');

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentence-character-settings-'));
  Object.assign(process.env, {
    APP_MODE: 'study', APP_DATA_DIR: dir,
    APP_LEARNER_ID: 'sentence-settings-learner', APP_AUTH_MODE: 'trusted_local',
  });
  const { createApp } = await import('../server/index.ts');
  db = await import('../server/db.ts');
  server = createApp({ frontendDistPath: null }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('sentence preference defaults to simplified, persists privately and survives card-setting changes', async () => {
  assert.equal(db.getSentenceCharacterPresentation(), 'simplified');
  const response = await fetch(`${base}/api/learner-settings/sentence-character-presentation`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentenceCharacterPresentation: 'traditional', learnerId: 'forged' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sentenceCharacterPresentation: 'traditional' });
  db.setCharacterPresentation('simplified');
  assert.equal(db.getSentenceCharacterPresentation(), 'traditional');
  db.setCharacterPresentation('both');
  assert.equal(db.getSentenceCharacterPresentation(), 'traditional');
  const status = await fetch(`${base}/api/status?studyDayKey=2026-10-05`).then(response => response.json());
  assert.equal(status.sentenceCharacterPresentation, 'traditional');
  const { getDb } = await import('../server/db/connection.ts');
  const stored = getDb().prepare(`SELECT learner_id, value_json FROM learner_settings WHERE setting_key = 'sentence_character_presentation'`).all();
  assert.deepEqual(stored.map(row => ({ ...row })), [
    { learner_id: 'sentence-settings-learner', value_json: '"traditional"' },
  ]);
  getDb().prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES (?, ?, ?)`).run('sentence-settings-other', 'Other', new Date().toISOString());
  db.runWithLearnerId('sentence-settings-other', () => {
    assert.equal(db.getSentenceCharacterPresentation(), 'simplified');
    db.setSentenceCharacterPresentation('simplified');
  });
  assert.equal(db.getSentenceCharacterPresentation(), 'traditional');
});

test('sentence setting rejects both, missing and unknown presentations', async () => {
  for (const value of ['both', 'pinyin', null, undefined]) {
    const response = await fetch(`${base}/api/learner-settings/sentence-character-presentation`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentenceCharacterPresentation: value }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(db.getSentenceCharacterPresentation(), 'traditional');
});


test('new-word ordering defaults off, validates booleans, persists and remains learner-private', async () => {
  assert.equal(db.getStudyNewWordsFirst(), false);
  for (const value of [true, false, true]) {
    const response = await fetch(`${base}/api/learner-settings/study-new-words-first`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studyNewWordsFirst: value, learnerId: 'forged' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { studyNewWordsFirst: value });
    assert.equal(db.getStudyNewWordsFirst(), value);
  }
  for (const value of ['true', 1, null, undefined]) {
    const response = await fetch(`${base}/api/learner-settings/study-new-words-first`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studyNewWordsFirst: value }),
    });
    assert.equal(response.status, 400);
  }
  const status = await fetch(`${base}/api/status?studyDayKey=2026-10-07`).then(response => response.json());
  assert.equal(status.studyNewWordsFirst, true);
  const { getDb } = await import('../server/db/connection.ts');
  const stored = getDb().prepare("SELECT learner_id, value_json FROM learner_settings WHERE setting_key = 'study_new_words_first'").all();
  assert.deepEqual(stored.map(row => ({ ...row })), [
    { learner_id: 'sentence-settings-learner', value_json: 'true' },
  ]);
  db.runWithLearnerId('sentence-settings-other', () => assert.equal(db.getStudyNewWordsFirst(), false));
  assert.equal(db.getStudyNewWordsFirst(), true);
});
