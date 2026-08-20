import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';
type DbModule = typeof import('../server/db.ts');
const studyDayKey = '2026-01-10';

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('user priority layer', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-priority-tests-'));
    dbPath = path.join(dataDir, 'app.db');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
    dbModule = await import(moduleUrl);

    if (previousMode === undefined) {
      delete process.env.APP_MODE;
    } else {
      process.env.APP_MODE = previousMode;
    }

    if (previousDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousDataDir;
    }

    sqlite = new DatabaseSync(dbPath);
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      DELETE FROM daily_new_word_intake;
      DELETE FROM user_word_priority;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('migration/bootstrap creates user_word_priority table', () => {
    const columns = sqlite.prepare('PRAGMA table_info(user_word_priority)').all() as Array<{ name: string }>;
    assert.deepEqual(columns.map((column) => column.name), [
      'word_id',
      'bump_count',
      'force_top',
      'priority_tier',
      'required_for_next_session',
      'updated_at',
    ]);
  });

  test('bump count clamps to [0, 10], force-top toggles, required toggles, and reset clears overrides', () => {
    insertWord('priority-word', 73, 'unstudied', '2026-01-01T00:00:00.000Z');

    const maxed = dbModule.updateWordUserPriority('priority-word', { bumpDelta: 999 });
    assert.equal(maxed.bumpCount, 10);

    const clampedToZero = dbModule.updateWordUserPriority('priority-word', { bumpDelta: -999 });
    assert.equal(clampedToZero.bumpCount, 0);

    const forceTopOn = dbModule.updateWordUserPriority('priority-word', { forceTop: true });
    assert.equal(forceTopOn.forceTop, true);

    const requiredOn = dbModule.updateWordUserPriority('priority-word', { requiredForNextSession: true });
    assert.equal(requiredOn.requiredForNextSession, true);

    const requiredOff = dbModule.updateWordUserPriority('priority-word', { requiredForNextSession: false });
    assert.equal(requiredOff.requiredForNextSession, false);

    const reset = dbModule.updateWordUserPriority('priority-word', { reset: true });
    assert.equal(reset.bumpCount, 0);
    assert.equal(reset.forceTop, false);
    assert.equal(reset.requiredForNextSession, false);

    const persisted = sqlite
      .prepare('SELECT word_id FROM user_word_priority WHERE word_id = ?')
      .get('priority-word') as { word_id: string } | undefined;
    assert.equal(persisted, undefined);
  });

  test('boost unit uses the fixed policy constant and affects effective priority', () => {
    insertWord('top-base', 94, 'unstudied', '2026-01-01T00:00:00.000Z');
    insertWord('boosted', 50, 'unstudied', '2026-01-02T00:00:00.000Z');

    const updated = dbModule.updateWordUserPriority('boosted', { bumpDelta: 2 });

    // Fixed bump unit is currently 12248.
    assert.equal(updated.effectivePriority, 50 + 2 * 12248);
  });

  test('add-by-hanzi adds all matching unstudied words into the prioritized list', () => {
    insertWord('dup-a', 70, 'unstudied', '2026-01-01T00:00:00.000Z', '学');
    insertWord('dup-b', 60, 'unstudied', '2026-01-02T00:00:00.000Z', '学');
    insertWord('dup-c', 50, 'learning', '2026-01-03T00:00:00.000Z', '学');

    const added = dbModule.addUnstudiedUserPriorityByHanzi('学');
    assert.equal(added.length, 2);
    assert(added.every((word) => word.bumpCount >= 1));

    const prioritizedIds = dbModule.getPrioritizedUnstudiedWords().words.map((entry) => entry.word.id);
    assert.deepEqual(prioritizedIds, ['dup-a', 'dup-b']);
  });

  test('add-by-hanzi can require all matching unstudied words', () => {
    insertWord('required-dup-a', 70, 'unstudied', '2026-01-01T00:00:00.000Z', '要');
    insertWord('required-dup-b', 60, 'unstudied', '2026-01-02T00:00:00.000Z', '要');

    const added = dbModule.addUnstudiedUserPriorityByHanzi('要', true);
    assert.equal(added.length, 2);
    assert(added.every((word) => word.requiredForNextSession));

    const prioritized = dbModule.getPrioritizedUnstudiedWords().words;
    assert.deepEqual(prioritized.map((entry) => entry.word.id), ['required-dup-a', 'required-dup-b']);
    assert(prioritized.every((entry) => entry.requiredForNextSession));
  });

  test('prioritized list includes required-only rows and excludes sunk rows', () => {
    insertWord('required-only', 70, 'unstudied', '2026-01-01T00:00:00.000Z');
    insertWord('sunk-boosted', 100, 'unstudied', '2026-01-02T00:00:00.000Z');

    dbModule.updateWordUserPriority('required-only', { requiredForNextSession: true });
    dbModule.updateWordUserPriority('sunk-boosted', { bumpDelta: 1 });
    dbModule.dismissWordFromStudy('sunk-boosted');

    const prioritized = dbModule.getPrioritizedUnstudiedWords().words;

    assert.deepEqual(prioritized.map((entry) => entry.word.id), ['required-only']);
    assert.equal(prioritized[0]?.bumpCount, 0);
    assert.equal(prioritized[0]?.requiredForNextSession, true);
  });

  test('dismiss clears required state while sinking the word', () => {
    insertWord('required-dismissed', 50, 'unstudied', '2026-01-01T00:00:00.000Z');

    dbModule.updateWordUserPriority('required-dismissed', { requiredForNextSession: true });
    dbModule.dismissWordFromStudy('required-dismissed');

    const priorityRow = sqlite
      .prepare('SELECT priority_tier, required_for_next_session FROM user_word_priority WHERE word_id = ?')
      .get('required-dismissed') as { priority_tier: number; required_for_next_session: number };
    assert.equal(priorityRow.priority_tier, -1);
    assert.equal(priorityRow.required_for_next_session, 0);
  });

  test('unstudied ordering is forceTop > effective > base > createdAt', () => {
    insertWord('base-high-older', 100, 'unstudied', '2026-01-01T00:00:00.000Z');
    insertWord('base-high-newer', 100, 'unstudied', '2026-01-02T00:00:00.000Z');
    insertWord('boosted', 60, 'unstudied', '2026-01-03T00:00:00.000Z');
    insertWord('forced', 10, 'unstudied', '2026-01-04T00:00:00.000Z');

    dbModule.updateWordUserPriority('boosted', { bumpDelta: 5 });
    dbModule.updateWordUserPriority('forced', { forceTop: true });

    const ordered = dbModule.getUnstudiedPriorityWords().words.map((entry) => entry.word.id);
    assert.deepEqual(ordered, ['forced', 'boosted', 'base-high-older', 'base-high-newer']);
  });

  test('session unstudied intake respects cap and expected selection set', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);

    insertWord('old-base', 60, 'unstudied', '2026-01-01T00:00:00.000Z');
    insertWord('boosted', 55, 'unstudied', '2026-01-02T00:00:00.000Z');
    insertWord('forced', 1, 'unstudied', '2026-01-03T00:00:00.000Z');
    insertWord('very-low', -100, 'unstudied', '2026-01-04T00:00:00.000Z');

    dbModule.updateWordUserPriority('boosted', { bumpDelta: 1 });
    dbModule.updateWordUserPriority('forced', { forceTop: true });

    const sessionIds = getSessionItemIds(dbModule);
    const sessionIdSet = new Set(sessionIds);
    const expectedIdSet = new Set([
      'unstudied/forced',
      'unstudied/boosted',
      'unstudied/old-base',
      'unstudied/very-low',
    ].slice(0, dailyNewWordLimit));

    assert.equal(sessionIds.length, expectedIdSet.size);
    assert.deepEqual(sessionIdSet, expectedIdSet);
  });

  test('sunk words rank below regular words in unstudied ordering', () => {
    insertWord('regular-word', 40, 'unstudied', '2026-01-01T00:00:00.000Z');
    insertWord('sunk-word', 100, 'unstudied', '2026-01-02T00:00:00.000Z');

    dbModule.dismissWordFromStudy('sunk-word');

    const ordered = dbModule.getUnstudiedPriorityWords().words.map((entry) => entry.word.id);
    assert.deepEqual(ordered.slice(0, 2), ['regular-word', 'sunk-word']);
  });

  test('top triage list is capped and excludes every explicit user priority override', () => {
    insertWord('sunk-word', 100, 'unstudied', '2026-01-01T00:00:00.000Z');
    insertWord('forced-word', 1, 'unstudied', '2026-01-02T00:00:00.000Z');
    insertWord('regular-high', 80, 'unstudied', '2026-01-03T00:00:00.000Z');
    insertWord('regular-low', 20, 'unstudied', '2026-01-04T00:00:00.000Z');
    insertWord('bumped-word', 90, 'unstudied', '2026-01-05T00:00:00.000Z');
    insertWord('required-word', 85, 'unstudied', '2026-01-06T00:00:00.000Z');

    dbModule.dismissWordFromStudy('sunk-word');
    dbModule.updateWordUserPriority('forced-word', { forceTop: true });
    dbModule.updateWordUserPriority('bumped-word', { bumpDelta: 1 });
    dbModule.updateWordUserPriority('required-word', { requiredForNextSession: true });

    const ordered = dbModule.getTopUnstudiedPriorityWords(2).words.map((entry) => entry.word.id);
    assert.deepEqual(ordered, ['regular-high', 'regular-low']);
  });

  test('non-unstudied words cannot be updated', () => {
    insertWord('learning-word', 80, 'learning', '2026-01-01T00:00:00.000Z');

    assert.throws(() => {
      dbModule.updateWordUserPriority('learning-word', { bumpDelta: 1 });
    }, /Expected unstudied word/);
  });
});

function insertWord(id: string, priority: number, status: WordStatus, createdAt: string, hanzi = `${id}-hanzi`) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      pinyin,
      meaning,
      meanings_json,
      personal_notes,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    hanzi,
    `${id}-pinyin`,
    `${id}-meaning`,
    JSON.stringify([`${id}-meaning`]),
    '',
    JSON.stringify([`${id}-example`]),
    status,
    priority,
    createdAt,
    0,
    null,
    null,
  );
}

function getSessionItemIds(db: DbModule): string[] {
  const payload = db.getSessionPayload(studyDayKey);
  return [
    ...payload.buckets.review.map((item) => item.sessionActionId),
    ...payload.buckets.learning.map((word) => `learning/${word.id}`),
    ...payload.buckets.unstudied.map((word) => `unstudied/${word.id}`),
  ];
}
