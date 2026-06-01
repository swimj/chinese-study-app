import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';

type WordRecord = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  examples: string[];
  status: WordStatus;
  priority: number;
  createdAt: string;
};

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('contrast content model', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-tests-'));
    dbPath = path.join(dataDir, 'app.db');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=contrast-${Date.now()}`;
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
      DELETE FROM study_content_feedback;
      DELETE FROM word_skill_relevance;
      DELETE FROM study_events;
      DELETE FROM contrast_prompts;
      DELETE FROM contrast_cluster_members;
      DELETE FROM contrast_clusters;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('creates clusters, memberships, prompts, and derived siblings', () => {
    insertWord(createWord({ id: 'kaocha-check', hanzi: '考查' }));
    insertWord(createWord({ id: 'kaocha-inspect', hanzi: '考察' }));
    insertWord(createWord({ id: 'kaoshi', hanzi: '考试' }));

    const cluster = dbModule.createContrastCluster({
      id: 'cluster-kaocha',
      title: '考查 / 考察',
      note: 'Similar form, different application.',
    });
    const inspectMember = dbModule.addContrastClusterMember({
      clusterId: cluster.id,
      wordId: 'kaocha-inspect',
      nuanceNote: 'Use for investigation or observation.',
      displayOrder: 2,
    });
    const checkMember = dbModule.addContrastClusterMember({
      clusterId: cluster.id,
      wordId: 'kaocha-check',
      nuanceNote: 'Use for testing or checking knowledge.',
      displayOrder: 1,
    });

    const prompt = dbModule.createContrastPrompt({
      id: 'prompt-kaocha-check',
      clusterId: cluster.id,
      targetWordId: 'kaocha-check',
      promptText: '老师要____学生对课文的理解。',
      explanation: 'This asks about testing comprehension, so 考查 fits.',
    });

    assert.deepEqual(dbModule.getContrastClusters(), [cluster]);
    assert.deepEqual(dbModule.getContrastClusterMembers(cluster.id), [checkMember, inspectMember]);
    assert.deepEqual(dbModule.getContrastSiblingsForWord('kaocha-check'), [inspectMember]);
    assert.deepEqual(dbModule.getContrastSiblingsForWord('kaoshi'), []);
    assert.deepEqual(dbModule.getContrastPromptsForCluster(cluster.id), [prompt]);
  });

  test('allows prompts for any member of a cluster', () => {
    insertWord(createWord({ id: 'scheduled-word', hanzi: '严肃' }));
    insertWord(createWord({ id: 'sibling-word', hanzi: '严格' }));

    dbModule.createContrastCluster({
      id: 'cluster-yan',
      title: '严肃 / 严格',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'cluster-yan',
      wordId: 'scheduled-word',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'cluster-yan',
      wordId: 'sibling-word',
    });

    assert.deepEqual(dbModule.createContrastPrompt({
      id: 'prompt-sibling-target',
      clusterId: 'cluster-yan',
      targetWordId: 'sibling-word',
      promptText: '他对质量要求很____。',
      explanation: 'The sentence describes strict requirements.',
    }), {
      id: 'prompt-sibling-target',
      clusterId: 'cluster-yan',
      targetWordId: 'sibling-word',
      promptText: '他对质量要求很____。',
      explanation: 'The sentence describes strict requirements.',
    });
  });

  test('rejects prompts whose target is not a cluster member', () => {
    insertWord(createWord({ id: 'member-word', hanzi: '测验' }));
    insertWord(createWord({ id: 'outside-word', hanzi: '测试' }));

    dbModule.createContrastCluster({
      id: 'cluster-test',
      title: '测验 / 测试',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'cluster-test',
      wordId: 'member-word',
    });

    assert.throws(
      () => dbModule.createContrastPrompt({
        id: 'prompt-outside-target',
        clusterId: 'cluster-test',
        targetWordId: 'outside-word',
        promptText: '这次____很难。',
      }),
      /Contrast prompt target must be a cluster member/,
    );

    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO contrast_prompts (
          id,
          cluster_id,
          target_word_id,
          prompt_text,
          explanation
        ) VALUES (?, ?, ?, ?, ?)
      `).run('prompt-direct-outside-target', 'cluster-test', 'outside-word', 'Direct SQL prompt.', ''),
      /FOREIGN KEY constraint failed/,
    );
  });

  test('updates prompt content while preserving cluster membership invariants', () => {
    insertWord(createWord({ id: 'target-word', hanzi: '恰当' }));
    insertWord(createWord({ id: 'sibling-word', hanzi: '适当' }));
    insertWord(createWord({ id: 'outside-word', hanzi: '合适' }));

    dbModule.createContrastCluster({
      id: 'cluster-edit',
      title: '恰当 / 适当',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'cluster-edit',
      wordId: 'target-word',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'cluster-edit',
      wordId: 'sibling-word',
    });
    dbModule.createContrastPrompt({
      id: 'prompt-edit',
      clusterId: 'cluster-edit',
      targetWordId: 'target-word',
      promptText: '这个词很____。',
      explanation: 'Initial.',
    });

    assert.deepEqual(dbModule.updateContrastPrompt({
      id: 'prompt-edit',
      targetWordId: 'sibling-word',
      promptText: '运动要____。',
      explanation: 'Updated.',
    }), {
      id: 'prompt-edit',
      clusterId: 'cluster-edit',
      targetWordId: 'sibling-word',
      promptText: '运动要____。',
      explanation: 'Updated.',
    });

    assert.throws(
      () => dbModule.updateContrastPrompt({
        id: 'prompt-edit',
        targetWordId: 'outside-word',
        promptText: '这个词很____。',
        explanation: '',
      }),
      /Contrast prompt target must be a cluster member/,
    );
  });

  test('updates member nuance without requiring display order input', () => {
    insertWord(createWord({ id: 'target', hanzi: '恰当' }));
    insertWord(createWord({ id: 'sibling', hanzi: '适当' }));
    dbModule.createContrastCluster({ id: 'cluster-1', title: '恰当 / 适当' });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-1', wordId: 'target', displayOrder: 1 });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-1', wordId: 'sibling', displayOrder: 2 });

    const updated = dbModule.updateContrastClusterMember({
      clusterId: 'cluster-1',
      wordId: 'target',
      nuanceNote: 'Usually implies exact suitability.',
    });

    assert.equal(updated.nuanceNote, 'Usually implies exact suitability.');
    const members = dbModule.getContrastClusterMembers('cluster-1');
    assert.equal(members.find((member) => member.wordId === 'target')?.nuanceNote, 'Usually implies exact suitability.');
  });

  test('removing a target membership cascades to prompts for that target', () => {
    insertWord(createWord({ id: 'target-word', hanzi: '严格' }));
    insertWord(createWord({ id: 'sibling-word', hanzi: '严肃' }));

    dbModule.createContrastCluster({
      id: 'cluster-cascade',
      title: '严格 / 严肃',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'cluster-cascade',
      wordId: 'target-word',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'cluster-cascade',
      wordId: 'sibling-word',
    });
    dbModule.createContrastPrompt({
      id: 'prompt-cascade',
      clusterId: 'cluster-cascade',
      targetWordId: 'target-word',
      promptText: '标准很____。',
    });

    sqlite.prepare(`
      DELETE FROM contrast_cluster_members
      WHERE cluster_id = ?
        AND word_id = ?
    `).run('cluster-cascade', 'target-word');

    assert.deepEqual(dbModule.getContrastPromptsForCluster('cluster-cascade'), []);
  });

  test('projects production suppression and bad production prompt flags onto cluster members', () => {
    insertWord(createWord({ id: 'suppressed-word', hanzi: '严肃' }));
    insertWord(createWord({ id: 'bad-prompt-word', hanzi: '严格' }));
    insertWord(createWord({ id: 'normal-word', hanzi: '庄重' }));

    dbModule.createContrastCluster({
      id: 'cluster-flags',
      title: '严肃 / 严格 / 庄重',
    });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-flags', wordId: 'suppressed-word', displayOrder: 1 });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-flags', wordId: 'bad-prompt-word', displayOrder: 2 });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-flags', wordId: 'normal-word', displayOrder: 3 });

    dbModule.suppressProductionForWordOutsideSession({ targetWordId: 'suppressed-word' });
    dbModule.reportBadProductionPromptOutsideSession({ targetWordId: 'bad-prompt-word', note: 'Definition too broad.' });

    const cluster = dbModule.getContrastClusterContent().find((candidate) => candidate.id === 'cluster-flags');
    assert.ok(cluster);

    const suppressedMember = cluster.members.find((member) => member.wordId === 'suppressed-word');
    assert.equal(suppressedMember?.productionSuppressed, true);
    assert.equal(suppressedMember?.badProductionPromptReported, false);

    const badPromptMember = cluster.members.find((member) => member.wordId === 'bad-prompt-word');
    assert.equal(badPromptMember?.productionSuppressed, false);
    assert.equal(badPromptMember?.badProductionPromptReported, true);

    const normalMember = cluster.members.find((member) => member.wordId === 'normal-word');
    assert.equal(normalMember?.productionSuppressed, false);
    assert.equal(normalMember?.badProductionPromptReported, false);
  });
});

function createWord(overrides: Partial<WordRecord> & Pick<WordRecord, 'id' | 'hanzi'>): WordRecord {
  return {
    id: overrides.id,
    hanzi: overrides.hanzi,
    pinyin: overrides.pinyin ?? `${overrides.id}-pinyin`,
    meaning: overrides.meaning ?? `${overrides.id}-meaning`,
    examples: overrides.examples ?? [`${overrides.id}-example`],
    status: overrides.status ?? 'review',
    priority: overrides.priority ?? 100,
    createdAt: overrides.createdAt ?? '2026-05-10T00:00:00.000Z',
  };
}

function insertWord(record: WordRecord) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      pinyin,
      meaning,
      examples_json,
      status,
      priority,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.hanzi,
    record.pinyin,
    record.meaning,
    JSON.stringify(record.examples),
    record.status,
    record.priority,
    record.createdAt,
  );
}
