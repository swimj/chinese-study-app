import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('content diagnostics', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-diagnostics-tests-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    dbModule = await import(
      `${pathToFileURL(path.resolve('server/db.ts')).href}?test=content-diagnostics-${Date.now()}`
    );
    restoreEnv('APP_MODE', previousMode);
    restoreEnv('APP_DATA_DIR', previousDataDir);
    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');

    insertWord('check', '考查', 'kǎochá', 'to check');
    insertWord('inspect', '考察', 'kǎochá', 'to inspect');
    dbModule.createContrastCluster({
      id: 'kaocha-cluster',
      title: '考查 / 考察',
      note: 'Similar sound, different scope.',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'kaocha-cluster',
      wordId: 'check',
      nuanceNote: 'Check knowledge.',
      displayOrder: 1,
    });
    dbModule.addContrastClusterMember({
      clusterId: 'kaocha-cluster',
      wordId: 'inspect',
      nuanceNote: 'Inspect conditions.',
      displayOrder: 2,
    });
    dbModule.createContrastPrompt({
      id: 'check-prompt',
      clusterId: 'kaocha-cluster',
      targetWordId: 'check',
      promptText: '老师要____理解。',
      explanation: 'Knowledge is being checked.',
    });
    insertCue();
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('projects searchable word, cluster, and cue primitives without mutation affordances', () => {
    assert.throws(
      () => dbModule.getContentDiagnostics({ kind: 'word', query: '  ' }),
      /Expected non-empty diagnostic query/,
    );

    const limitedWords = dbModule.getContentDiagnostics({ kind: 'word', query: 'kǎochá', limit: 1 });
    assert.equal(limitedWords.items.length, 1);
    assert.equal(limitedWords.hasMore, true);

    const words = dbModule.getContentDiagnostics({ kind: 'word', query: '考查' });
    assert.equal(words.hasMore, false);
    assert.equal(words.items[0]?.kind, 'word');
    assert.deepEqual(words.items[0]?.contrastClusters, [{
      clusterId: 'kaocha-cluster',
      title: '考查 / 考察',
      nuanceNote: 'Check knowledge.',
    }]);
    assert.deepEqual(words.items[0]?.productionTask, {
      taskId: 'production-task:check:default_production',
      cueCount: 1,
      activeCueCount: 1,
    });
    assert.deepEqual(words.items[0]?.productionCueSupplements, [{
      supplementId: 'check-supplement',
      cueId: null,
      cueType: null,
      englishFrame: 'A classroom check of understanding.',
      exampleSentence: '老师要考查学生对课文的理解。',
      exampleTranslation: 'The teacher wants to check student understanding of the text.',
      createdAt: '2026-08-03T00:00:00.000Z',
    }]);

    const inspect = dbModule.getContentDiagnostics({ kind: 'word', query: '考察' });
    assert.equal(inspect.items[0]?.kind, 'word');
    assert.deepEqual(inspect.items[0]?.productionCueSupplements, []);

    const clusters = dbModule.getContentDiagnostics({ kind: 'contrast_cluster', query: 'inspect' });
    assert.equal(clusters.hasMore, false);
    assert.equal(clusters.items[0]?.kind, 'contrast_cluster');
    assert.equal(clusters.items[0]?.members.length, 2);
    assert.equal(clusters.items[0]?.prompts[0]?.promptText, '老师要____理解。');

    const cues = dbModule.getContentDiagnostics({ kind: 'production_cue', query: 'context', limit: 1 });
    assert.equal(cues.hasMore, false);
    assert.equal(cues.items[0]?.kind, 'production_cue');
    assert.equal(cues.items[0]?.active, true);
    assert.deepEqual(cues.items[0]?.acceptedWords.map((word) => word.id), ['check', 'inspect']);
    assert.deepEqual(cues.items[0]?.evidence, {
      attemptCount: 3,
      acceptedAnchorCount: 1,
      acceptedNonAnchorCount: 1,
      rejectedCount: 1,
      activeJudgmentCount: 0,
      updatedAt: '2026-08-08T00:00:00.000Z',
    });
  });
});

function insertWord(id: string, hanzi: string, pinyin: string, meaning: string) {
  sqlite.prepare(`
    INSERT INTO words (id, hanzi, pinyin, meaning, examples_json, status, priority, created_at)
    VALUES (?, ?, ?, ?, '[]', 'review', 100, '2026-08-01T00:00:00.000Z')
  `).run(id, hanzi, pinyin, meaning);
}

function insertCue() {
  sqlite.exec(`
    INSERT INTO production_cues (
      cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id
    ) VALUES (
      'check-cue', 'production-task:check:default_production', 'minimal_context',
      'In a classroom checking-understanding context', '2026-08-02T00:00:00.000Z', 'manual', NULL
    );
    INSERT INTO production_cue_accepted_words (cue_id, word_id, position)
    VALUES ('check-cue', 'check', 0), ('check-cue', 'inspect', 1);
    INSERT INTO production_cue_lifecycle_events (
      event_id, cue_id, task_id, lifecycle_kind, occurred_at, invocation_id
    ) VALUES (
      'activate-check-cue', 'check-cue', 'production-task:check:default_production',
      'activated', '2026-08-02T00:00:00.000Z', NULL
    );
    INSERT INTO production_cue_activation_state (
      cue_id, active, latest_lifecycle_event_id, updated_at
    ) VALUES ('check-cue', 1, 'activate-check-cue', '2026-08-02T00:00:00.000Z');
    INSERT INTO production_cue_evidence_projection (
      cue_id, attempt_count, accepted_anchor_count, accepted_non_anchor_count,
      rejected_count, active_judgment_count, updated_at
    ) VALUES ('check-cue', 3, 1, 1, 1, 0, '2026-08-08T00:00:00.000Z');
    INSERT INTO production_cue_supplements (
      supplement_id, task_id, cue_id, english_frame, example_sentence,
      example_translation, created_at, origin_invocation_id
    ) VALUES (
      'check-supplement', 'production-task:check:default_production', NULL,
      'A classroom check of understanding.',
      '老师要考查学生对课文的理解。',
      'The teacher wants to check student understanding of the text.',
      '2026-08-03T00:00:00.000Z', NULL
    );
  `);
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
