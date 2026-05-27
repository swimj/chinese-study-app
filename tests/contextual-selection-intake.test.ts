import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';
type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('contextual selection intake', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-contextual-intake-'));
    dbPath = path.join(dataDir, 'app.db');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=contextual-intake-${Date.now()}`;
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
      DELETE FROM contrast_candidate_intake;
      DELETE FROM contrast_prompts;
      DELETE FROM contrast_cluster_members;
      DELETE FROM contrast_clusters;
      DELETE FROM study_events;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('groups repeated open rows and orders by frequency then latest intake time', () => {
    insertWord({ id: 'target-kaocha', hanzi: '考察', priority: 50 });
    insertWord({ id: 'candidate-kaocha', hanzi: '考查', priority: 40 });
    insertWord({ id: 'target-yan', hanzi: '严肃', priority: 30 });
    insertWord({ id: 'candidate-yan', hanzi: '严厉', priority: 20 });

    insertIntake({
      id: 'older-kaocha',
      createdAt: '2026-05-25T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
      note: 'typed during review',
    });
    insertIntake({
      id: 'newer-kaocha',
      createdAt: '2026-05-27T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
      note: 'still confusing',
    });
    insertIntake({
      id: 'yan-once',
      createdAt: '2026-05-28T00:00:00.000Z',
      targetWordId: 'target-yan',
      candidateText: '严厉',
      matchedWordId: 'candidate-yan',
      note: 'single newer row',
    });

    const payload = dbModule.getContrastIntakeGroups();

    assert.equal(payload.groups.length, 2);
    assert.equal(payload.groups[0]?.targetWordId, 'target-kaocha');
    assert.equal(payload.groups[0]?.count, 2);
    assert.equal(payload.groups[0]?.firstCreatedAt, '2026-05-25T00:00:00.000Z');
    assert.equal(payload.groups[0]?.latestCreatedAt, '2026-05-27T00:00:00.000Z');
    assert.deepEqual(payload.groups[0]?.notes, ['typed during review', 'still confusing']);
    assert.deepEqual(payload.groups[0]?.sources.map((source) => source.id), ['older-kaocha', 'newer-kaocha']);
    assert.equal(payload.groups[1]?.targetWordId, 'target-yan');
  });

  test('summarizes existing shared cluster coverage', () => {
    insertWord({ id: 'target-kaocha', hanzi: '考察' });
    insertWord({ id: 'candidate-kaocha', hanzi: '考查' });
    insertIntake({
      id: 'intake-kaocha',
      createdAt: '2026-05-27T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
    });

    dbModule.createContrastCluster({
      id: 'cluster-kaocha',
      title: '考察 / 考查',
    });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-kaocha', wordId: 'target-kaocha' });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-kaocha', wordId: 'candidate-kaocha' });
    dbModule.createContrastPrompt({
      id: 'prompt-kaocha',
      clusterId: 'cluster-kaocha',
      targetWordId: 'target-kaocha',
      promptText: '我们需要____这个现象。',
    });

    const group = dbModule.getContrastIntakeGroups().groups[0];

    assert.equal(group?.coverage.hasSharedCluster, true);
    assert.deepEqual(group?.coverage.sharedClusterIds, ['cluster-kaocha']);
    assert.equal(group?.coverage.promptCountForTarget, 1);
    assert.equal(group?.coverage.promptCountForCandidate, 0);
    assert.equal(group?.coverage.usablePromptCount, 1);
    assert.equal(group?.relevantClusters[0]?.id, 'cluster-kaocha');
  });

  test('creates cluster content from intake and accepts all grouped rows', () => {
    insertWord({ id: 'target-kaocha', hanzi: '考察' });
    insertWord({ id: 'candidate-kaocha', hanzi: '考查' });
    insertIntake({
      id: 'first-kaocha',
      createdAt: '2026-05-26T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
    });
    insertIntake({
      id: 'second-kaocha',
      createdAt: '2026-05-27T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
    });

    const cluster = dbModule.createContrastClusterFromIntake({
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
      resolvedCandidateWordId: 'candidate-kaocha',
      title: '考察 / 考查',
      prompt: {
        targetWordId: 'target-kaocha',
        promptText: '我们需要____这个现象。',
        explanation: 'Observation calls for 考察.',
      },
    });

    assert.equal(cluster.title, '考察 / 考查');
    assert.deepEqual(cluster.members.map((member) => member.wordId), ['target-kaocha', 'candidate-kaocha']);
    assert.equal(cluster.prompts.length, 1);
    assert.deepEqual(dbModule.getContrastIntakeGroups(), { groups: [] });
    assert.deepEqual(dbModule.getContrastCandidateIntake().map((row) => row.status), ['accepted', 'accepted']);
  });

  test('adds missing members and prompt to an existing cluster without accepting intake', () => {
    insertWord({ id: 'target-kaocha', hanzi: '考察' });
    insertWord({ id: 'candidate-kaocha', hanzi: '考查' });
    insertWord({ id: 'other-kaoshi', hanzi: '考试' });
    insertIntake({
      id: 'intake-kaocha',
      createdAt: '2026-05-27T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
    });
    dbModule.createContrastCluster({ id: 'cluster-existing', title: '考试 group' });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-existing', wordId: 'other-kaoshi' });

    const cluster = dbModule.addContrastIntakeToCluster({
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
      clusterId: 'cluster-existing',
      resolvedCandidateWordId: 'candidate-kaocha',
      prompt: {
        targetWordId: 'candidate-kaocha',
        promptText: '老师要____学生的理解。',
        explanation: '',
      },
    });

    assert.deepEqual(cluster.members.map((member) => member.wordId), [
      'target-kaocha',
      'candidate-kaocha',
      'other-kaoshi',
    ]);
    assert.equal(cluster.prompts[0]?.targetWordId, 'candidate-kaocha');
    assert.equal(dbModule.getContrastIntakeGroups().groups.length, 1);
    assert.equal(dbModule.getContrastCandidateIntake()[0]?.status, 'open');
  });

  test('rejects prompt-only resolution when target is not a cluster member', () => {
    insertWord({ id: 'target-kaocha', hanzi: '考察' });
    insertWord({ id: 'candidate-kaocha', hanzi: '考查' });
    insertWord({ id: 'other-kaoshi', hanzi: '考试' });
    insertIntake({
      id: 'intake-kaocha',
      createdAt: '2026-05-27T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: 'candidate-kaocha',
    });
    dbModule.createContrastCluster({ id: 'cluster-existing', title: '考试 group' });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-existing', wordId: 'other-kaoshi' });

    assert.throws(
      () => dbModule.addContrastPromptFromIntake({
        targetWordId: 'target-kaocha',
        candidateText: '考查',
        matchedWordId: 'candidate-kaocha',
        clusterId: 'cluster-existing',
        prompt: {
          targetWordId: 'target-kaocha',
          promptText: '我们需要____这个现象。',
          explanation: '',
        },
      }),
      /Contrast prompt target must be a cluster member/,
    );
    assert.equal(dbModule.getContrastIntakeGroups().groups.length, 1);
  });

  test('dismisses all rows in an unmatched text group', () => {
    insertWord({ id: 'target-kaocha', hanzi: '考察' });
    insertIntake({
      id: 'first-unmatched',
      createdAt: '2026-05-26T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: ' 考 查 ',
      matchedWordId: null,
    });
    insertIntake({
      id: 'second-unmatched',
      createdAt: '2026-05-27T00:00:00.000Z',
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: null,
    });

    dbModule.dismissContrastIntakeGroup({
      targetWordId: 'target-kaocha',
      candidateText: '考查',
      matchedWordId: null,
    });

    assert.deepEqual(dbModule.getContrastIntakeGroups(), { groups: [] });
    assert.deepEqual(dbModule.getContrastCandidateIntake().map((row) => row.status), ['dismissed', 'dismissed']);
  });
});

function insertWord({
  id,
  hanzi,
  priority = 10,
  status = 'review',
}: {
  id: string;
  hanzi: string;
  priority?: number;
  status?: WordStatus;
}) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      traditional,
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
    ) VALUES (?, ?, NULL, ?, ?, ?, '', '[]', ?, ?, ?, 0, NULL, NULL)
  `).run(
    id,
    hanzi,
    `${hanzi}-pinyin`,
    `${hanzi} meaning`,
    JSON.stringify([`${hanzi} meaning`]),
    status,
    priority,
    '2026-05-01T00:00:00.000Z',
  );
}

function insertIntake({
  id,
  createdAt,
  targetWordId,
  candidateText,
  matchedWordId,
  note = '',
}: {
  id: string;
  createdAt: string;
  targetWordId: string;
  candidateText: string | null;
  matchedWordId: string | null;
  note?: string;
}) {
  sqlite.prepare(`
    INSERT INTO contrast_candidate_intake (
      id,
      created_at,
      target_word_id,
      source_event_id,
      source_action_kind,
      source_content_ref_json,
      candidate_text,
      matched_word_id,
      note,
      status
    ) VALUES (?, ?, ?, NULL, 'production', NULL, ?, ?, ?, 'open')
  `).run(id, createdAt, targetWordId, candidateText, matchedWordId, note);
}
