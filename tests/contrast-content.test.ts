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
      DROP TRIGGER IF EXISTS fail_contextual_relevance_insert;
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

  test('makes every manually added member eligible while preserving scheduler history', () => {
    insertWord(createWord({ id: 'missing-state', hanzi: '考察' }));
    insertWord(createWord({ id: 'disabled-state', hanzi: '考查' }));
    insertWord(createWord({ id: 'already-eligible', hanzi: '考试' }));
    dbModule.createContrastCluster({ id: 'cluster-eligibility', title: '考察 / 考查 / 考试' });

    sqlite.prepare(`
      INSERT INTO word_skill_relevance (
        word_id, skill_id, relevance_state, updated_at, source_event_id
      ) VALUES ('disabled-state', 'contextual_selection', 'suppressed', '2026-04-01T00:00:00.000Z', NULL)
    `).run();
    insertContextualSchedulerState({
      wordId: 'disabled-state',
      enabled: false,
      intervalHours: 72,
      lastStudiedAt: '2026-04-02T00:00:00.000Z',
      nextDueAt: '2026-04-05T00:00:00.000Z',
      easeFactor: 2.1,
    });
    sqlite.prepare(`
      INSERT INTO word_skill_relevance (
        word_id, skill_id, relevance_state, updated_at, source_event_id
      ) VALUES ('already-eligible', 'contextual_selection', 'normal', '2026-03-01T00:00:00.000Z', NULL)
    `).run();
    insertContextualSchedulerState({
      wordId: 'already-eligible',
      enabled: true,
      intervalHours: 48,
      lastStudiedAt: '2026-03-02T00:00:00.000Z',
      nextDueAt: '2026-03-04T00:00:00.000Z',
      easeFactor: 2.3,
    });

    for (const wordId of ['missing-state', 'disabled-state', 'already-eligible']) {
      dbModule.addContrastClusterMember({ clusterId: 'cluster-eligibility', wordId });
    }

    assert.equal(dbModule.getWordSkillRelevance('missing-state', 'contextual_selection')?.relevanceState, 'normal');
    const initialized = fetchContextualSchedulerState('missing-state');
    assert.equal(initialized?.enabled, 1);
    assert.equal(initialized?.interval_hours, 6);
    assert.equal(initialized?.ease_factor, 2.5);
    assert.equal(
      initialized?.next_due_at,
      initialized ? addHours(initialized.last_studied_at, 6) : null,
    );

    assert.equal(dbModule.getWordSkillRelevance('disabled-state', 'contextual_selection')?.relevanceState, 'normal');
    assert.deepEqual({ ...fetchContextualSchedulerState('disabled-state') }, {
      enabled: 1,
      interval_hours: 72,
      last_studied_at: '2026-04-02T00:00:00.000Z',
      next_due_at: '2026-04-05T00:00:00.000Z',
      ease_factor: 2.1,
    });

    assert.equal(
      dbModule.getWordSkillRelevance('already-eligible', 'contextual_selection')?.updatedAt,
      '2026-03-01T00:00:00.000Z',
    );
    assert.deepEqual({ ...fetchContextualSchedulerState('already-eligible') }, {
      enabled: 1,
      interval_hours: 48,
      last_studied_at: '2026-03-02T00:00:00.000Z',
      next_due_at: '2026-03-04T00:00:00.000Z',
      ease_factor: 2.3,
    });
  });

  test('rolls back membership when eligibility cannot be initialized', () => {
    insertWord(createWord({ id: 'atomic-member', hanzi: '考察' }));
    dbModule.createContrastCluster({ id: 'cluster-atomic', title: 'Atomic cluster' });
    sqlite.exec(`
      CREATE TRIGGER fail_contextual_relevance_insert
      BEFORE INSERT ON word_skill_relevance
      WHEN NEW.word_id = 'atomic-member'
      BEGIN
        SELECT RAISE(ABORT, 'injected eligibility failure');
      END;
    `);

    assert.throws(
      () => dbModule.addContrastClusterMember({ clusterId: 'cluster-atomic', wordId: 'atomic-member' }),
      /injected eligibility failure/,
    );
    assert.deepEqual(dbModule.getContrastClusterMembers('cluster-atomic'), []);
    assert.equal(dbModule.getWordSkillRelevance('atomic-member', 'contextual_selection'), null);
    assert.equal(fetchContextualSchedulerState('atomic-member'), undefined);
  });

  test('preserves contextual eligibility when a cluster member is dismissed from word study', () => {
    insertWord(createWord({ id: 'dismissed-member', hanzi: '考察' }));
    dbModule.createContrastCluster({ id: 'cluster-dismissed', title: 'Dismissed member' });
    dbModule.addContrastClusterMember({ clusterId: 'cluster-dismissed', wordId: 'dismissed-member' });

    dbModule.dismissWordFromStudy('dismissed-member');

    assert.equal(dbModule.getWordSkillRelevance('dismissed-member', 'contextual_selection')?.relevanceState, 'normal');
    assert.equal(fetchContextualSchedulerState('dismissed-member')?.enabled, 1);
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
    sqlite.prepare(`
      INSERT INTO study_content_feedback (
        id, created_at, target_type, target_id, target_word_id, action_kind,
        feedback_type, feedback_action, source_event_id, note
      ) VALUES (?, ?, 'generated_prompt', 'definition_based_production', ?, 'production',
        'bad_prompt', 'reported', NULL, ?)
    `).run(
      'legacy-bad-prompt-feedback',
      '2026-05-10T00:00:00.000Z',
      'bad-prompt-word',
      'Definition too broad.',
    );

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

function insertContextualSchedulerState({
  wordId,
  enabled,
  intervalHours,
  lastStudiedAt,
  nextDueAt,
  easeFactor,
}: {
  wordId: string;
  enabled: boolean;
  intervalHours: number;
  lastStudiedAt: string;
  nextDueAt: string | null;
  easeFactor: number;
}) {
  sqlite.prepare(`
    INSERT INTO word_skill_state (
      word_id, skill_id, enabled, interval_hours, last_studied_at, next_due_at, ease_factor
    ) VALUES (?, 'contextual_selection', ?, ?, ?, ?, ?)
  `).run(wordId, enabled ? 1 : 0, intervalHours, lastStudiedAt, nextDueAt, easeFactor);
}

function fetchContextualSchedulerState(wordId: string) {
  return sqlite.prepare(`
    SELECT enabled, interval_hours, last_studied_at, next_due_at, ease_factor
    FROM word_skill_state
    WHERE word_id = ?
      AND skill_id = 'contextual_selection'
  `).get(wordId) as {
    enabled: number;
    interval_hours: number;
    last_studied_at: string;
    next_due_at: string | null;
    ease_factor: number;
  } | undefined;
}

function addHours(isoTimestamp: string, hours: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}
