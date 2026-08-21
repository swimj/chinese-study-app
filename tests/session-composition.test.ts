import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';
type Direction = 'forward' | 'reverse';
type StudySkillId = 'recognition' | 'production' | 'contextual_selection';

type WordRecord = {
  id: string;
  hanzi: string;
  traditional?: string | null;
  pinyin: string;
  meaning: string;
  examples: string[];
  status: WordStatus;
  priority: number;
  createdAt: string;
  learningStreak?: number;
  lastLearningSuccessOn?: string | null;
  lastLearningCoveredOn?: string | null;
};

type ReviewSkillStateRecord = {
  id: string;
  wordId: string;
  direction: Direction;
  intervalHours: number;
  lastReviewedAt?: string | null;
  nextDueAt?: string | null;
  easeFactor?: number;
};

type DbModule = typeof import('../server/db.ts');

const today = new Date().toISOString().slice(0, 10);
const yesterday = addDays(today, -1);
const studyDayKey = today;

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('session composition', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-tests-'));
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
      DROP TRIGGER IF EXISTS production_recheck_demands_no_delete;
      DROP TRIGGER IF EXISTS production_cue_evidence_records_no_delete;
      DROP TRIGGER IF EXISTS production_cue_lifecycle_events_no_delete;
      DROP TRIGGER IF EXISTS production_cue_accepted_words_no_delete;
      DROP TRIGGER IF EXISTS production_cues_no_delete;
      DROP TRIGGER IF EXISTS production_cue_supplements_no_delete;
      DELETE FROM production_cue_evidence_projection;
      DELETE FROM production_recheck_demands;
      DELETE FROM production_cue_evidence_records;
      DELETE FROM production_cue_activation_state;
      DELETE FROM production_cue_lifecycle_events;
      DELETE FROM production_cue_accepted_words;
      DELETE FROM production_cue_supplements;
      DELETE FROM production_cues;
      DELETE FROM reflection_operation_invocations;
      DELETE FROM study_content_feedback;
      DELETE FROM contrast_candidate_intake;
      DELETE FROM word_skill_relevance;
      DELETE FROM study_events;
      DELETE FROM study_attempt_events;
      DELETE FROM study_sessions;
      DELETE FROM daily_new_word_intake;
      DELETE FROM user_word_priority;
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES ('daily_new_word_limit', '10', '2026-01-01T00:00:00.000Z')
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at;
      DELETE FROM word_skill_state;
      DELETE FROM word_study_admission_state;
      DELETE FROM contrast_prompts;
      DELETE FROM contrast_cluster_members;
      DELETE FROM contrast_clusters;
      DELETE FROM words;
    `);
    dbModule.ensureProductionCueSchema();
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('includes only due review directions for review words', () => {
    insertWord({
      id: 'review-word',
      hanzi: '你好',
      pinyin: 'ni hao',
      meaning: 'hello',
      examples: ['你好！'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(48),
    });

    insertReviewSkillState({
      id: 'review-word-forward',
      wordId: 'review-word',
      direction: 'forward',
      intervalHours: 48,
      // Make only one direction due so the session includes just that review obligation.
      nextDueAt: isoHoursAgo(2),
    });
    insertReviewSkillState({
      id: 'review-word-reverse',
      wordId: 'review-word',
      direction: 'reverse',
      intervalHours: 48,
      // Keep the opposite direction in the future to verify it stays out of the session.
      nextDueAt: isoHoursFromNow(2),
    });

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds, ['review/review-word/recognition']);
  });

  test('admits review words from word skill urgency', () => {
    insertWord({
      id: 'skill-urgent-word',
      hanzi: '急',
      pinyin: 'ji',
      meaning: 'urgent',
      examples: ['事情很急。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });

    insertReviewSkillState({
      id: 'skill-urgent-word-forward',
      wordId: 'skill-urgent-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(25),
      nextDueAt: isoHoursFromNow(24),
    });
    insertWordStudyAdmissionState('skill-urgent-word', null);
    insertWordSkillState({
      wordId: 'skill-urgent-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(25),
      nextDueAt: isoHoursFromNow(24),
    });

    assert.deepEqual(getSessionItemIds(dbModule), ['review/skill-urgent-word/recognition']);
  });

  test('composes review actions without a backing review action row', () => {
    insertWord({
      id: 'skill-only-review-word',
      hanzi: '技',
      pinyin: 'ji',
      meaning: 'skill',
      examples: ['技能很重要。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('skill-only-review-word', null);
    insertWordSkillState({
      wordId: 'skill-only-review-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(24),
    });

    const payload = dbModule.getSessionPayload(studyDayKey);

    assert.deepEqual(payload.buckets.review.map((item) => ({
      sessionActionId: item.sessionActionId,
      actionKind: item.actionKind,
      targetWordId: item.targetWordId,
      sampledSkillIds: item.sampledSkillIds,
      wordId: item.word.id,
    })), [
      {
        sessionActionId: 'review/skill-only-review-word/production',
        actionKind: 'production',
        targetWordId: 'skill-only-review-word',
        sampledSkillIds: ['production'],
        wordId: 'skill-only-review-word',
      },
    ]);
  });

  test('serves the exact active production cue and lets it supersede legacy fallback suppression', () => {
    insertWord({
      id: 'cue-word',
      hanzi: '辨',
      pinyin: 'bian',
      meaning: 'distinguish',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('cue-word', null);
    insertWordSkillState({
      wordId: 'cue-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(24),
    });
    insertWordSkillRelevance('cue-word', 'production', 'suppressed');
    insertBadProductionPromptFeedback('cue-word');
    insertProductionCue({
      wordId: 'cue-word',
      cueId: 'cue-active',
      text: 'To tell two close possibilities apart',
      acceptedWordIds: ['cue-word'],
      active: true,
    });
    insertProductionCue({
      wordId: 'cue-word',
      cueId: 'cue-inactive',
      text: 'retired prompt',
      acceptedWordIds: ['cue-word'],
      active: false,
    });

    const item = dbModule.getSessionPayload(studyDayKey).buckets.review[0];
    assert.deepEqual(item?.contentRef, {
      type: 'production_cue',
      taskId: 'production-task:cue-word:default_production',
      cueId: 'cue-active',
    });
    assert.deepEqual(item?.production, {
      taskId: 'production-task:cue-word:default_production',
      cueId: 'cue-active',
      cueType: 'minimal_context',
      text: 'To tell two close possibilities apart',
      acceptedWordIds: ['cue-word'],
      supplement: null,
      recheckDemandId: null,
    });
  });

  test('serves fallback reinforcement as a separate post-reveal supplement snapshot', () => {
    insertWord({
      id: 'supplemented-word',
      hanzi: '包庇',
      pinyin: 'baobi',
      meaning: 'to shield; to harbor',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('supplemented-word', null);
    insertWordSkillState({
      wordId: 'supplemented-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(24),
    });
    const operation = {
      kind: 'add_production_cue_supplement' as const,
      version: 1 as const,
      wordId: 'supplemented-word',
      taskId: 'production-task:supplemented-word:default_production',
      cueId: null,
      englishFrame: 'Knowingly shielding someone from responsibility.',
      exampleSentence: '他明知儿子犯了罪，却包庇了他。',
      exampleTranslation: 'He knew his son had committed a crime but shielded him.',
    };
    const appliedAt = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO reflection_operation_invocations (
        invocation_id, created_at, origin_kind, origin_proposal_id,
        origin_superseded_proposal_id, operation_kind, operation_version,
        operation_json, application_state, application_updated_at,
        unsupported_reason, applied_at, application_error, stale_reason,
        effect_refs_json, satisfying_effect_refs_json
      ) VALUES (
        'supplement-session-invocation', ?, 'manual', NULL, NULL, ?, 1, ?,
        'pending', ?, NULL, NULL, NULL, NULL, '[]', '[]'
      )
    `).run(appliedAt, operation.kind, JSON.stringify(operation), appliedAt);
    const applied = dbModule.applyProductionCueSupplementWithoutTransaction(
      operation,
      'supplement-session-invocation',
      appliedAt,
    );
    assert.equal(applied.kind, 'applied');

    const item = dbModule.getSessionPayload(studyDayKey).buckets.review.find(
      (candidate) => candidate.targetWordId === 'supplemented-word',
    );
    assert.equal(item?.production?.text, 'to shield; to harbor');
    assert.equal(item?.production?.cueId, null);
    assert.deepEqual(item?.production?.supplement, {
      supplementId: applied.kind === 'applied' ? applied.effectRefs[0]!.id : '',
      englishFrame: operation.englishFrame,
      exampleSentence: operation.exampleSentence,
      exampleTranslation: operation.exampleTranslation,
    });
  });

  test('does not resurrect the legacy production gloss when every normalized meaning is hidden', () => {
    insertWord({
      id: 'hidden-meaning-word',
      hanzi: '隐',
      pinyin: 'yin',
      meaning: 'legacy fallback must stay hidden',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('hidden-meaning-word', null);
    insertWordSkillState({
      wordId: 'hidden-meaning-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(24),
    });
    sqlite.prepare(`
      INSERT INTO word_meanings (
        id, word_id, position, text, show_on_production_prompt, created_at, updated_at
      ) VALUES (?, ?, 0, ?, 0, ?, ?)
    `).run(
      'hidden-meaning-word-meaning-0',
      'hidden-meaning-word',
      'explicitly hidden',
      isoHoursAgo(1),
      isoHoursAgo(1),
    );

    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('masks ordinary production until a pending recheck is due, then forces production', () => {
    insertWord({
      id: 'recheck-word',
      hanzi: '查',
      pinyin: 'cha',
      meaning: 'check',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('recheck-word', null);
    insertWordSkillState({
      wordId: 'recheck-word',
      skillId: 'production',
      intervalHours: 72,
      lastStudiedAt: isoHoursAgo(1),
      nextDueAt: isoHoursFromNow(71),
    });
    insertWordSkillState({
      wordId: 'recheck-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(24),
    });
    const sourceAttemptId = insertProjectedProductionAttempt('recheck-word');
    const scheduledAt = isoHoursAgo(1);
    dbModule.appendProductionRecheckDemandWithoutTransaction({
      demandId: 'recheck-demand',
      taskId: 'production-task:recheck-word:default_production',
      sourceAttemptId,
      scheduledAt,
      dueAt: shiftHours(scheduledAt, 48),
    });

    assert.deepEqual(
      dbModule.getSessionPayload(studyDayKey).buckets.review.map((item) => item.actionKind),
      ['recognition'],
    );

    insertWord({
      id: 'due-recheck-word',
      hanzi: '再',
      pinyin: 'zai',
      meaning: 'again',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('due-recheck-word', isoHoursFromNow(72));
    insertWordSkillState({
      wordId: 'due-recheck-word',
      skillId: 'production',
      intervalHours: 72,
      lastStudiedAt: isoHoursAgo(1),
      nextDueAt: isoHoursFromNow(71),
    });
    const dueSourceAttemptId = insertProjectedProductionAttempt('due-recheck-word');
    const dueScheduledAt = isoHoursAgo(49);
    dbModule.appendProductionRecheckDemandWithoutTransaction({
      demandId: 'due-recheck-demand',
      taskId: 'production-task:due-recheck-word:default_production',
      sourceAttemptId: dueSourceAttemptId,
      scheduledAt: dueScheduledAt,
      dueAt: shiftHours(dueScheduledAt, 48),
    });

    const item = dbModule.getSessionPayload(studyDayKey).buckets.review.find(
      (candidate) => candidate.targetWordId === 'due-recheck-word',
    );
    assert.equal(item?.actionKind, 'production');
    assert.equal(item?.sessionActionId, 'review/due-recheck-word/production/recheck/due-recheck-demand');
    assert.equal(item?.production?.recheckDemandId, 'due-recheck-demand');
  });

  test('does not schedule suppressed production even when its scheduler state is urgent', () => {
    insertWord({
      id: 'suppressed-production-word',
      hanzi: '免',
      pinyin: 'mian',
      meaning: 'exempt',
      examples: ['可以免除。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('suppressed-production-word', null);
    insertWordSkillState({
      wordId: 'suppressed-production-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillRelevance('suppressed-production-word', 'production', 'suppressed');

    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('does not schedule bad definition-based production prompts as replacement busywork', () => {
    insertWord({
      id: 'bad-production-prompt-word',
      hanzi: '泛',
      pinyin: 'fan',
      meaning: 'broad',
      examples: ['这个说法很泛。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('bad-production-prompt-word', null);
    insertWordSkillState({
      wordId: 'bad-production-prompt-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertBadProductionPromptFeedback('bad-production-prompt-word');

    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('allows recognition-only review words when production is suppressed', () => {
    insertWord({
      id: 'recognition-only-word',
      hanzi: '姓',
      pinyin: 'xing',
      meaning: 'surname',
      examples: ['他姓王。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('recognition-only-word', null);
    insertWordSkillState({
      wordId: 'recognition-only-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(30),
      nextDueAt: isoHoursAgo(6),
    });
    insertWordSkillState({
      wordId: 'recognition-only-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(96),
      nextDueAt: isoHoursAgo(72),
    });
    insertWordSkillRelevance('recognition-only-word', 'production', 'suppressed');

    assert.deepEqual(getSessionItemIds(dbModule), ['review/recognition-only-word/recognition']);
  });

  test('schedules contextual selection only when enabled and contrast prompt content exists', () => {
    insertWord({
      id: 'context-target-word',
      hanzi: '严格',
      pinyin: 'yan ge',
      meaning: 'strict',
      examples: ['标准很严格。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'context-sibling-word',
      hanzi: '严肃',
      pinyin: 'yan su',
      meaning: 'serious',
      examples: ['态度很严肃。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('context-target-word', null);
    insertWordSkillState({
      wordId: 'context-target-word',
      skillId: 'contextual_selection',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillRelevance('context-target-word', 'contextual_selection', 'normal');
    insertContrastContent({
      clusterId: 'cluster-yan',
      scheduledWordId: 'context-target-word',
      siblingWordId: 'context-sibling-word',
      promptId: 'prompt-yan-sibling',
      promptTargetWordId: 'context-sibling-word',
    });

    const payload = dbModule.getSessionPayload(studyDayKey);

    assert.deepEqual(payload.buckets.review.map((item) => ({
      sessionActionId: item.sessionActionId,
      actionKind: item.actionKind,
      targetWordId: item.targetWordId,
      sampledSkillIds: item.sampledSkillIds,
      contentRef: item.contentRef,
    })), [
      {
        sessionActionId: 'review/context-target-word/contextual_selection',
        actionKind: 'contrast_selection',
        targetWordId: 'context-target-word',
        sampledSkillIds: ['contextual_selection'],
        contentRef: { type: 'contrast_prompt', id: 'prompt-yan-sibling' },
      },
    ]);
  });

  test('builds binary contrast payloads for scheduled-word and sibling-target prompts', () => {
    insertWord({
      id: 'contrast-scheduled-word',
      hanzi: '恰当',
      pinyin: 'qia dang',
      meaning: 'appropriate exactly',
      examples: ['这个词很恰当。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'contrast-sibling-word',
      hanzi: '适当',
      pinyin: 'shi dang',
      meaning: 'suitable or moderate',
      examples: ['适当休息。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('contrast-scheduled-word', null);
    insertWordSkillState({
      wordId: 'contrast-scheduled-word',
      skillId: 'contextual_selection',
      intervalHours: 6,
      lastStudiedAt: isoHoursAgo(12),
      nextDueAt: isoHoursAgo(6),
    });
    insertWordSkillRelevance('contrast-scheduled-word', 'contextual_selection', 'normal');
    insertContrastContent({
      clusterId: 'cluster-binary-contrast',
      scheduledWordId: 'contrast-scheduled-word',
      siblingWordId: 'contrast-sibling-word',
      promptId: 'prompt-scheduled-target',
      promptTargetWordId: 'contrast-scheduled-word',
    });
    dbModule.createContrastPrompt({
      id: 'prompt-sibling-target',
      clusterId: 'cluster-binary-contrast',
      targetWordId: 'contrast-sibling-word',
      promptText: 'sibling target prompt',
      explanation: 'sibling target explanation',
    });

    const originalRandom = Math.random;
    const sampleWithRandomValues = (values: number[]) => {
      let index = 0;
      Math.random = () => values[index++] ?? 0;
      return dbModule.getSessionPayload(studyDayKey).buckets.review[0];
    };

    try {
      const scheduledTargetItem = sampleWithRandomValues([0, 0.25]);
      assert.equal(scheduledTargetItem?.contrastSelection?.promptTargetWordId, 'contrast-scheduled-word');
      assert.deepEqual(
        scheduledTargetItem?.contrastSelection?.choices.map((choice) => choice.word.id).sort(),
        ['contrast-scheduled-word', 'contrast-sibling-word'].sort(),
      );

      const siblingTargetItem = sampleWithRandomValues([0, 0.75]);
      assert.equal(siblingTargetItem?.contrastSelection?.promptTargetWordId, 'contrast-sibling-word');
      assert.deepEqual(
        siblingTargetItem?.contrastSelection?.choices.map((choice) => choice.word.id).sort(),
        ['contrast-scheduled-word', 'contrast-sibling-word'].sort(),
      );
    } finally {
      Math.random = originalRandom;
    }
  });

  test('samples sibling targets and distractor choices for larger contrast clusters', () => {
    insertWord({
      id: 'contrast-large-scheduled-word',
      hanzi: '严肃',
      pinyin: 'yan su',
      meaning: 'serious',
      examples: ['态度很严肃。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'contrast-large-first-sibling',
      hanzi: '严厉',
      pinyin: 'yan li',
      meaning: 'stern',
      examples: ['批评很严厉。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'contrast-large-second-sibling',
      hanzi: '严峻',
      pinyin: 'yan jun',
      meaning: 'severe',
      examples: ['形势严峻。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('contrast-large-scheduled-word', null);
    insertWordSkillState({
      wordId: 'contrast-large-scheduled-word',
      skillId: 'contextual_selection',
      intervalHours: 6,
      lastStudiedAt: isoHoursAgo(12),
      nextDueAt: isoHoursAgo(6),
    });
    insertWordSkillRelevance('contrast-large-scheduled-word', 'contextual_selection', 'normal');
    insertContrastContent({
      clusterId: 'cluster-large-contrast',
      scheduledWordId: 'contrast-large-scheduled-word',
      siblingWordId: 'contrast-large-first-sibling',
      promptId: 'prompt-large-scheduled-target',
      promptTargetWordId: 'contrast-large-scheduled-word',
    });
    dbModule.addContrastClusterMember({
      clusterId: 'cluster-large-contrast',
      wordId: 'contrast-large-second-sibling',
    });
    dbModule.createContrastPrompt({
      id: 'prompt-large-first-sibling-target',
      clusterId: 'cluster-large-contrast',
      targetWordId: 'contrast-large-first-sibling',
      promptText: 'first sibling target prompt',
      explanation: 'first sibling target explanation',
    });
    dbModule.createContrastPrompt({
      id: 'prompt-large-second-sibling-target',
      clusterId: 'cluster-large-contrast',
      targetWordId: 'contrast-large-second-sibling',
      promptText: 'second sibling target prompt',
      explanation: 'second sibling target explanation',
    });

    const originalRandom = Math.random;
    const sampleWithRandomValues = (values: number[]) => {
      let index = 0;
      Math.random = () => values[index++] ?? 0;
      return dbModule.getSessionPayload(studyDayKey).buckets.review[0];
    };

    try {
      const siblingTargetItem = sampleWithRandomValues([0.75, 0.75]);
      assert.equal(siblingTargetItem?.contrastSelection?.promptTargetWordId, 'contrast-large-second-sibling');
      assert.deepEqual(
        siblingTargetItem?.contrastSelection?.choices.map((choice) => choice.word.id).sort(),
        ['contrast-large-scheduled-word', 'contrast-large-second-sibling'].sort(),
      );

      const scheduledTargetItem = sampleWithRandomValues([0.75, 0.25]);
      assert.equal(scheduledTargetItem?.contrastSelection?.promptTargetWordId, 'contrast-large-scheduled-word');
      assert.deepEqual(
        scheduledTargetItem?.contrastSelection?.choices.map((choice) => choice.word.id).sort(),
        ['contrast-large-scheduled-word', 'contrast-large-second-sibling'].sort(),
      );
    } finally {
      Math.random = originalRandom;
    }
  });

  test('serves only one contrast action for the same binary choice set in a session', () => {
    insertWord({
      id: 'contrast-first-word',
      hanzi: '恰当',
      pinyin: 'qia dang',
      meaning: 'appropriate exactly',
      examples: ['这个词很恰当。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'contrast-second-word',
      hanzi: '适当',
      pinyin: 'shi dang',
      meaning: 'suitable or moderate',
      examples: ['适当休息。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('contrast-first-word', null);
    insertWordStudyAdmissionState('contrast-second-word', null);
    insertWordSkillState({
      wordId: 'contrast-first-word',
      skillId: 'contextual_selection',
      intervalHours: 6,
      lastStudiedAt: isoHoursAgo(18),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordSkillState({
      wordId: 'contrast-second-word',
      skillId: 'contextual_selection',
      intervalHours: 6,
      lastStudiedAt: isoHoursAgo(12),
      nextDueAt: isoHoursAgo(6),
    });
    insertWordSkillRelevance('contrast-first-word', 'contextual_selection', 'normal');
    insertWordSkillRelevance('contrast-second-word', 'contextual_selection', 'normal');
    insertContrastContent({
      clusterId: 'cluster-deduped-binary-contrast',
      scheduledWordId: 'contrast-first-word',
      siblingWordId: 'contrast-second-word',
      promptId: 'prompt-first-target',
      promptTargetWordId: 'contrast-first-word',
    });
    dbModule.createContrastPrompt({
      id: 'prompt-second-target',
      clusterId: 'cluster-deduped-binary-contrast',
      targetWordId: 'contrast-second-word',
      promptText: 'second target prompt',
      explanation: 'second target explanation',
    });

    const contrastItems = dbModule.getSessionPayload(studyDayKey).buckets.review
      .filter((item) => item.actionKind === 'contrast_selection');

    assert.deepEqual(contrastItems.map((item) => item.targetWordId), ['contrast-first-word']);
  });

  test('samples among multiple prompts for the same contrast target word', () => {
    insertWord({
      id: 'contrast-multi-scheduled-word',
      hanzi: '严格',
      pinyin: 'yan ge',
      meaning: 'strict',
      examples: ['标准很严格。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'contrast-multi-sibling-word',
      hanzi: '严肃',
      pinyin: 'yan su',
      meaning: 'serious',
      examples: ['态度很严肃。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('contrast-multi-scheduled-word', null);
    insertWordSkillState({
      wordId: 'contrast-multi-scheduled-word',
      skillId: 'contextual_selection',
      intervalHours: 6,
      lastStudiedAt: isoHoursAgo(12),
      nextDueAt: isoHoursAgo(6),
    });
    insertWordSkillRelevance('contrast-multi-scheduled-word', 'contextual_selection', 'normal');
    insertContrastContent({
      clusterId: 'cluster-multi-prompt-target',
      scheduledWordId: 'contrast-multi-scheduled-word',
      siblingWordId: 'contrast-multi-sibling-word',
      promptId: 'prompt-multi-target-a',
      promptTargetWordId: 'contrast-multi-scheduled-word',
    });
    dbModule.createContrastPrompt({
      id: 'prompt-multi-target-b',
      clusterId: 'cluster-multi-prompt-target',
      targetWordId: 'contrast-multi-scheduled-word',
      promptText: 'multi target prompt b',
      explanation: 'b',
    });

    const originalRandom = Math.random;
    const sampleWithRandomValues = (values: number[]) => {
      let index = 0;
      Math.random = () => values[index++] ?? 0;
      return dbModule.getSessionPayload(studyDayKey).buckets.review[0];
    };

    try {
      const firstPromptItem = sampleWithRandomValues([0, 0.25]);
      const secondPromptItem = sampleWithRandomValues([0, 0.75]);

      assert.equal(firstPromptItem?.contrastSelection?.promptTargetWordId, 'contrast-multi-scheduled-word');
      assert.equal(secondPromptItem?.contrastSelection?.promptTargetWordId, 'contrast-multi-scheduled-word');
      assert.equal(firstPromptItem?.contrastSelection?.prompt.id, 'prompt-multi-target-a');
      assert.equal(secondPromptItem?.contrastSelection?.prompt.id, 'prompt-multi-target-b');
    } finally {
      Math.random = originalRandom;
    }
  });

  test('does not schedule contextual selection without usable contrast prompt content', () => {
    insertWord({
      id: 'context-no-content-word',
      hanzi: '恰当',
      pinyin: 'qia dang',
      meaning: 'appropriate',
      examples: ['用词很恰当。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('context-no-content-word', null);
    insertWordSkillState({
      wordId: 'context-no-content-word',
      skillId: 'contextual_selection',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillRelevance('context-no-content-word', 'contextual_selection', 'normal');

    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('does not schedule contextual selection when all usable contrast prompts are suppressed', () => {
    insertWord({
      id: 'context-suppressed-prompt-word',
      hanzi: '适当',
      pinyin: 'shi dang',
      meaning: 'suitable',
      examples: ['要适当休息。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'context-suppressed-sibling-word',
      hanzi: '恰当',
      pinyin: 'qia dang',
      meaning: 'appropriate',
      examples: ['表达很恰当。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('context-suppressed-prompt-word', null);
    insertWordSkillState({
      wordId: 'context-suppressed-prompt-word',
      skillId: 'contextual_selection',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillRelevance('context-suppressed-prompt-word', 'contextual_selection', 'normal');
    insertContrastContent({
      clusterId: 'cluster-appropriate',
      scheduledWordId: 'context-suppressed-prompt-word',
      siblingWordId: 'context-suppressed-sibling-word',
      promptId: 'prompt-suppressed-contrast',
      promptTargetWordId: 'context-suppressed-prompt-word',
    });
    insertBadContrastPromptFeedback({
      promptId: 'prompt-suppressed-contrast',
      targetWordId: 'context-suppressed-prompt-word',
    });

    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('schedules contextual selection again after bad contrast prompt feedback is resolved', () => {
    insertWord({
      id: 'context-resolved-prompt-word',
      hanzi: '适当',
      pinyin: 'shi dang',
      meaning: 'suitable',
      examples: ['要适当休息。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'context-resolved-sibling-word',
      hanzi: '恰当',
      pinyin: 'qia dang',
      meaning: 'appropriate',
      examples: ['表达很恰当。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWordStudyAdmissionState('context-resolved-prompt-word', null);
    insertWordSkillState({
      wordId: 'context-resolved-prompt-word',
      skillId: 'contextual_selection',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillRelevance('context-resolved-prompt-word', 'contextual_selection', 'normal');
    insertContrastContent({
      clusterId: 'cluster-resolved-appropriate',
      scheduledWordId: 'context-resolved-prompt-word',
      siblingWordId: 'context-resolved-sibling-word',
      promptId: 'prompt-resolved-contrast',
      promptTargetWordId: 'context-resolved-prompt-word',
    });
    insertBadContrastPromptFeedback({
      promptId: 'prompt-resolved-contrast',
      targetWordId: 'context-resolved-prompt-word',
    });

    dbModule.resolveContrastPromptBadFeedback({ promptId: 'prompt-resolved-contrast' });

    assert.deepEqual(getSessionItemIds(dbModule), ['review/context-resolved-prompt-word/contextual_selection']);
  });

  test('suppresses review skills when urgency is below threshold', () => {
    insertWord({
      id: 'skill-not-urgent-word',
      hanzi: '缓',
      pinyin: 'huan',
      meaning: 'slow',
      examples: ['动作很缓。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });

    insertReviewSkillState({
      id: 'skill-not-urgent-word-forward',
      wordId: 'skill-not-urgent-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(2),
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('skill-not-urgent-word', null);
    insertWordSkillState({
      wordId: 'skill-not-urgent-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(2),
      nextDueAt: isoHoursAgo(1),
    });

    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('admits a review word once when both skills are overdue and chooses the most urgent skill', () => {
    insertWord({
      id: 'both-skills-overdue-word',
      hanzi: '选',
      pinyin: 'xuan',
      meaning: 'choose',
      examples: ['请选择一个。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });

    insertReviewSkillState({
      id: 'both-skills-overdue-word-forward',
      wordId: 'both-skills-overdue-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertReviewSkillState({
      id: 'both-skills-overdue-word-reverse',
      wordId: 'both-skills-overdue-word',
      direction: 'reverse',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordStudyAdmissionState('both-skills-overdue-word', null);
    insertWordSkillState({
      wordId: 'both-skills-overdue-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillState({
      wordId: 'both-skills-overdue-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });

    assert.deepEqual(getSessionItemIds(dbModule), ['review/both-skills-overdue-word/recognition']);
  });

  test('uses next due time as a deterministic tie-breaker when both overdue skills have equal urgency', () => {
    insertWord({
      id: 'equal-urgency-word',
      hanzi: '平',
      pinyin: 'ping',
      meaning: 'level',
      examples: ['路很平。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });

    insertReviewSkillState({
      id: 'equal-urgency-word-forward',
      wordId: 'equal-urgency-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(6),
    });
    insertReviewSkillState({
      id: 'equal-urgency-word-reverse',
      wordId: 'equal-urgency-word',
      direction: 'reverse',
      intervalHours: 12,
      lastReviewedAt: isoHoursAgo(24),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordStudyAdmissionState('equal-urgency-word', null);
    insertWordSkillState({
      wordId: 'equal-urgency-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(6),
    });
    insertWordSkillState({
      wordId: 'equal-urgency-word',
      skillId: 'production',
      intervalHours: 12,
      lastStudiedAt: isoHoursAgo(24),
      nextDueAt: isoHoursAgo(12),
    });

    assert.deepEqual(getSessionItemIds(dbModule), ['review/equal-urgency-word/production']);
  });

  test('recency guard suppresses the remaining overdue skill after a word-level review admission is completed', () => {
    insertWord({
      id: 'guarded-after-completion-word',
      hanzi: '隔',
      pinyin: 'ge',
      meaning: 'separate',
      examples: ['隔一段时间再看。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });

    insertReviewSkillState({
      id: 'guarded-after-completion-word-forward',
      wordId: 'guarded-after-completion-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertReviewSkillState({
      id: 'guarded-after-completion-word-reverse',
      wordId: 'guarded-after-completion-word',
      direction: 'reverse',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordStudyAdmissionState('guarded-after-completion-word', null);
    insertWordSkillState({
      wordId: 'guarded-after-completion-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordSkillState({
      wordId: 'guarded-after-completion-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });

    assert.deepEqual(getSessionItemIds(dbModule), ['review/guarded-after-completion-word/recognition']);

    dbModule.recordAcceptedReviewAttemptBatch({
      sessionId: 'guarded-after-completion-word-session',
      events: [
        {
          id: 'guarded-after-completion-word-attempt-1',
          occurredAt: '2026-05-10T00:00:00.000Z',
          sessionId: 'guarded-after-completion-word-session',
          sessionActionId: 'review/guarded-after-completion-word/recognition',
          sessionEventSequence: 1,
          actionAttemptSequence: 1,
          actionKind: 'recognition',
          targetWordId: 'guarded-after-completion-word',
          sampledSkillIds: ['recognition'],
          response: null,
          outcome: 'correct',
          rating: 'good',
          contentRef: null,
          metadata: {},
        },
      ],
      commitIntent: {
        type: 'commit-review-action-session',
        sessionActionId: 'review/guarded-after-completion-word/recognition',
        targetWordId: 'guarded-after-completion-word',
        actionKind: 'recognition',
        sampledSkillIds: ['recognition'],
        failureCount: 0,
        terminalRating: 'good',
      },
    });

    // guarded-after-completion-word-reverse also meets the urgency threshold, but it is
    // suppressed because completion resets the recency guard for the word.
    assert.deepEqual(getSessionItemIds(dbModule), []);
  });

  test('orders admitted review words by selected skill urgency before skill id ordering', () => {
    insertWord({
      id: 'less-urgent-production-word',
      hanzi: '低',
      pinyin: 'di',
      meaning: 'low',
      examples: ['声音很低。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });
    insertWord({
      id: 'more-urgent-recognition-word',
      hanzi: '高',
      pinyin: 'gao',
      meaning: 'high',
      examples: ['山很高。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(120),
    });

    insertReviewSkillState({
      id: 'less-urgent-production-word-reverse',
      wordId: 'less-urgent-production-word',
      direction: 'reverse',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });
    insertReviewSkillState({
      id: 'more-urgent-recognition-word-forward',
      wordId: 'more-urgent-recognition-word',
      direction: 'forward',
      intervalHours: 24,
      lastReviewedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });
    insertWordStudyAdmissionState('less-urgent-production-word', null);
    insertWordStudyAdmissionState('more-urgent-recognition-word', null);
    insertWordSkillState({
      wordId: 'less-urgent-production-word',
      skillId: 'production',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
    });
    insertWordSkillState({
      wordId: 'more-urgent-recognition-word',
      skillId: 'recognition',
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(72),
      nextDueAt: isoHoursAgo(48),
    });

    assert.deepEqual(getSessionItemIds(dbModule), [
      'review/more-urgent-recognition-word/recognition',
      'review/less-urgent-production-word/production',
    ]);
  });

  test('orders due review words by selected skill urgency', () => {
    insertWord({
      id: 'review-word-a',
      hanzi: '说',
      pinyin: 'shuo',
      meaning: 'speak',
      examples: ['你会说中文吗？'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(72),
    });
    insertWord({
      id: 'review-word-b',
      hanzi: '看',
      pinyin: 'kan',
      meaning: 'look',
      examples: ['我看书。'],
      status: 'review',
      priority: 90,
      createdAt: isoHoursAgo(48),
    });

    insertReviewSkillState({
      id: 'review-word-a-forward',
      wordId: 'review-word-a',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(3),
    });
    insertReviewSkillState({
      id: 'review-word-a-reverse',
      wordId: 'review-word-a',
      direction: 'reverse',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(1),
    });
    insertReviewSkillState({
      id: 'review-word-b-forward',
      wordId: 'review-word-b',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(4),
    });
    insertReviewSkillState({
      id: 'review-word-b-reverse',
      wordId: 'review-word-b',
      direction: 'reverse',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(2),
    });

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds, [
      'review/review-word-b/recognition',
      'review/review-word-a/recognition',
    ]);
  });

  test('includes uncovered learning words based on coverage day, not review scheduling fields', () => {
    insertWord({
      id: 'learning-word',
      hanzi: '学习',
      pinyin: 'xue xi',
      meaning: 'study',
      examples: ['我学习汉语。'],
      status: 'learning',
      priority: 90,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: null,
    });

    insertReviewSkillState({
      id: 'learning-word-forward',
      wordId: 'learning-word',
      direction: 'forward',
      intervalHours: 6,
      // Learning inclusion should ignore review scheduling metadata entirely.
      nextDueAt: isoHoursFromNow(48),
    });
    insertReviewSkillState({
      id: 'learning-word-reverse',
      wordId: 'learning-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds, ['learning/learning-word']);
  });

  test('excludes learning words already covered on the current UTC day', () => {
    insertWord({
      id: 'covered-learning-word',
      hanzi: '谢谢',
      pinyin: 'xie xie',
      meaning: 'thank you',
      examples: ['谢谢你。'],
      status: 'learning',
      priority: 80,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: today,
    });

    insertReviewSkillState({
      id: 'covered-learning-word-forward',
      wordId: 'covered-learning-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: isoHoursAgo(1),
    });
    insertReviewSkillState({
      id: 'covered-learning-word-reverse',
      wordId: 'covered-learning-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: isoHoursAgo(1),
    });

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds, []);
  });

  test('daily new-word limit defaults to 10 and persists independently from the completed count', () => {
    assert.equal(dbModule.getLearningPolicy(studyDayKey).dailyNewWordLimit, 10);
    assert.throws(
      () => dbModule.setDailyNewWordLimit(-1),
      /Expected non-negative integer dailyNewWordLimit/,
    );
    assert.throws(
      () => dbModule.setDailyNewWordLimit(1.5),
      /Expected non-negative integer dailyNewWordLimit/,
    );

    dbModule.setDailyNewWordLimit(3);
    insertUnstudiedWordPair('independent-limit-counter', 100, '2026-01-01T00:00:00.000Z');
    dbModule.completeUnstudiedWordSession('independent-limit-counter', studyDayKey);
    dbModule.setDailyNewWordLimit(5);

    const settingRow = sqlite
      .prepare(`SELECT value FROM app_metadata WHERE key = 'daily_new_word_limit'`)
      .get() as { value: string } | undefined;
    const intakeRow = sqlite
      .prepare('SELECT new_study_count FROM daily_new_word_intake WHERE day_key = ?')
      .get(studyDayKey) as { new_study_count: number } | undefined;

    assert.equal(settingRow?.value, '5');
    assert.equal(intakeRow?.new_study_count, 1);
    assert.equal(dbModule.getLearningPolicy(studyDayKey).dailyNewWordLimit, 5);
  });

  test('new sessions use configured limit minus completed count across limit and day changes', () => {
    for (let index = 0; index < 6; index += 1) {
      insertUnstudiedWordPair(
        `configurable-limit-${index + 1}`,
        100 - index,
        `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      );
    }

    dbModule.setDailyNewWordLimit(2);
    const initialPayload = dbModule.getSessionPayload(studyDayKey);
    assert.equal(initialPayload.buckets.unstudied.length, 2);

    for (const word of initialPayload.buckets.unstudied) {
      dbModule.completeUnstudiedWordSession(word.id, studyDayKey);
    }
    assert.equal(dbModule.getSessionPayload(studyDayKey).buckets.unstudied.length, 0);

    dbModule.setDailyNewWordLimit(4);
    assert.equal(dbModule.getSessionPayload(studyDayKey).buckets.unstudied.length, 2);

    dbModule.setDailyNewWordLimit(1);
    assert.equal(dbModule.getSessionPayload(studyDayKey).buckets.unstudied.length, 0);

    const nextDayKey = addDays(studyDayKey, 1);
    assert.equal(dbModule.getSessionPayload(nextDayKey).buckets.unstudied.length, 1);
  });

  test('zero limit blocks normal new words but preserves required overflow', () => {
    insertUnstudiedWordPair('zero-limit-normal', 100, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('zero-limit-required', 10, '2026-01-02T00:00:00.000Z');
    dbModule.updateWordUserPriority('zero-limit-required', { requiredForNextSession: true });
    dbModule.setDailyNewWordLimit(0);

    assert.deepEqual(
      dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id),
      ['zero-limit-required'],
    );
  });

  test('caps unstudied intake without requiring intra-bucket ordering', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);
    const totalUnstudiedWords = dailyNewWordLimit + 1;

    const words = Array.from({ length: totalUnstudiedWords }, (_, index) => {
      const isTopPriorityPair = index < 2;
      const day = String(index + 1).padStart(2, '0');
      return {
        id: `unstudied-${index + 1}`,
        hanzi: `词${index + 1}`,
        pinyin: `ci ${index + 1}`,
        meaning: `word ${index + 1}`,
        examples: [`例句 ${index + 1}`],
        status: 'unstudied' as const,
        priority: isTopPriorityPair ? 50 : 40 - index,
        createdAt: `2026-01-${day}T00:00:00.000Z`,
      };
    });

    for (const word of words) {
      insertWord(word);
    }

    for (const { id: wordId } of words) {
      insertReviewSkillState({
        id: `${wordId}-forward`,
        wordId,
        direction: 'forward',
        intervalHours: 6,
        nextDueAt: null,
      });
      insertReviewSkillState({
        id: `${wordId}-reverse`,
        wordId,
        direction: 'reverse',
        intervalHours: 6,
        nextDueAt: null,
      });
    }

    const sessionIds = getSessionItemIds(dbModule);
    assert.equal(sessionIds.length, dailyNewWordLimit);

    const sessionIdSet = new Set(sessionIds);
    assert.equal(sessionIdSet.has('unstudied/unstudied-1'), true);
    assert.equal(sessionIdSet.has('unstudied/unstudied-2'), true);

    assert.equal(sessionIds.includes(`unstudied/unstudied-${totalUnstudiedWords}`), false);
  });

  test('includes required unstudied words beyond the split even when the stash half is full of tops', () => {
    dbModule.setDailyNewWordLimit(2);
    insertUnstudiedWordPair('diet-high', 100, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('diet-low', 10, '2026-01-02T00:00:00.000Z');
    insertUnstudiedWordPair('top-fills-stash', 1, '2026-01-03T00:00:00.000Z');
    insertUnstudiedWordPair('required-extra', 2, '2026-01-04T00:00:00.000Z');
    dbModule.updateWordUserPriority('top-fills-stash', { forceTop: true });
    dbModule.updateWordUserPriority('required-extra', { requiredForNextSession: true });

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(new Set(sessionIds), new Set([
      'unstudied/top-fills-stash',
      'unstudied/diet-high',
      'unstudied/required-extra',
    ]));
  });

  test('does not duplicate required words that are already inside the normal cap', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);

    for (let index = 0; index < dailyNewWordLimit + 1; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      insertUnstudiedWordPair(`required-no-dupe-${index + 1}`, 100 - index, `2026-04-${day}T00:00:00.000Z`);
    }

    dbModule.updateWordUserPriority('required-no-dupe-1', { requiredForNextSession: true });

    const sessionIds = getSessionItemIds(dbModule);
    assert.equal(sessionIds.length, dailyNewWordLimit);
    assert.equal(sessionIds.filter((id) => id === 'unstudied/required-no-dupe-1').length, 1);
    assert.equal(sessionIds.includes('unstudied/required-no-dupe-11'), false);
  });

  test('does not admit dismissed required words as overflow', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);

    for (let index = 0; index < dailyNewWordLimit + 1; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      insertUnstudiedWordPair(`required-dismissed-${index + 1}`, 100 - index, `2026-05-${day}T00:00:00.000Z`);
    }

    const dismissedRequiredId = `required-dismissed-${dailyNewWordLimit + 1}`;
    dbModule.updateWordUserPriority(dismissedRequiredId, { requiredForNextSession: true });
    dbModule.dismissWordFromStudy(dismissedRequiredId);

    const sessionIds = getSessionItemIds(dbModule);
    assert.equal(sessionIds.length, dailyNewWordLimit);
    assert.equal(sessionIds.includes(`unstudied/${dismissedRequiredId}`), false);
  });

  test('splits remaining unstudied quota 50/50 between stash and diet', () => {
    dbModule.setDailyNewWordLimit(4);
    insertUnstudiedWordPair('diet-a', 100, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('diet-b', 90, '2026-01-02T00:00:00.000Z');
    insertUnstudiedWordPair('diet-c', 80, '2026-01-03T00:00:00.000Z');
    insertUnstudiedWordPair('stash-a', 1, '2026-01-04T00:00:00.000Z');
    insertUnstudiedWordPair('stash-b', 2, '2026-01-05T00:00:00.000Z');
    insertUnstudiedWordPair('stash-c', 3, '2026-01-06T00:00:00.000Z');
    dbModule.updateWordUserPriority('stash-a', { bumpDelta: 1 });
    dbModule.updateWordUserPriority('stash-b', { bumpDelta: 1 });
    dbModule.updateWordUserPriority('stash-c', { bumpDelta: 1 });

    const unstudiedIds = dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id);
    const stashIds = unstudiedIds.filter((id) => id.startsWith('stash-'));
    const dietIds = unstudiedIds.filter((id) => id.startsWith('diet-'));

    assert.equal(unstudiedIds.length, 4);
    assert.equal(stashIds.length, 2);
    assert.deepEqual(dietIds, ['diet-a', 'diet-b']);
  });

  test('odd remaining quota gives the extra unstudied slot to diet', () => {
    dbModule.setDailyNewWordLimit(5);
    insertUnstudiedWordPair('diet-a', 100, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('diet-b', 90, '2026-01-02T00:00:00.000Z');
    insertUnstudiedWordPair('diet-c', 80, '2026-01-03T00:00:00.000Z');
    insertUnstudiedWordPair('diet-d', 70, '2026-01-04T00:00:00.000Z');
    insertUnstudiedWordPair('stash-a', 1, '2026-01-05T00:00:00.000Z');
    insertUnstudiedWordPair('stash-b', 2, '2026-01-06T00:00:00.000Z');
    insertUnstudiedWordPair('stash-c', 3, '2026-01-07T00:00:00.000Z');
    dbModule.updateWordUserPriority('stash-a', { bumpDelta: 1 });
    dbModule.updateWordUserPriority('stash-b', { bumpDelta: 1 });
    dbModule.updateWordUserPriority('stash-c', { bumpDelta: 1 });

    const unstudiedIds = dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id);
    assert.equal(unstudiedIds.filter((id) => id.startsWith('stash-')).length, 2);
    assert.deepEqual(unstudiedIds.filter((id) => id.startsWith('diet-')), ['diet-a', 'diet-b', 'diet-c']);
  });

  test('fills leftover stash slots from diet and keeps diet frequency-ranked', () => {
    dbModule.setDailyNewWordLimit(4);
    insertUnstudiedWordPair('diet-a', 100, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('diet-b', 90, '2026-01-02T00:00:00.000Z');
    insertUnstudiedWordPair('diet-c', 80, '2026-01-03T00:00:00.000Z');
    insertUnstudiedWordPair('diet-d', 70, '2026-01-04T00:00:00.000Z');
    insertUnstudiedWordPair('stash-only', 1, '2026-01-05T00:00:00.000Z');
    dbModule.updateWordUserPriority('stash-only', { bumpDelta: 1 });

    assert.deepEqual(
      dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id),
      ['stash-only', 'diet-a', 'diet-b', 'diet-c'],
    );
  });

  test('tops fill the stash half newest-first and extra tops wait', () => {
    dbModule.setDailyNewWordLimit(4);
    insertUnstudiedWordPair('diet-a', 100, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('diet-b', 90, '2026-01-02T00:00:00.000Z');
    insertUnstudiedWordPair('diet-c', 80, '2026-01-03T00:00:00.000Z');
    insertUnstudiedWordPair('top-old', 1, '2026-01-04T00:00:00.000Z');
    insertUnstudiedWordPair('top-mid', 2, '2026-01-05T00:00:00.000Z');
    insertUnstudiedWordPair('top-new', 3, '2026-01-06T00:00:00.000Z');
    dbModule.updateWordUserPriority('top-old', { forceTop: true });
    dbModule.updateWordUserPriority('top-mid', { forceTop: true });
    dbModule.updateWordUserPriority('top-new', { forceTop: true });
    setOverlayUpdatedAt('top-old', '2026-01-01T00:00:00.000Z');
    setOverlayUpdatedAt('top-mid', '2026-01-02T00:00:00.000Z');
    setOverlayUpdatedAt('top-new', '2026-01-03T00:00:00.000Z');

    assert.deepEqual(
      dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id),
      ['top-new', 'top-mid', 'diet-a', 'diet-b'],
    );
  });

  test('sunk words are excluded from both unstudied pools', () => {
    dbModule.setDailyNewWordLimit(4);
    insertUnstudiedWordPair('diet-a', 50, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('sunk-high', 100, '2026-01-02T00:00:00.000Z');
    dbModule.dismissWordFromStudy('sunk-high');

    assert.deepEqual(
      dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id),
      ['diet-a'],
    );
  });

  test('overlay bump does not replace a higher-frequency diet word across pools', () => {
    dbModule.setDailyNewWordLimit(2);
    insertUnstudiedWordPair('diet-high', 100, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('diet-mid', 90, '2026-01-02T00:00:00.000Z');
    insertUnstudiedWordPair('bumped-low', 1, '2026-01-03T00:00:00.000Z');
    insertUnstudiedWordPair('bumped-lower', 2, '2026-01-04T00:00:00.000Z');
    dbModule.updateWordUserPriority('bumped-low', { bumpDelta: 5 });
    dbModule.updateWordUserPriority('bumped-lower', { bumpDelta: 5 });

    const unstudiedIds = dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id);
    assert.equal(unstudiedIds.length, 2);
    assert.equal(unstudiedIds.filter((id) => id.startsWith('bumped-')).length, 1);
    assert.equal(unstudiedIds.includes('diet-high'), true);
    assert.equal(unstudiedIds.includes('diet-mid'), false);
  });

  test('recomputing the same session payload does not re-roll stash admission', () => {
    dbModule.setDailyNewWordLimit(4);
    insertUnstudiedWordPair('diet-a', 100, '2026-01-01T00:00:00.000Z');
    insertUnstudiedWordPair('diet-b', 90, '2026-01-02T00:00:00.000Z');
    insertUnstudiedWordPair('stash-a', 1, '2026-01-03T00:00:00.000Z');
    insertUnstudiedWordPair('stash-b', 2, '2026-01-04T00:00:00.000Z');
    insertUnstudiedWordPair('stash-c', 3, '2026-01-05T00:00:00.000Z');
    dbModule.updateWordUserPriority('stash-a', { bumpDelta: 1 });
    dbModule.updateWordUserPriority('stash-b', { bumpDelta: 1 });
    dbModule.updateWordUserPriority('stash-c', { bumpDelta: 1 });

    const first = dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id);
    const second = dbModule.getSessionPayload(studyDayKey).buckets.unstudied.map((word) => word.id);
    assert.deepEqual(second, first);
  });

  test('unstudied completion clears required state', () => {
    insertUnstudiedWordPair('required-completed', 100, '2026-06-01T00:00:00.000Z');

    dbModule.updateWordUserPriority('required-completed', { requiredForNextSession: true });
    dbModule.completeUnstudiedWordSession('required-completed', studyDayKey);

    const priorityRow = sqlite
      .prepare('SELECT required_for_next_session FROM user_word_priority WHERE word_id = ?')
      .get('required-completed') as { required_for_next_session: number } | undefined;
    assert.equal(priorityRow?.required_for_next_session, 0);
  });

  test('completing an unstudied word reduces same-day remaining intake across sessions', () => {
    const { dailyNewWordLimit } = dbModule.getLearningPolicy(studyDayKey);

    const words = Array.from({ length: dailyNewWordLimit + 1 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return {
        id: `cross-session-${index + 1}`,
        hanzi: `跨${index + 1}`,
        pinyin: `kua ${index + 1}`,
        meaning: `cross ${index + 1}`,
        examples: [`cross ${index + 1}`],
        status: 'unstudied' as const,
        priority: 100 - index,
        createdAt: `2026-02-${day}T00:00:00.000Z`,
      };
    });

    for (const word of words) {
      insertWord(word);
      insertReviewSkillState({
        id: `${word.id}-forward`,
        wordId: word.id,
        direction: 'forward',
        intervalHours: 6,
        nextDueAt: null,
      });
      insertReviewSkillState({
        id: `${word.id}-reverse`,
        wordId: word.id,
        direction: 'reverse',
        intervalHours: 6,
        nextDueAt: null,
      });
    }

    const beforeCompletionIds = getSessionItemIds(dbModule);
    assert.equal(beforeCompletionIds.length, dailyNewWordLimit);

    dbModule.completeUnstudiedWordSession(words[0].id, studyDayKey);

    const afterCompletionIds = getSessionItemIds(dbModule);
    assert.equal(afterCompletionIds.length, dailyNewWordLimit - 1);
    assert.equal(afterCompletionIds.includes(`unstudied/${words[0].id}`), false);
    assert.equal(afterCompletionIds.includes(`unstudied/${words[dailyNewWordLimit].id}`), false);
  });

  test('session payload keeps current buckets and includes the full canonical answer catalog', () => {
    insertWord({
      id: 'payload-review-word',
      hanzi: '走',
      pinyin: 'zou',
      meaning: 'walk',
      examples: ['我走路去。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(48),
    });
    insertReviewSkillState({
      id: 'payload-review-word-forward',
      wordId: 'payload-review-word',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(3),
    });
    insertReviewSkillState({
      id: 'payload-review-word-reverse',
      wordId: 'payload-review-word',
      direction: 'reverse',
      intervalHours: 24,
      nextDueAt: isoHoursFromNow(3),
    });

    insertWord({
      id: 'payload-learning-word',
      hanzi: '跑',
      pinyin: 'pao',
      meaning: 'run',
      examples: ['他跑得很快。'],
      status: 'learning',
      priority: 90,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: yesterday,
    });
    insertReviewSkillState({
      id: 'payload-learning-word-forward',
      wordId: 'payload-learning-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewSkillState({
      id: 'payload-learning-word-reverse',
      wordId: 'payload-learning-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    insertWord({
      id: 'payload-excluded-word',
      hanzi: '坐',
      traditional: '坐傳',
      pinyin: 'zuo',
      meaning: 'sit',
      examples: ['请坐。'],
      status: 'learning',
      priority: 80,
      createdAt: isoHoursAgo(24),
      lastLearningCoveredOn: today,
    });
    insertReviewSkillState({
      id: 'payload-excluded-word-forward',
      wordId: 'payload-excluded-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewSkillState({
      id: 'payload-excluded-word-reverse',
      wordId: 'payload-excluded-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    const payload = dbModule.getSessionPayload(studyDayKey);

    assert.deepEqual(payload.buckets.review.map((item) => item.sessionActionId), [
      'review/payload-review-word/recognition',
    ]);
    assert.deepEqual(payload.buckets.learning.map((word) => word.id), ['payload-learning-word']);
    assert.deepEqual(payload.buckets.unstudied.map((word) => word.id), []);
    assert.deepEqual(
      payload.productionAnswerWords.find((word) => word.wordId === 'payload-excluded-word'),
      {
        wordId: 'payload-excluded-word',
        hanzi: '坐',
        traditional: '坐傳',
      },
    );
  });

  test('merges session categories as review actions first, then learning words, then unstudied intake', () => {
    insertWord({
      id: 'review-word',
      hanzi: '说',
      pinyin: 'shuo',
      meaning: 'speak',
      examples: ['你会说中文吗？'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(72),
    });
    insertWord({
      id: 'learning-word',
      hanzi: '看',
      pinyin: 'kan',
      meaning: 'look',
      examples: ['我看书。'],
      status: 'learning',
      priority: 90,
      createdAt: isoHoursAgo(48),
      lastLearningCoveredOn: null,
    });
    insertWord({
      id: 'unstudied-word',
      hanzi: '听',
      pinyin: 'ting',
      meaning: 'listen',
      examples: ['我听音乐。'],
      status: 'unstudied',
      priority: 80,
      createdAt: isoHoursAgo(24),
    });

    insertReviewSkillState({
      id: 'review-word-forward',
      wordId: 'review-word',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(2),
    });
    insertReviewSkillState({
      id: 'learning-word-forward',
      wordId: 'learning-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: isoHoursFromNow(12),
    });
    insertReviewSkillState({
      id: 'learning-word-reverse',
      wordId: 'learning-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: isoHoursAgo(12),
    });
    insertReviewSkillState({
      id: 'unstudied-word-forward',
      wordId: 'unstudied-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewSkillState({
      id: 'unstudied-word-reverse',
      wordId: 'unstudied-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    const sessionIds = getSessionItemIds(dbModule);
    assert.deepEqual(sessionIds.slice(0, 3), [
       'review/review-word/recognition',
       'learning/learning-word',
       'unstudied/unstudied-word',
    ]);
  });

  test('an unstudied word becomes a same-day non-obligation and a next-day learning obligation after completion', () => {
    insertWord({
      id: 'new-word',
      hanzi: '写',
      pinyin: 'xie',
      meaning: 'write',
      examples: ['我写汉字。'],
      status: 'unstudied',
      priority: 70,
      createdAt: isoHoursAgo(12),
    });
    insertReviewSkillState({
      id: 'new-word-forward',
      wordId: 'new-word',
      direction: 'forward',
      intervalHours: 6,
      nextDueAt: null,
    });
    insertReviewSkillState({
      id: 'new-word-reverse',
      wordId: 'new-word',
      direction: 'reverse',
      intervalHours: 6,
      nextDueAt: null,
    });

    assert.deepEqual(new Set(getSessionItemIds(dbModule)), new Set([
      'unstudied/new-word',
    ]));

    const updatedWord = dbModule.completeUnstudiedWordSession('new-word', studyDayKey);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.lastLearningCoveredOn, today);
    assert.deepEqual(getSessionItemIds(dbModule), []);

    // Simulate the next UTC day by moving the persisted coverage marker back one day.
    // This is standing in for clock control until we introduce an explicit backend clock seam.
    sqlite.prepare(`
      UPDATE words
      SET last_learning_covered_on = ?
      WHERE id = 'new-word'
    `).run(yesterday);

    assert.deepEqual(new Set(getSessionItemIds(dbModule)), new Set([
      'learning/new-word',
    ]));
  });

  test('refuses to compose a session while accepted attempt events remain unprojected', () => {
    insertWord({
      id: 'unprojected-event-word',
      hanzi: '迟',
      pinyin: 'chi',
      meaning: 'late',
      examples: ['他迟到了。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertReviewSkillState({
      id: 'unprojected-event-word-forward',
      wordId: 'unprojected-event-word',
      direction: 'forward',
      intervalHours: 24,
      nextDueAt: isoHoursAgo(1),
    });
    insertUnprojectedAttemptEvent({
      id: 'unprojected-event-word-attempt-1',
      sessionId: 'unprojected-event-session',
      sessionActionId: 'unprojected-event-session/action-1',
      targetWordId: 'unprojected-event-word',
      actionKind: 'recognition',
      sampledSkillIds: ['recognition'],
    });

    assert.throws(
      () => dbModule.getSessionPayload(studyDayKey),
      /Session composition invariant violated: accepted attempt event "unprojected-event-word-attempt-1" from session "unprojected-event-session" has not been projected\./,
    );
  });

  test.todo('keeps UTC date-key and ISO timestamp handling consistent across session composition boundaries');
});

function insertProductionCue({
  wordId,
  cueId,
  text,
  acceptedWordIds,
  active,
}: {
  wordId: string;
  cueId: string;
  text: string;
  acceptedWordIds: string[];
  active: boolean;
}) {
  const taskId = `production-task:${wordId}:default_production`;
  const eventId = `${cueId}-lifecycle`;
  sqlite.prepare(`
    INSERT INTO production_cues (
      cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id
    ) VALUES (?, ?, 'minimal_context', ?, ?, 'manual', NULL)
  `).run(cueId, taskId, text, isoHoursAgo(1));
  const insertAccepted = sqlite.prepare(`
    INSERT INTO production_cue_accepted_words (cue_id, word_id, position)
    VALUES (?, ?, ?)
  `);
  acceptedWordIds.forEach((acceptedWordId, position) => {
    insertAccepted.run(cueId, acceptedWordId, position);
  });
  sqlite.prepare(`
    INSERT INTO production_cue_lifecycle_events (
      event_id, cue_id, task_id, lifecycle_kind, occurred_at, invocation_id
    ) VALUES (?, ?, ?, ?, ?, NULL)
  `).run(eventId, cueId, taskId, active ? 'activated' : 'deactivated', isoHoursAgo(1));
  sqlite.prepare(`
    INSERT INTO production_cue_activation_state (
      cue_id, active, latest_lifecycle_event_id, updated_at
    ) VALUES (?, ?, ?, ?)
  `).run(cueId, active ? 1 : 0, eventId, isoHoursAgo(1));
}

function insertProjectedProductionAttempt(wordId: string) {
  const sessionId = `${wordId}-source-session`;
  const attemptId = `${wordId}-source-attempt`;
  const alternateWordId = `${wordId}-alternate`;
  insertWord({
    id: alternateWordId,
    hanzi: `${wordId} alternate`,
    pinyin: 'alternate',
    meaning: 'alternate',
    examples: [],
    status: 'unstudied',
    priority: -999,
    createdAt: isoHoursAgo(96),
  });
  sqlite.prepare(`
    INSERT INTO study_sessions (id, started_at, ended_at, processing_state, processed_at)
    VALUES (?, ?, ?, 'processed', ?)
  `).run(sessionId, isoHoursAgo(2), isoHoursAgo(1), isoHoursAgo(1));
  sqlite.prepare(`
    INSERT INTO study_attempt_events (
      id,
      occurred_at,
      session_id,
      session_action_id,
      session_event_sequence,
      action_attempt_sequence,
      action_kind,
      target_word_id,
      sampled_skill_ids_json,
      response,
      outcome,
      rating,
      content_ref_json,
      metadata_json,
      projected_at
    ) VALUES (?, ?, ?, ?, 1, 1, 'production', ?, '["production"]', ?, 'correct', 'good', NULL, ?, ?)
  `).run(
    attemptId,
    isoHoursAgo(1),
    sessionId,
    `review/${wordId}/production`,
    wordId,
    alternateWordId,
    JSON.stringify({
      production: {
        taskId: `production-task:${wordId}:default_production`,
        cueId: null,
        cueType: 'definition_gloss',
        text: 'source prompt',
        acceptedWordIds: [wordId, alternateWordId],
        anchorWordId: wordId,
        submittedText: alternateWordId,
        submittedWordId: alternateWordId,
        result: 'accepted_non_anchor',
        recheckDemandId: null,
      },
    }),
    isoHoursAgo(1),
  );
  dbModule.appendProductionCueAttemptEvidenceWithoutTransaction({
    occurredAt: isoHoursAgo(1),
    taskId: `production-task:${wordId}:default_production`,
    cueId: null,
    sourceAttemptId: attemptId,
    attemptResult: 'accepted_non_anchor',
    submittedWordId: alternateWordId,
  });
  return attemptId;
}

function insertWord(record: WordRecord) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      traditional,
      pinyin,
      meaning,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.hanzi,
    record.traditional ?? null,
    record.pinyin,
    record.meaning,
    JSON.stringify(record.examples),
    record.status,
    record.priority,
    record.createdAt,
    record.learningStreak ?? 0,
    record.lastLearningSuccessOn ?? null,
    record.lastLearningCoveredOn ?? null,
  );
}

function insertReviewSkillState(record: ReviewSkillStateRecord) {
  const lastReviewedAt = record.lastReviewedAt ?? inferLastReviewedAt(record.nextDueAt ?? null, record.intervalHours);

  const word = sqlite.prepare(`
    SELECT status
    FROM words
    WHERE id = ?
  `).get(record.wordId) as { status: WordStatus } | undefined;

  if (word?.status !== 'review' || lastReviewedAt === null) {
    return;
  }

  insertWordStudyAdmissionState(record.wordId, null);
  insertWordSkillState({
    wordId: record.wordId,
    skillId: record.direction === 'forward' ? 'recognition' : 'production',
    intervalHours: record.intervalHours,
    lastStudiedAt: lastReviewedAt,
    nextDueAt: record.nextDueAt ?? null,
    easeFactor: record.easeFactor ?? 2.5,
  });
}

function insertWordStudyAdmissionState(wordId: string, earliestNextStudyAt: string | null) {
  sqlite.prepare(`
    INSERT INTO word_study_admission_state (
      word_id,
      study_phase,
      earliest_next_study_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(word_id) DO UPDATE SET
      study_phase = excluded.study_phase,
      earliest_next_study_at = excluded.earliest_next_study_at
  `).run(wordId, 'review', earliestNextStudyAt);
}

function insertWordSkillState({
  wordId,
  skillId,
  intervalHours,
  lastStudiedAt,
  nextDueAt,
  enabled = true,
  easeFactor = 2.5,
}: {
  wordId: string;
  skillId: StudySkillId;
  intervalHours: number;
  lastStudiedAt: string;
  nextDueAt: string | null;
  enabled?: boolean;
  easeFactor?: number;
}) {
  sqlite.prepare(`
    INSERT INTO word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(word_id, skill_id) DO UPDATE SET
      enabled = excluded.enabled,
      interval_hours = excluded.interval_hours,
      last_studied_at = excluded.last_studied_at,
      next_due_at = excluded.next_due_at,
      ease_factor = excluded.ease_factor
  `).run(wordId, skillId, enabled ? 1 : 0, intervalHours, lastStudiedAt, nextDueAt, easeFactor);
}

function insertWordSkillRelevance(
  wordId: string,
  skillId: StudySkillId,
  relevanceState: 'normal' | 'deprioritized' | 'suppressed',
) {
  sqlite.prepare(`
    INSERT INTO word_skill_relevance (
      word_id,
      skill_id,
      relevance_state,
      updated_at,
      source_event_id
    ) VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(word_id, skill_id) DO UPDATE SET
      relevance_state = excluded.relevance_state,
      updated_at = excluded.updated_at,
      source_event_id = excluded.source_event_id
  `).run(wordId, skillId, relevanceState, '2026-05-10T00:00:00.000Z');
}

function insertBadProductionPromptFeedback(wordId: string) {
  sqlite.prepare(`
    INSERT INTO study_content_feedback (
      id,
      created_at,
      target_type,
      target_id,
      target_word_id,
      action_kind,
      feedback_type,
      source_event_id,
      note
    ) VALUES (?, ?, 'generated_prompt', 'definition_based_production', ?, 'production', 'bad_prompt', NULL, ?)
  `).run(
    `bad-production-prompt-${wordId}`,
    '2026-05-10T00:00:00.000Z',
    wordId,
    'Definition-based production prompt was marked bad.',
  );
}

function insertBadContrastPromptFeedback({
  promptId,
  targetWordId,
}: {
  promptId: string;
  targetWordId: string;
}) {
  sqlite.prepare(`
    INSERT INTO study_content_feedback (
      id,
      created_at,
      target_type,
      target_id,
      target_word_id,
      action_kind,
      feedback_type,
      source_event_id,
      note
    ) VALUES (?, ?, 'contrast_prompt', ?, ?, 'contrast_selection', 'bad_prompt', NULL, ?)
  `).run(
    `bad-contrast-prompt-${promptId}`,
    '2026-05-10T00:00:00.000Z',
    promptId,
    targetWordId,
    'Contrast prompt was marked bad.',
  );
}

function insertContrastContent({
  clusterId,
  scheduledWordId,
  siblingWordId,
  promptId,
  promptTargetWordId,
}: {
  clusterId: string;
  scheduledWordId: string;
  siblingWordId: string;
  promptId: string;
  promptTargetWordId: string;
}) {
  dbModule.createContrastCluster({
    id: clusterId,
    title: clusterId,
  });
  dbModule.addContrastClusterMember({
    clusterId,
    wordId: scheduledWordId,
  });
  dbModule.addContrastClusterMember({
    clusterId,
    wordId: siblingWordId,
  });
  dbModule.createContrastPrompt({
    id: promptId,
    clusterId,
    targetWordId: promptTargetWordId,
    promptText: `${promptId} prompt`,
    explanation: `${promptId} explanation`,
  });
}

function insertUnprojectedAttemptEvent({
  id,
  sessionId,
  sessionActionId,
  targetWordId,
  actionKind,
  sampledSkillIds,
}: {
  id: string;
  sessionId: string;
  sessionActionId: string;
  targetWordId: string;
  actionKind: 'recognition' | 'production';
  sampledSkillIds: StudySkillId[];
}) {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, ?, NULL, 'open', NULL)
  `).run(sessionId, '2026-05-10T00:00:00.000Z');

  sqlite.prepare(`
    INSERT INTO study_attempt_events (
      id,
      occurred_at,
      session_id,
      session_action_id,
      session_event_sequence,
      action_attempt_sequence,
      action_kind,
      target_word_id,
      sampled_skill_ids_json,
      response,
      outcome,
      rating,
      content_ref_json,
      metadata_json,
      projected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    '2026-05-10T00:05:00.000Z',
    sessionId,
    sessionActionId,
    1,
    1,
    actionKind,
    targetWordId,
    JSON.stringify(sampledSkillIds),
    null,
    'correct',
    'good',
    null,
    JSON.stringify({}),
  );
}

function inferLastReviewedAt(nextDueAt: string | null, intervalHours: number) {
  return nextDueAt ? shiftHours(nextDueAt, -intervalHours) : null;
}

function insertUnstudiedWordPair(id: string, priority: number, createdAt: string) {
  insertWord({
    id,
    hanzi: `${id}-hanzi`,
    pinyin: `${id}-pinyin`,
    meaning: `${id}-meaning`,
    examples: [`${id}-example`],
    status: 'unstudied',
    priority,
    createdAt,
  });

  insertReviewSkillState({
    id: `${id}-forward`,
    wordId: id,
    direction: 'forward',
    intervalHours: 6,
    nextDueAt: null,
  });
  insertReviewSkillState({
    id: `${id}-reverse`,
    wordId: id,
    direction: 'reverse',
    intervalHours: 6,
    nextDueAt: null,
  });
}

function setOverlayUpdatedAt(wordId: string, updatedAt: string) {
  sqlite.prepare(`
    UPDATE user_word_priority
    SET updated_at = ?
    WHERE word_id = ?
  `).run(updatedAt, wordId);
}

function isoHoursAgo(hours: number) {
  return shiftHours(new Date().toISOString(), -hours);
}

function isoHoursFromNow(hours: number) {
  return shiftHours(new Date().toISOString(), hours);
}

function shiftHours(isoTimestamp: string, hours: number) {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getSessionItemIds(db: DbModule): string[] {
  const payload = db.getSessionPayload(studyDayKey);
  return [
    ...payload.buckets.review.map((item) => item.sessionActionId),
    ...payload.buckets.learning.map((word) => `learning/${word.id}`),
    ...payload.buckets.unstudied.map((word) => `unstudied/${word.id}`),
  ];
}
