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

type ReviewAttemptInput = {
  rating: 'forgot' | 'hard' | 'good' | 'easy';
  outcome: 'correct' | 'incorrect';
  productionResult?: 'accepted_anchor' | 'rejected';
  responseKind?: 'typed' | 'no_clue';
};

type DbModule = typeof import('../server/db.ts');

const today = new Date().toISOString().slice(0, 10);
const studyDayKey = today;

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('session completion', { concurrency: false }, () => {
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
      DELETE FROM production_cue_evidence_projection;
      DELETE FROM production_recheck_demands;
      DELETE FROM production_cue_evidence_records;
      DELETE FROM production_cue_activation_state;
      DELETE FROM production_cue_lifecycle_events;
      DELETE FROM production_cue_accepted_words;
      DELETE FROM production_cues;
      DELETE FROM study_content_feedback;
      DELETE FROM contrast_candidate_intake;
      DELETE FROM word_skill_relevance;
      DELETE FROM study_attempt_events;
      DELETE FROM study_sessions;
      DELETE FROM daily_new_word_intake;
      DELETE FROM review_session_summaries;
      DELETE FROM word_skill_state;
      DELETE FROM word_study_admission_state;
      DELETE FROM words;
    `);
    dbModule.ensureProductionCueSchema();
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('recording an accepted review attempt batch projects scheduler state', () => {
    insertReviewWordWithItem({
      wordId: 'hard-word',
      sessionActionId: 'hard-word-forward',
      direction: 'forward',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('hard-word', null);
    insertWordSkillState('hard-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'hard-word-forward',
      wordId: 'hard-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      rating: 'hard',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'hard',
    });
    assertIntervalHoursNear(updatedState.intervalHours, 15); // base 15 = 10 * 1.5 (hard pass), ±1h fuzz
    assert.equal(updatedState.easeFactor, 2.35); // 2.35 = 2.5 - 0.15 (hard pass easeFactor penalty)
    // We only care that completion writes a real UTC timestamp, not the exact wall-clock instant.
    assert.match(updatedState.lastStudiedAt, isoUtcTimestampPattern);
    assert.equal(
      updatedState.nextDueAt,
      addHours(updatedState.lastStudiedAt, updatedState.intervalHours),
    );

    assert.deepEqual(fetchWordSkillState('hard-word', 'recognition'), {
      wordId: 'hard-word',
      skillId: 'recognition',
      enabled: true,
      intervalHours: updatedState.intervalHours,
      lastStudiedAt: updatedState.lastStudiedAt,
      nextDueAt: updatedState.nextDueAt,
      easeFactor: updatedState.easeFactor,
    });
    assert.equal(fetchAdmissionState('hard-word')?.earliestNextStudyAt, addHours(
      updatedState.lastStudiedAt,
      6,
    ));
    assert.equal(fetchAttemptProjectedAt('review/hard-word/recognition-attempt-1'), updatedState.lastStudiedAt);
  });

  test('recording a correct contrast attempt projects only scheduled word contextual state', () => {
    insertWord({
      id: 'contrast-scheduled-word',
      hanzi: '恰当',
      pinyin: 'qia dang',
      meaning: 'appropriate exactly',
      examples: ['很恰当。'],
      status: 'review',
      priority: 100,
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    insertWord({
      id: 'contrast-target-word',
      hanzi: '适当',
      pinyin: 'shi dang',
      meaning: 'suitable',
      examples: ['适当休息。'],
      status: 'review',
      priority: 100,
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    insertWordStudyAdmissionState('contrast-scheduled-word', null);
    insertWordSkillState('contrast-scheduled-word', 'contextual_selection', {
      intervalHours: 6,
      lastStudiedAt: isoHoursAgo(12),
      nextDueAt: isoHoursAgo(6),
      easeFactor: 2.5,
    });

    const { state } = recordAcceptedContrastSelectionAttempt({
      wordId: 'contrast-scheduled-word',
      selectedWordId: 'contrast-target-word',
      promptTargetWordId: 'contrast-target-word',
      choiceWordIds: ['contrast-scheduled-word', 'contrast-target-word'],
      rating: 'good',
      practiceMore: true,
    });

    assert.equal(state.wordId, 'contrast-scheduled-word');
    assert.equal(state.skillId, 'contextual_selection');
    assertIntervalHoursNear(state.intervalHours, 15);
    assert.equal(state.easeFactor, 2.5);
    assert.equal(fetchWordSkillState('contrast-target-word', 'contextual_selection'), undefined);
    assert.equal(fetchAttemptProjectedAt('review/contrast-scheduled-word/contextual_selection-attempt-1'), state.lastStudiedAt);
  });

  test('recording an incorrect contrast attempt resets scheduled word interval to six hours', () => {
    insertWord({
      id: 'contrast-wrong-word',
      hanzi: '严肃',
      pinyin: 'yan su',
      meaning: 'serious',
      examples: ['表情严肃。'],
      status: 'review',
      priority: 100,
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    insertWordStudyAdmissionState('contrast-wrong-word', null);
    insertWordSkillState('contrast-wrong-word', 'contextual_selection', {
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
      easeFactor: 2.5,
    });

    const { state } = recordAcceptedContrastSelectionAttempt({
      wordId: 'contrast-wrong-word',
      selectedWordId: 'contrast-distractor-word',
      promptTargetWordId: 'contrast-wrong-word',
      choiceWordIds: ['contrast-wrong-word', 'contrast-distractor-word'],
      rating: 'forgot',
      practiceMore: false,
    });

    assert.equal(state.intervalHours, 6);
    assert.equal(state.easeFactor, 2.35);
    assert.equal(state.nextDueAt, addHours(state.lastStudiedAt, 6));
  });

  test('incorrect contrast attempts must be recorded as forgot', () => {
    insertWord({
      id: 'contrast-rating-contract-word',
      hanzi: '严肃',
      pinyin: 'yan su',
      meaning: 'serious',
      examples: ['表情严肃。'],
      status: 'review',
      priority: 100,
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    insertWordStudyAdmissionState('contrast-rating-contract-word', null);
    insertWordSkillState('contrast-rating-contract-word', 'contextual_selection', {
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(36),
      nextDueAt: isoHoursAgo(12),
      easeFactor: 2.5,
    });

    assert.throws(
      () =>
        recordAcceptedContrastSelectionAttempt({
          wordId: 'contrast-rating-contract-word',
          selectedWordId: 'contrast-distractor-word',
          promptTargetWordId: 'contrast-rating-contract-word',
          choiceWordIds: ['contrast-rating-contract-word', 'contrast-distractor-word'],
          rating: 'easy',
          practiceMore: false,
        }),
      /Expected incorrect contrast selection rating to be forgot/,
    );
  });

  test('recording an accepted review attempt batch does not require a backing review action row', () => {
    insertWord({
      id: 'action-only-word',
      hanzi: '行',
      pinyin: 'xing',
      meaning: 'OK',
      examples: ['这样也行。'],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(72),
    });
    insertWordStudyAdmissionState('action-only-word', null);
    insertWordSkillState('action-only-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'action-only-word-forward',
      wordId: 'action-only-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      rating: 'good',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'good',
    });

    assertIntervalHoursNear(updatedState.intervalHours, 25);
    assert.equal(updatedState.easeFactor, 2.5);
    assert.equal(updatedState.nextDueAt, addHours(updatedState.lastStudiedAt, updatedState.intervalHours));
  });

  test('accepted review attempt batch rejects commit intents that do not match events', () => {
    insertReviewWordWithItem({
      wordId: 'mismatch-word',
      sessionActionId: 'mismatch-word-forward',
      direction: 'forward',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('mismatch-word', null);
    insertWordSkillState('mismatch-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    assert.throws(
      () =>
        recordAcceptedReviewBatch({
          sessionActionId: 'mismatch-word-forward',
          wordId: 'mismatch-word',
          actionKind: 'recognition',
          skillId: 'recognition',
          rating: 'good',
          outcome: 'correct',
          failureCount: 1, // nonzero failure count cannot be considered a correct outcome
          terminalRating: null,
        }),
      /do not match supplied review commit intent/,
    );

    assert.equal(dbModule.getStudyAttemptEventsForSession('mismatch-word-forward-session').length, 0);
  });

  test('accepted review attempt batch rejects action intents that do not match event target skill', () => {
    insertReviewWordWithItem({
      wordId: 'skill-mismatch-word',
      sessionActionId: 'skill-mismatch-word-reverse',
      direction: 'reverse',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('skill-mismatch-word', null);
    insertWordSkillState('skill-mismatch-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    assert.throws(
      () =>
        dbModule.recordAcceptedReviewAttemptBatch({
          sessionId: 'skill-mismatch-word-session',
          events: [
            {
              id: 'skill-mismatch-word-attempt-1',
              occurredAt: '2026-05-10T00:00:00.000Z',
              sessionId: 'skill-mismatch-word-session',
              sessionActionId: 'review/skill-mismatch-word/recognition',
              sessionEventSequence: 1,
              actionAttemptSequence: 1,
              actionKind: 'recognition',
              targetWordId: 'skill-mismatch-word',
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
            sessionActionId: 'review/skill-mismatch-word/production',
            targetWordId: 'skill-mismatch-word',
            actionKind: 'production',
            sampledSkillIds: ['production'],
            failureCount: 0,
            terminalRating: 'good',
          },
        }),
      /do not match supplied review action intent/,
    );

    assert.equal(dbModule.getStudyAttemptEventsForSession('skill-mismatch-word-session').length, 0);
  });

  test('recording a clean good review attempt batch multiplies by ease and projects scheduler state', () => {
    insertReviewWordWithItem({
      wordId: 'good-word',
      sessionActionId: 'good-word-forward',
      direction: 'forward',
      intervalHours: 21,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('good-word', null);
    insertWordSkillState('good-word', 'recognition', {
      intervalHours: 21,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'good-word-forward',
      wordId: 'good-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      rating: 'good',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'good',
    });

    assertIntervalHoursNear(updatedState.intervalHours, 53); // base ceil(21 * 2.5) = 53, ±1h fuzz
    assert.equal(updatedState.easeFactor, 2.5);
    assert.equal(
      updatedState.nextDueAt,
      addHours(updatedState.lastStudiedAt, updatedState.intervalHours),
    );
    assertProjectedReviewState('good-word', 'recognition', updatedState);
  });

  test('recording a reverse review attempt batch projects production skill state', () => {
    insertReviewWordWithItem({
      wordId: 'production-word',
      sessionActionId: 'production-word-reverse',
      direction: 'reverse',
      intervalHours: 12,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('production-word', null);
    insertWordSkillState('production-word', 'production', {
      intervalHours: 12,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'production-word-reverse',
      wordId: 'production-word',
      actionKind: 'production',
      skillId: 'production',
      rating: 'good',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'good',
    });

    assert.deepEqual(fetchWordSkillState('production-word', 'production'), {
      wordId: 'production-word',
      skillId: 'production',
      enabled: true,
      intervalHours: updatedState.intervalHours,
      lastStudiedAt: updatedState.lastStudiedAt,
      nextDueAt: updatedState.nextDueAt,
      easeFactor: updatedState.easeFactor,
    });
    assert.equal(fetchWordSkillState('production-word', 'recognition'), undefined);
  });

  test('a no-clue production attempt persists null provenance and uses ordinary lapse projection', () => {
    insertReviewWordWithItem({
      wordId: 'no-clue-production',
      sessionActionId: 'no-clue-production-reverse',
      direction: 'reverse',
      intervalHours: 24,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('no-clue-production', null);
    insertWordSkillState('no-clue-production', 'production', {
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { events, state } = recordAcceptedReviewBatch({
      sessionActionId: 'no-clue-production-reverse',
      wordId: 'no-clue-production',
      actionKind: 'production',
      skillId: 'production',
      failureCount: 1,
      terminalRating: null,
      attempts: [
        { rating: 'forgot', outcome: 'incorrect', responseKind: 'no_clue' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
      ],
    });

    assert.equal(events[0]?.response, null);
    assert.equal((events[0]?.metadata.production as { responseKind?: unknown }).responseKind, 'no_clue');
    assert.equal(state.intervalHours, 6);
    assert.equal(state.easeFactor, 2.35);
    assert.equal(dbModule.getPendingProductionRecheckForWord('no-clue-production'), null);
  });

  test('production reconciliation preserves clean alternate responses and consumes one-shot rechecks', () => {
    insertWord({
      id: 'alternate-anchor',
      hanzi: '锚',
      pinyin: 'mao',
      meaning: 'anchor',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWord({
      id: 'alternate-answer',
      hanzi: '另',
      pinyin: 'ling',
      meaning: 'alternate',
      examples: [],
      status: 'review',
      priority: 90,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('alternate-anchor', isoHoursAgo(1));
    insertWordSkillState('alternate-anchor', 'production', {
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(24),
      easeFactor: 2.5,
    });
    insertProductionCue({
      wordId: 'alternate-anchor',
      cueId: 'alternate-cue',
      text: 'Give either accepted answer',
      acceptedWordIds: ['alternate-anchor', 'alternate-answer'],
    });
    const originalSkill = fetchWordSkillState('alternate-anchor', 'production');
    const originalAdmission = fetchAdmissionState('alternate-anchor');

    const firstAttemptId = commitProductionAttempt({
      anchorWordId: 'alternate-anchor',
      cueId: 'alternate-cue',
      cueText: 'Give either accepted answer',
      acceptedWordIds: ['alternate-anchor', 'alternate-answer'],
      submittedText: '另',
      submittedWordId: 'alternate-answer',
      result: 'accepted_non_anchor',
      recheckDemandId: null,
    });

    assert.deepEqual(fetchWordSkillState('alternate-anchor', 'production'), originalSkill);
    assert.deepEqual(fetchAdmissionState('alternate-anchor'), originalAdmission);
    const initialDemand = dbModule.getPendingProductionRecheckForWord('alternate-anchor');
    assert.equal(initialDemand?.sourceAttemptId, firstAttemptId);
    assert.equal(initialDemand?.dueAt, addHours(initialDemand?.scheduledAt ?? fail('Missing recheck'), 48));
    const evidenceRow = sqlite.prepare(`
      SELECT attempt_result, submitted_word_id
      FROM production_cue_evidence_records
      WHERE source_attempt_id = ?
    `).get(firstAttemptId) as { attempt_result: string; submitted_word_id: string | null };
    assert.equal(evidenceRow.attempt_result, 'accepted_non_anchor');
    assert.equal(evidenceRow.submitted_word_id, 'alternate-answer');

    insertWord({
      id: 'due-anchor',
      hanzi: '回',
      pinyin: 'hui',
      meaning: 'return',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('due-anchor', addHours(new Date().toISOString(), 24));
    insertWordSkillState('due-anchor', 'production', {
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(1),
      nextDueAt: addHours(new Date().toISOString(), 23),
      easeFactor: 2.5,
    });
    insertProductionCue({
      wordId: 'due-anchor',
      cueId: 'due-cue',
      text: 'Come back',
      acceptedWordIds: ['due-anchor'],
    });
    const dueSourceAttemptId = insertProjectedProductionSourceAttempt('due-anchor');
    const dueScheduledAt = isoHoursAgo(49);
    const dueDemand = dbModule.appendProductionRecheckDemandWithoutTransaction({
      demandId: 'due-demand',
      taskId: 'production-task:due-anchor:default_production',
      sourceAttemptId: dueSourceAttemptId,
      scheduledAt: dueScheduledAt,
      dueAt: addHours(dueScheduledAt, 48),
    });
    const dueOriginalSkill = fetchWordSkillState('due-anchor', 'production');
    const dueCommitAttemptId = commitProductionAttempt({
      anchorWordId: 'due-anchor',
      cueId: 'due-cue',
      cueText: 'Come back',
      acceptedWordIds: ['due-anchor'],
      submittedText: '回',
      submittedWordId: 'due-anchor',
      result: 'accepted_anchor',
      recheckDemandId: dueDemand.demandId,
    });

    assert.equal(dbModule.getPendingProductionRecheckForWord('due-anchor'), null);
    assert.equal(dbModule.getProductionRecheckDemand(dueDemand.demandId)?.consumedByAttemptId, dueCommitAttemptId);
    assert.notDeepEqual(fetchWordSkillState('due-anchor', 'production'), dueOriginalSkill);

    insertWord({
      id: 'reschedule-anchor',
      hanzi: '再查',
      pinyin: 'zai cha',
      meaning: 'check again',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWord({
      id: 'reschedule-answer',
      hanzi: '复查',
      pinyin: 'fu cha',
      meaning: 'recheck',
      examples: [],
      status: 'review',
      priority: 90,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('reschedule-anchor', isoHoursAgo(1));
    insertWordSkillState('reschedule-anchor', 'production', {
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(24),
      easeFactor: 2.5,
    });
    insertProductionCue({
      wordId: 'reschedule-anchor',
      cueId: 'reschedule-cue',
      text: 'Check this answer space again',
      acceptedWordIds: ['reschedule-anchor', 'reschedule-answer'],
    });
    const rescheduleSourceAttemptId = insertProjectedProductionSourceAttempt('reschedule-anchor');
    const rescheduleScheduledAt = isoHoursAgo(49);
    const oldDemand = dbModule.appendProductionRecheckDemandWithoutTransaction({
      demandId: 'old-reschedule-demand',
      taskId: 'production-task:reschedule-anchor:default_production',
      sourceAttemptId: rescheduleSourceAttemptId,
      scheduledAt: rescheduleScheduledAt,
      dueAt: addHours(rescheduleScheduledAt, 48),
    });
    const rescheduleOriginalSkill = fetchWordSkillState('reschedule-anchor', 'production');
    const rescheduleOriginalAdmission = fetchAdmissionState('reschedule-anchor');
    commitProductionAttempt({
      anchorWordId: 'reschedule-anchor',
      cueId: 'reschedule-cue',
      cueText: 'Check this answer space again',
      acceptedWordIds: ['reschedule-anchor', 'reschedule-answer'],
      submittedText: '复查',
      submittedWordId: 'reschedule-answer',
      result: 'accepted_non_anchor',
      recheckDemandId: oldDemand.demandId,
    });

    const successor = dbModule.getPendingProductionRecheckForWord('reschedule-anchor');
    assert.notEqual(successor?.demandId, oldDemand.demandId);
    assert.equal(successor?.dueAt, addHours(successor?.scheduledAt ?? fail('Missing successor'), 48));
    assert.equal(dbModule.getProductionRecheckDemand(oldDemand.demandId)?.replacementDemandId, successor?.demandId);
    assert.deepEqual(fetchWordSkillState('reschedule-anchor', 'production'), rescheduleOriginalSkill);
    assert.deepEqual(fetchAdmissionState('reschedule-anchor'), rescheduleOriginalAdmission);
  });

  test('a covered production action with an initial rejection keeps ordinary lapse projection', () => {
    insertReviewWordWithItem({
      wordId: 'production-lapse',
      sessionActionId: 'production-lapse-reverse',
      direction: 'reverse',
      intervalHours: 40,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('production-lapse', null);
    insertWordSkillState('production-lapse', 'production', {
      intervalHours: 40,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state } = recordAcceptedReviewBatch({
      sessionActionId: 'production-lapse-reverse',
      wordId: 'production-lapse',
      actionKind: 'production',
      skillId: 'production',
      failureCount: 1,
      terminalRating: null,
      attempts: [
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
      ],
    });

    assert.equal(state.intervalHours, 6);
    assert.equal(state.easeFactor, 2.35);
    assert.equal(dbModule.getPendingProductionRecheckForWord('production-lapse'), null);
    const evidenceCount = sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM production_cue_evidence_records
      WHERE task_id = 'production-task:production-lapse:default_production'
    `).get() as { count: number };
    assert.equal(evidenceCount.count, 4);
  });

  test('an accepted typed response rated forgot keeps the ordinary lapse projection', () => {
    insertReviewWordWithItem({
      wordId: 'accepted-forgot-production',
      sessionActionId: 'accepted-forgot-production-reverse',
      direction: 'reverse',
      intervalHours: 40,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('accepted-forgot-production', null);
    insertWordSkillState('accepted-forgot-production', 'production', {
      intervalHours: 40,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state } = recordAcceptedReviewBatch({
      sessionActionId: 'accepted-forgot-production-reverse',
      wordId: 'accepted-forgot-production',
      actionKind: 'production',
      skillId: 'production',
      failureCount: 1,
      terminalRating: null,
      attempts: [
        { rating: 'forgot', outcome: 'incorrect', productionResult: 'accepted_anchor' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
      ],
    });

    assert.equal(state.intervalHours, 6);
    assert.equal(state.easeFactor, 2.35);
    assert.equal(dbModule.getPendingProductionRecheckForWord('accepted-forgot-production'), null);
  });

  test('rolls back attempt, cue evidence, scheduling, and recheck writes together', () => {
    insertWord({
      id: 'atomic-anchor',
      hanzi: '整',
      pinyin: 'zheng',
      meaning: 'whole',
      examples: [],
      status: 'review',
      priority: 100,
      createdAt: isoHoursAgo(96),
    });
    insertWordStudyAdmissionState('atomic-anchor', isoHoursAgo(1));
    insertWordSkillState('atomic-anchor', 'production', {
      intervalHours: 24,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(24),
      easeFactor: 2.5,
    });
    insertProductionCue({
      wordId: 'atomic-anchor',
      cueId: 'atomic-cue',
      text: 'Keep this transaction whole',
      acceptedWordIds: ['atomic-anchor'],
    });
    const originalSkill = fetchWordSkillState('atomic-anchor', 'production');
    const originalAdmission = fetchAdmissionState('atomic-anchor');
    sqlite.exec(`
      CREATE TRIGGER fail_session_cue_evidence
      BEFORE INSERT ON production_cue_evidence_records
      BEGIN
        SELECT RAISE(ABORT, 'forced cue evidence failure');
      END;
    `);

    try {
      assert.throws(() => commitProductionAttempt({
        anchorWordId: 'atomic-anchor',
        cueId: 'atomic-cue',
        cueText: 'Keep this transaction whole',
        acceptedWordIds: ['atomic-anchor'],
        submittedText: '整',
        submittedWordId: 'atomic-anchor',
        result: 'accepted_anchor',
        recheckDemandId: null,
      }), /forced cue evidence failure/);
    } finally {
      sqlite.exec('DROP TRIGGER IF EXISTS fail_session_cue_evidence;');
    }

    assert.deepEqual(fetchWordSkillState('atomic-anchor', 'production'), originalSkill);
    assert.deepEqual(fetchAdmissionState('atomic-anchor'), originalAdmission);
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM study_attempt_events WHERE target_word_id = 'atomic-anchor'
    `).get().count, 0);
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM production_cue_evidence_records WHERE task_id = ?
    `).get('production-task:atomic-anchor:default_production').count, 0);
    assert.equal(dbModule.getPendingProductionRecheckForWord('atomic-anchor'), null);
  });

  test('recording a clean easy review attempt batch uses the easy bonus and projects scheduler state', () => {
    insertReviewWordWithItem({
      wordId: 'easy-word',
      sessionActionId: 'easy-word-forward',
      direction: 'forward',
      intervalHours: 20,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('easy-word', null);
    insertWordSkillState('easy-word', 'recognition', {
      intervalHours: 20,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'easy-word-forward',
      wordId: 'easy-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      rating: 'easy',
      outcome: 'correct',
      failureCount: 0,
      terminalRating: 'easy',
    });

    assertIntervalHoursNear(updatedState.intervalHours, 57); // base ceil(20 * (2.5 + 0.35)) = 57, ±1h fuzz
    assert.equal(updatedState.easeFactor, 2.65);
    assert.equal(
      updatedState.nextDueAt,
      addHours(updatedState.lastStudiedAt, updatedState.intervalHours),
    );
    assertProjectedReviewState('easy-word', 'recognition', updatedState);
  });

  test('recording a lapsed review attempt batch resets the interval, penalizes ease, and projects scheduler state', () => {
    insertReviewWordWithItem({
      wordId: 'lapsed-word',
      sessionActionId: 'lapsed-word-forward',
      direction: 'forward',
      intervalHours: 40,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('lapsed-word', null);
    insertWordSkillState('lapsed-word', 'recognition', {
      intervalHours: 40,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'lapsed-word-forward',
      wordId: 'lapsed-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      failureCount: 2,
      terminalRating: null,
      attempts: [
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'hard', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'easy', outcome: 'correct' },
      ],
    });

    assert.equal(updatedState.intervalHours, 6);
    assert.equal(updatedState.easeFactor, 2.2); // 2.2 = 2.5 - (2 * 0.15)
    assert.equal(
      updatedState.nextDueAt,
      addHours(updatedState.lastStudiedAt, 6),
    );
    assertProjectedReviewState('lapsed-word', 'recognition', updatedState);
    for (let index = 1; index <= 6; index += 1) {
      assert.equal(fetchAttemptProjectedAt(`review/lapsed-word/recognition-attempt-${index}`), updatedState.lastStudiedAt);
    }
  });

  test('projected review lapse penalties respect the minimum ease floor', () => {
    insertReviewWordWithItem({
      wordId: 'penalty-floor-word',
      sessionActionId: 'penalty-floor-word-forward',
      direction: 'forward',
      intervalHours: 40,
      easeFactor: 1.9,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('penalty-floor-word', null);
    insertWordSkillState('penalty-floor-word', 'recognition', {
      intervalHours: 40,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 1.9,
    });

    const { state: updatedState } = recordAcceptedReviewBatch({
      sessionActionId: 'penalty-floor-word-forward',
      wordId: 'penalty-floor-word',
      actionKind: 'recognition',
      skillId: 'recognition',
      failureCount: 5,
      terminalRating: null,
      attempts: [
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'forgot', outcome: 'incorrect' },
        { rating: 'hard', outcome: 'correct' },
        { rating: 'good', outcome: 'correct' },
        { rating: 'easy', outcome: 'correct' },
      ],
    });

    assert.equal(updatedState.intervalHours, 6);
    assert.equal(updatedState.easeFactor, 1.8); // without the floor, this would be 1.15 = 1.9 - (5 * 0.15).
    assertProjectedReviewState('penalty-floor-word', 'recognition', updatedState);
  });

  test('accepted review attempt batch rejects a clean pass intent without a terminal rating', () => {
    insertReviewWordWithItem({
      wordId: 'missing-rating-word',
      sessionActionId: 'missing-rating-word-forward',
      direction: 'forward',
      intervalHours: 10,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('missing-rating-word', null);
    insertWordSkillState('missing-rating-word', 'recognition', {
      intervalHours: 10,
      lastStudiedAt: isoHoursAgo(48),
      nextDueAt: isoHoursAgo(1),
      easeFactor: 2.5,
    });

    assert.throws(
      () =>
        recordAcceptedReviewBatch({
          sessionActionId: 'missing-rating-word-forward',
          wordId: 'missing-rating-word',
          actionKind: 'recognition',
          skillId: 'recognition',
          rating: 'good',
          outcome: 'correct',
          failureCount: 0,
          terminalRating: null,
        }),
      /do not match supplied review commit intent/,
    );
  });

  test('successful learning completion increments the streak and updates success and coverage dates', () => {
    // mock an initial state where, yesterday, the user successfully learned this word
    insertLearningWordWithItems({
      wordId: 'learning-success-word',
      learningStreak: 1,
      lastLearningSuccessOn: addDays(today, -1),
      lastLearningCoveredOn: null,
    });

    const updatedWord = dbModule.completeLearningWordSession('learning-success-word', true);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.learningStreak, 2);
    assert.equal(updatedWord.lastLearningSuccessOn, today);
    assert.equal(updatedWord.lastLearningCoveredOn, today);
    assert.deepEqual(fetchWord('learning-success-word'), updatedWord);
  });

  test('failed learning completion resets the streak but preserves the last success date', () => {
    insertLearningWordWithItems({
      wordId: 'learning-failure-word',
      learningStreak: 2,
      lastLearningSuccessOn: addDays(today, -2),
      lastLearningCoveredOn: null,
    });

    const updatedWord = dbModule.completeLearningWordSession('learning-failure-word', false);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.learningStreak, 0);
    assert.equal(updatedWord.lastLearningSuccessOn, addDays(today, -2));
    assert.equal(updatedWord.lastLearningCoveredOn, today);
  });

  test('the third consecutive successful learning session graduates a word to review and resets review scheduling', () => {
    insertLearningWordWithItems({
      wordId: 'graduating-word',
      learningStreak: 2,
      lastLearningSuccessOn: addDays(today, -1),
      lastLearningCoveredOn: null,
      intervalHours: 6,
      easeFactor: 2.5,
      nextDueAt: isoHoursAgo(1),
      lastReviewedAt: isoHoursAgo(12),
    });

    const beforeCompletion = new Date();
    const updatedWord = dbModule.completeLearningWordSession('graduating-word', true);
    const afterCompletion = new Date();

    assert.equal(updatedWord.status, 'review');
    assert.equal(updatedWord.learningStreak, 3);
    assert.equal(updatedWord.lastLearningSuccessOn, today);
    assert.equal(updatedWord.lastLearningCoveredOn, today);

    const skillStates = dbModule.getWordSkillStates().filter((state) => state.wordId === 'graduating-word');
    assert.deepEqual(
      skillStates.map((state) => [state.skillId, state.intervalHours, state.easeFactor]),
      [
        ['production', 24, 2.5],
        ['recognition', 24, 2.5],
      ],
    );
    for (const state of skillStates) {
      assert.match(state.lastStudiedAt, isoUtcTimestampPattern);
      assert.match(state.nextDueAt ?? '', isoUtcTimestampPattern);

      const reviewedAt = new Date(state.lastStudiedAt);
      const nextDueAt = new Date(state.nextDueAt ?? fail('missing nextDueAt'));
      assert.ok(reviewedAt >= beforeCompletion);
      assert.ok(reviewedAt <= afterCompletion);
      assert.equal(nextDueAt.getTime() - reviewedAt.getTime(), 24 * 60 * 60 * 1000);
    }
  });

  test('learning completion rejects unknown words', () => {
    assert.throws(
      () => dbModule.completeLearningWordSession('missing-word', true),
      /Word not found/,
    );
  });

  test('review failure rates aggregate session summaries and expose rolling rates', () => {
    insertReviewSessionSummary({
      sessionId: 'old-session',
      dayKey: addDays(studyDayKey, -2),
      failed: true,
    });

    dbModule.recordReviewSessionSummary({
      sessionId: 'session-a',
      completedAt: `${studyDayKey}T12:00:00.000Z`,
      completedReviewActionCount: 2,
      failedReviewActionCount: 1,
      activeDurationMs: 90_000,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'session-b',
      completedAt: `${studyDayKey}T13:00:00.000Z`,
      completedReviewActionCount: 1,
      failedReviewActionCount: 1,
      activeDurationMs: 30_000,
    });

    const days = dbModule.getReviewFailureRateDays();
    assert.equal(days.length, 2);
    assert.deepEqual(days.map((day) => day.dayKey), [addDays(studyDayKey, -2), studyDayKey]);

    const todayRates = days[1];
    assert.equal(todayRates.completedReviewActionSessions, 3);
    assert.equal(todayRates.failedReviewActionSessions, 2);
    assert.equal(todayRates.failureRate, 2 / 3);
    assert.equal(todayRates.rolling3DayFailureRate, 3 / 4);
    assert.equal(todayRates.rolling7DayFailureRate, 3 / 4);
  });

  test('active session time metrics use completed-session days and fixed calendar-day divisors', () => {
    dbModule.recordReviewSessionSummary({
      sessionId: 'seven-days-ago',
      completedAt: `${addDays(studyDayKey, -7)}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 999_000,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'two-days-ago',
      completedAt: `${addDays(studyDayKey, -2)}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 60_000,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'today',
      completedAt: `${studyDayKey}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 120_000,
    });

    assert.deepEqual(dbModule.getSessionActiveTimeMetrics(studyDayKey), {
      todayActiveDurationMs: 120_000,
      rolling3DayAverageActiveDurationMs: 60_000,
      rolling7DayAverageActiveDurationMs: 180_000 / 7,
    });
  });

  test('active session time metrics aggregate multiple sessions within each day', () => {
    const sessionsByDay = [
      { dayKey: studyDayKey, durations: [30_000, 90_000] },
      { dayKey: addDays(studyDayKey, -1), durations: [60_000, 120_000] },
      { dayKey: addDays(studyDayKey, -2), durations: [180_000, 240_000] },
    ];

    for (const { dayKey, durations } of sessionsByDay) {
      durations.forEach((activeDurationMs, index) => {
        dbModule.recordReviewSessionSummary({
          sessionId: `${dayKey}-session-${index + 1}`,
          completedAt: `${dayKey}T${String(12 + index).padStart(2, '0')}:00:00.000Z`,
          completedReviewActionCount: 0,
          failedReviewActionCount: 0,
          activeDurationMs,
        });
      });
    }

    assert.deepEqual(dbModule.getSessionActiveTimeMetrics(studyDayKey), {
      todayActiveDurationMs: 120_000,
      rolling3DayAverageActiveDurationMs: 240_000,
      rolling7DayAverageActiveDurationMs: 720_000 / 7,
    });
  });

  test('active duration validation rejects negative values and summary upserts replace the duration', () => {
    assert.throws(
      () => dbModule.recordReviewSessionSummary({
        sessionId: 'invalid-duration',
        completedAt: `${studyDayKey}T12:00:00.000Z`,
        completedReviewActionCount: 0,
        failedReviewActionCount: 0,
        activeDurationMs: -1,
      }),
      /Expected non-negative integer activeDurationMs/,
    );

    dbModule.recordReviewSessionSummary({
      sessionId: 'upsert-duration',
      completedAt: `${studyDayKey}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 1_000,
    });
    dbModule.recordReviewSessionSummary({
      sessionId: 'upsert-duration',
      completedAt: `${studyDayKey}T12:00:00.000Z`,
      completedReviewActionCount: 0,
      failedReviewActionCount: 0,
      activeDurationMs: 2_000,
    });

    assert.equal(
      sqlite.prepare('SELECT active_duration_ms FROM review_session_summaries WHERE session_id = ?').get('upsert-duration').active_duration_ms,
      2_000,
    );
  });

  test('updating word personal notes persists the new notes and returns the updated word', () => {
    insertWord({
      id: 'personal-notes-update-word',
      hanzi: '改',
      pinyin: 'gai',
      meaning: 'old definition',
      examples: ['我改了定义。'],
      status: 'learning',
      priority: 55,
      createdAt: isoHoursAgo(2),
    });

    const updatedWord = dbModule.updateWordPersonalNotes('personal-notes-update-word', 'Remember this collocation.');
    assert.equal(updatedWord.personalNotes, 'Remember this collocation.');
    assert.equal(fetchWord('personal-notes-update-word').personalNotes, 'Remember this collocation.');
    assert.equal(fetchWord('personal-notes-update-word').meaning, 'old definition');
  });

  test('updating word personal notes rejects unknown words', () => {
    assert.throws(
      () => dbModule.updateWordPersonalNotes('missing-word', 'new notes'),
      /Word not found/,
    );
  });

  test('unstudied completion transitions the word into learning', () => {
    insertWord({
      id: 'unstudied-transition-word',
      hanzi: '写',
      pinyin: 'xie',
      meaning: 'write',
      examples: ['我写字。'],
      status: 'unstudied',
      priority: 50,
      createdAt: isoHoursAgo(8),
    });

    const updatedWord = dbModule.completeUnstudiedWordSession('unstudied-transition-word', studyDayKey);
    assert.equal(updatedWord.status, 'learning');
    assert.equal(updatedWord.learningStreak, 0);
    assert.equal(updatedWord.lastLearningSuccessOn, null);
    assert.equal(updatedWord.lastLearningCoveredOn, today);
    assert.deepEqual(dbModule.getWordSkillStates().filter((state) => state.wordId === 'unstudied-transition-word'), []);
    assert.equal(fetchAdmissionState('unstudied-transition-word'), undefined);
  });

  test('unstudied completion rejects words with unexpected learning progress already attached', () => {
    insertWord({
      id: 'invalid-unstudied-word',
      hanzi: '写',
      pinyin: 'xie',
      meaning: 'write',
      examples: ['我写字。'],
      status: 'unstudied',
      priority: 50,
      createdAt: isoHoursAgo(8),
      learningStreak: 1,
      lastLearningSuccessOn: addDays(today, -1),
    });

    assert.throws(
      () => dbModule.completeUnstudiedWordSession('invalid-unstudied-word', studyDayKey),
      /Unstudied word has unexpected learning progress/,
    );
  });

  test('unstudied completion rejects unknown words', () => {
    assert.throws(
      () => dbModule.completeUnstudiedWordSession('missing-word', studyDayKey),
      /Word not found/,
    );
  });

  test('dismissing an unstudied word keeps it unstudied and persists sunk priority tier', () => {
    insertWord({
      id: 'dismiss-unstudied-word',
      hanzi: '略',
      pinyin: 'lue',
      meaning: 'omit',
      examples: ['先略过。'],
      status: 'unstudied',
      priority: 45,
      createdAt: isoHoursAgo(2),
    });

    dbModule.dismissWordFromStudy('dismiss-unstudied-word');

    const word = fetchWord('dismiss-unstudied-word');
    assert.equal(word.status, 'unstudied');
    assert.equal(word.learningStreak, 0);
    assert.equal(word.lastLearningSuccessOn, null);
    assert.equal(word.lastLearningCoveredOn, null);

    const priorityRow = fetchUserPriorityRow('dismiss-unstudied-word');
    assert.equal(priorityRow?.bump_count, 0);
    assert.equal(priorityRow?.force_top, 0);
    assert.equal(priorityRow?.priority_tier, -1);
  });

  test('dismissing a learning word returns it to unstudied and sinks priority', () => {
    insertLearningWordWithItems({
      wordId: 'dismiss-learning-word',
      learningStreak: 2,
      lastLearningSuccessOn: addDays(today, -1),
      lastLearningCoveredOn: today,
      intervalHours: 24,
      nextDueAt: isoHoursAgo(1),
    });
    insertWordStudyAdmissionState('dismiss-learning-word', isoHoursAgo(1));
    insertWordSkillState('dismiss-learning-word', 'recognition');

    dbModule.dismissWordFromStudy('dismiss-learning-word');

    const word = fetchWord('dismiss-learning-word');
    assert.equal(word.status, 'unstudied');
    assert.equal(word.learningStreak, 0);
    assert.equal(word.lastLearningSuccessOn, null);
    assert.equal(word.lastLearningCoveredOn, null);
    assert.equal(fetchUserPriorityRow('dismiss-learning-word')?.priority_tier, -1);
    assert.equal(fetchAdmissionState('dismiss-learning-word'), undefined);
    assert.equal(fetchWordSkillState('dismiss-learning-word', 'recognition'), undefined);
  });

  test('dismissing rejects unknown words', () => {
    assert.throws(
      () => dbModule.dismissWordFromStudy('missing-word'),
      /Word not found/,
    );
  });
});

function insertReviewWordWithItem(options: {
  wordId: string;
  sessionActionId: string;
  direction: Direction;
  intervalHours: number;
  easeFactor: number;
  nextDueAt: string;
}) {
  insertWord({
    id: options.wordId,
    hanzi: '词',
    pinyin: 'ci',
    meaning: 'word',
    examples: ['例句'],
    status: 'review',
    priority: 100,
    createdAt: isoHoursAgo(72),
  });

}

function insertLearningWordWithItems(options: {
  wordId: string;
  learningStreak: number;
  lastLearningSuccessOn: string | null;
  lastLearningCoveredOn: string | null;
  intervalHours?: number;
  easeFactor?: number;
  nextDueAt?: string | null;
  lastReviewedAt?: string | null;
}) {
  insertWord({
    id: options.wordId,
    hanzi: '学',
    pinyin: 'xue',
    meaning: 'learn',
    examples: ['学习'],
    status: 'learning',
    priority: 90,
    createdAt: isoHoursAgo(48),
    learningStreak: options.learningStreak,
    lastLearningSuccessOn: options.lastLearningSuccessOn,
    lastLearningCoveredOn: options.lastLearningCoveredOn,
  });

}

function fetchWord(wordId: string) {
  return dbModule.getWords().find((word) => word.id === wordId) ?? fail(`Missing word ${wordId}`);
}

function fetchWordSkillState(wordId: string, skillId: StudySkillId) {
  return dbModule.getWordSkillStates().find((state) => state.wordId === wordId && state.skillId === skillId);
}

function fetchAdmissionState(wordId: string) {
  return dbModule.getWordStudyAdmissionStates().find((state) => state.wordId === wordId);
}

function fetchAttemptProjectedAt(eventId: string) {
  const row = sqlite
    .prepare(`
      SELECT projected_at
      FROM study_attempt_events
      WHERE id = ?
    `)
    .get(eventId) as { projected_at: string | null } | undefined;

  return row?.projected_at ?? null;
}

function assertProjectedReviewState(
  wordId: string,
  skillId: StudySkillId,
  updatedState: NonNullable<ReturnType<typeof fetchWordSkillState>>,
) {
  assert.deepEqual(fetchWordSkillState(wordId, skillId), {
    wordId,
    skillId,
    enabled: true,
    intervalHours: updatedState.intervalHours,
    lastStudiedAt: updatedState.lastStudiedAt,
    nextDueAt: updatedState.nextDueAt,
    easeFactor: updatedState.easeFactor,
  });
  assert.equal(fetchAdmissionState(wordId)?.earliestNextStudyAt, addHours(
    updatedState.lastStudiedAt,
    6,
  ));
}

function fetchUserPriorityRow(wordId: string) {
  return sqlite
    .prepare(`
      SELECT
        bump_count,
        force_top,
        priority_tier
      FROM user_word_priority
      WHERE word_id = ?
    `)
    .get(wordId) as { bump_count: number; force_top: number; priority_tier: number } | undefined;
}

// recall: batch consists of both list of events along with the v1 commit intent metadata
function recordAcceptedReviewBatch({
  sessionActionId,
  wordId,
  actionKind,
  skillId,
  rating,
  outcome,
  failureCount,
  terminalRating,
  attempts,
}: {
  sessionActionId: string;
  wordId: string;
  actionKind: 'recognition' | 'production';
  skillId: StudySkillId;
  rating?: 'forgot' | 'hard' | 'good' | 'easy';
  outcome?: 'correct' | 'incorrect';
  failureCount: number;
  terminalRating: 'hard' | 'good' | 'easy' | null;
  attempts?: ReviewAttemptInput[];
}) {
  const computedSessionActionId = `review/${wordId}/${skillId}`;
  const attemptInputs = attempts ?? [
    {
      rating: rating ?? fail('Expected rating when attempts are omitted'),
      outcome: outcome ?? fail('Expected outcome when attempts are omitted'),
    },
  ];
  const productionWord = actionKind === 'production'
    ? dbModule.getWords().find((word) => word.id === wordId) ?? fail(`Missing production word ${wordId}`)
    : null;

  const result = dbModule.recordAcceptedReviewAttemptBatch({
    sessionId: `${computedSessionActionId}-session`,
    events: attemptInputs.map((attempt, index) => {
      const sequence = index + 1;
      const productionResult = attempt.productionResult
        ?? (attempt.outcome === 'correct' ? 'accepted_anchor' : 'rejected');
      const productionAccepted = productionResult === 'accepted_anchor';
      const noClue = attempt.responseKind === 'no_clue';

      return {
        id: `${computedSessionActionId}-attempt-${sequence}`,
        occurredAt: '2026-05-10T00:00:00.000Z',
        sessionId: `${computedSessionActionId}-session`,
        sessionActionId: computedSessionActionId,
        sessionEventSequence: sequence,
        actionAttemptSequence: sequence,
        actionKind,
        targetWordId: wordId,
        sampledSkillIds: [skillId],
        response: productionWord === null || noClue
          ? null
          : productionAccepted
            ? productionWord.hanzi
            : 'incorrect-production-response',
        outcome: attempt.outcome,
        rating: attempt.rating,
        contentRef: null,
        metadata: productionWord === null
          ? {}
          : {
              production: {
                taskId: `production-task:${wordId}:default_production`,
                cueId: null,
                cueType: 'definition_gloss',
                text: productionWord.meaning,
                acceptedWordIds: [wordId],
                anchorWordId: wordId,
                ...(noClue ? { responseKind: 'no_clue' } : {}),
                submittedText: noClue
                  ? null
                  : productionAccepted
                  ? productionWord.hanzi
                  : 'incorrect-production-response',
                submittedWordId: productionAccepted ? wordId : null,
                result: productionResult,
                recheckDemandId: null,
              },
            },
      };
    }),
    commitIntent: {
      type: 'commit-review-action-session',
      sessionActionId: computedSessionActionId,
      targetWordId: wordId,
      actionKind,
      sampledSkillIds: [skillId],
      failureCount,
      terminalRating,
    },
  });

  return {
    ...result,
    state: fetchWordSkillState(wordId, skillId) ?? fail(`Missing projected skill state ${wordId}/${skillId}`),
  };
}

function recordAcceptedContrastSelectionAttempt({
  wordId,
  selectedWordId,
  promptTargetWordId,
  choiceWordIds,
  rating,
  practiceMore,
}: {
  wordId: string;
  selectedWordId: string;
  promptTargetWordId: string;
  choiceWordIds: string[];
  rating: 'forgot' | 'hard' | 'good' | 'easy';
  practiceMore: boolean;
}) {
  const sessionActionId = `review/${wordId}/contextual_selection`;
  const sessionId = `${sessionActionId}-session`;
  const outcome = selectedWordId === promptTargetWordId ? 'correct' : 'incorrect';
  const eventId = `${sessionActionId}-attempt-1`;

  dbModule.recordAcceptedContrastSelectionAttempt({
    sessionId,
    event: {
      id: eventId,
      occurredAt: '2026-05-10T00:00:00.000Z',
      sessionId,
      sessionActionId,
      sessionEventSequence: 1,
      actionAttemptSequence: 1,
      actionKind: 'contrast_selection',
      targetWordId: wordId,
      sampledSkillIds: ['contextual_selection'],
      response: selectedWordId,
      outcome,
      rating,
      contentRef: { type: 'contrast_prompt', id: 'contrast-prompt-1' },
      metadata: {
        promptTargetWordId,
        choiceWordIds,
        practiceMore,
      },
    },
    commitIntent: {
      type: 'commit-contrast-selection-action-session',
      sessionActionId,
      targetWordId: wordId,
      actionKind: 'contrast_selection',
      sampledSkillIds: ['contextual_selection'],
      selectedWordId,
      promptTargetWordId,
      choiceWordIds,
      rating,
      practiceMore,
    },
  });

  return {
    state: fetchWordSkillState(wordId, 'contextual_selection') ?? fail(`Missing projected skill state ${wordId}/contextual_selection`),
  };
}

function insertProductionCue({
  wordId,
  cueId,
  text,
  acceptedWordIds,
}: {
  wordId: string;
  cueId: string;
  text: string;
  acceptedWordIds: string[];
}) {
  const taskId = `production-task:${wordId}:default_production`;
  const lifecycleEventId = `${cueId}-activated`;
  sqlite.prepare(`
    INSERT INTO production_cues (
      cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id
    ) VALUES (?, ?, 'minimal_context', ?, ?, 'manual', NULL)
  `).run(cueId, taskId, text, isoHoursAgo(1));
  const insertAcceptedWord = sqlite.prepare(`
    INSERT INTO production_cue_accepted_words (cue_id, word_id, position)
    VALUES (?, ?, ?)
  `);
  acceptedWordIds.forEach((acceptedWordId, position) => {
    insertAcceptedWord.run(cueId, acceptedWordId, position);
  });
  sqlite.prepare(`
    INSERT INTO production_cue_lifecycle_events (
      event_id, cue_id, task_id, lifecycle_kind, occurred_at, invocation_id
    ) VALUES (?, ?, ?, 'activated', ?, NULL)
  `).run(lifecycleEventId, cueId, taskId, isoHoursAgo(1));
  sqlite.prepare(`
    INSERT INTO production_cue_activation_state (
      cue_id, active, latest_lifecycle_event_id, updated_at
    ) VALUES (?, 1, ?, ?)
  `).run(cueId, lifecycleEventId, isoHoursAgo(1));
}

function insertProjectedProductionSourceAttempt(wordId: string) {
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

function commitProductionAttempt({
  anchorWordId,
  cueId,
  cueText,
  acceptedWordIds,
  submittedText,
  submittedWordId,
  result,
  recheckDemandId,
}: {
  anchorWordId: string;
  cueId: string;
  cueText: string;
  acceptedWordIds: string[];
  submittedText: string;
  submittedWordId: string | null;
  result: 'accepted_anchor' | 'accepted_non_anchor' | 'rejected';
  recheckDemandId: string | null;
}) {
  const suffix = recheckDemandId ?? result;
  const sessionActionId = recheckDemandId === null
    ? `review/${anchorWordId}/production/${suffix}`
    : `review/${anchorWordId}/production/recheck/${suffix}`;
  const sessionId = `${sessionActionId}-session`;
  const attemptId = `${sessionActionId}-attempt-1`;
  dbModule.recordAcceptedReviewAttemptBatch({
    sessionId,
    events: [{
      id: attemptId,
      occurredAt: new Date().toISOString(),
      sessionId,
      sessionActionId,
      sessionEventSequence: 1,
      actionAttemptSequence: 1,
      actionKind: 'production',
      targetWordId: anchorWordId,
      sampledSkillIds: ['production'],
      response: submittedText,
      outcome: result === 'rejected' ? 'incorrect' : 'correct',
      rating: result === 'rejected' ? 'forgot' : 'good',
      contentRef: {
        type: 'production_cue',
        taskId: `production-task:${anchorWordId}:default_production`,
        cueId,
      },
      metadata: {
        production: {
          taskId: `production-task:${anchorWordId}:default_production`,
          cueId,
          cueType: 'minimal_context',
          text: cueText,
          acceptedWordIds,
          anchorWordId,
          submittedText,
          submittedWordId,
          result,
          recheckDemandId,
        },
      },
    }],
    commitIntent: {
      type: 'commit-review-action-session',
      sessionActionId,
      targetWordId: anchorWordId,
      actionKind: 'production',
      sampledSkillIds: ['production'],
      failureCount: result === 'rejected' ? 1 : 0,
      terminalRating: result === 'rejected' ? null : 'good',
    },
  });
  return attemptId;
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
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.hanzi,
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

function insertWordStudyAdmissionState(wordId: string, earliestNextStudyAt: string | null) {
  sqlite.prepare(`
    INSERT INTO word_study_admission_state (
      word_id,
      study_phase,
      earliest_next_study_at
    ) VALUES (?, ?, ?)
  `).run(wordId, 'review', earliestNextStudyAt);
}

function insertWordSkillState(
  wordId: string,
  skillId: StudySkillId,
  options?: {
    intervalHours?: number;
    lastStudiedAt?: string;
    nextDueAt?: string | null;
    easeFactor?: number;
  },
) {
  sqlite.prepare(`
    INSERT INTO word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    ) VALUES (?, ?, 1, ?, ?, ?, ?)
  `).run(
    wordId,
    skillId,
    options?.intervalHours ?? 24,
    options?.lastStudiedAt ?? isoHoursAgo(25),
    options?.nextDueAt ?? isoHoursAgo(1),
    options?.easeFactor ?? 2.5,
  );
}

function insertReviewSessionSummary({
  sessionId,
  dayKey,
  failed,
}: {
  sessionId: string;
  dayKey: string;
  failed: boolean;
}) {
  sqlite.prepare(`
    INSERT INTO review_session_summaries (
      session_id,
      completed_at,
      day_key,
      completed_count,
      failed_count
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    sessionId,
    `${dayKey}T12:00:00.000Z`,
    dayKey,
    1,
    failed ? 1 : 0,
  );
}

function isoHoursAgo(hours: number) {
  return addHours(new Date().toISOString(), -hours);
}

function addHours(isoTimestamp: string, hours: number) {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fail(message: string): never {
  throw new Error(message);
}

function assertIntervalHoursNear(actual: number, expectedBase: number) {
  assert.ok(
    actual >= expectedBase - 1 && actual <= expectedBase + 1,
    `expected intervalHours near ${expectedBase} (±1 fuzz), got ${actual}`,
  );
}

const isoUtcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
