import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  derivePureCueAssessment,
  schedulePureCueAssessment,
  selectPureCuesForSession,
  type PureCue,
  type PureCueServedSnapshot,
} from '../src/domain/pure-cues.ts';

const now = '2026-09-18T00:00:00.000Z';

function cue(overrides: Partial<PureCue> = {}): PureCue {
  return {
    id: 'cue-a',
    stimulus: 'to tell an untruth',
    axisNote: 'ordinary speech',
    acceptedWordIds: ['word-a', 'word-b'],
    intervalHours: 24,
    easeFactor: 2.5,
    lastStudiedAt: null,
    nextDueAt: now,
    strongSince: null,
    strongSuccesses: 0,
    active: true,
    ...overrides,
  };
}

function servedSnapshot(): PureCueServedSnapshot {
  return {
    snapshotId: 'snapshot-a',
    pureCueId: 'cue-a',
    servedAt: now,
    stimulus: 'to tell an untruth',
    axisNote: 'ordinary speech',
    acceptedAnswers: [
      { wordId: 'word-a', hanzi: '撒谎', traditional: '撒謊' },
      { wordId: 'word-b', hanzi: '说谎', traditional: '說謊' },
    ],
  };
}

describe('pure cue domain policy', () => {
  test('uses existing SRS multipliers and applies strong crossing, success, lapse, and re-entry rules', () => {
    const crossed = schedulePureCueAssessment(
      cue({ intervalHours: 300 }),
      { failureCount: 0, terminalRating: 'good' },
      now,
      () => 0.5,
    );
    assert.equal(crossed.intervalHours, 750);
    assert.equal(crossed.strongSince, now);
    assert.equal(crossed.strongSuccesses, 0);

    const strongSuccess = schedulePureCueAssessment(
      crossed,
      { failureCount: 0, terminalRating: 'hard' },
      '2026-09-19T00:00:00.000Z',
      () => 0.5,
    );
    assert.equal(strongSuccess.intervalHours, 1125);
    assert.equal(strongSuccess.easeFactor, 2.35);
    assert.equal(strongSuccess.strongSince, now);
    assert.equal(strongSuccess.strongSuccesses, 1);

    const lapsed = schedulePureCueAssessment(
      strongSuccess,
      { failureCount: 2, terminalRating: null },
      '2026-09-20T00:00:00.000Z',
    );
    assert.equal(lapsed.intervalHours, 6);
    assert.equal(lapsed.easeFactor, 2.05);
    assert.equal(lapsed.strongSince, null);
    assert.equal(lapsed.strongSuccesses, 0);

    const reentered = schedulePureCueAssessment(
      lapsed,
      { failureCount: 0, terminalRating: 'easy' },
      '2026-09-21T00:00:00.000Z',
      () => 0.5,
    );
    assert.equal(reentered.strongSince, null);
    assert.equal(reentered.strongSuccesses, 0);
  });

  test('admits all due fragile cues and budgeted strong cues with recency and reciprocal weighting', () => {
    const selection = selectPureCuesForSession({
      cues: [
        cue({ id: 'fragile-due' }),
        cue({ id: 'fragile-later', nextDueAt: '2026-09-19T00:00:00.000Z' }),
        cue({ id: 'strong-fresh', strongSince: '2026-08-01T00:00:00.000Z', lastStudiedAt: '2026-09-17T23:00:00.000Z' }),
        cue({ id: 'strong-zero', strongSince: '2026-08-01T00:00:00.000Z', strongSuccesses: 0 }),
        cue({ id: 'strong-nine', strongSince: '2026-08-01T00:00:00.000Z', strongSuccesses: 9 }),
      ],
      ordinaryReviewCount: 19,
      now,
      random: () => 0,
    });
    assert.deepEqual(selection.fragile.map((item) => item.id), ['fragile-due']);
    assert.deepEqual(selection.strong.map((item) => item.id), ['strong-nine', 'strong-zero']);
    assert.deepEqual(selection.selected.map((item) => item.id), ['fragile-due', 'strong-nine', 'strong-zero']);
  });

  test('rounds fractional budgets probabilistically without a minimum daily entitlement', () => {
    const strong = Array.from({ length: 4 }, (_, index) => cue({
      id: `strong-${index}`, intervalHours: 1000, strongSince: now,
      nextDueAt: '2027-01-01T00:00:00.000Z',
    }));
    for (const [count, roll, expected] of [[0, 0, 0], [6, 0.59, 1], [6, 0.6, 0], [25, 0.49, 3], [25, 0.5, 2]]) {
      const selected = selectPureCuesForSession({
        cues: strong, ordinaryReviewCount: count!, now, random: () => roll!,
      }).strong;
      assert.equal(selected.length, expected);
      assert.equal(new Set(selected.map((item) => item.id)).size, selected.length);
    }
  });

  test('reentry resets strong weight and a repeated accepted member remains successful', () => {
    const reentered = schedulePureCueAssessment(cue({ intervalHours: 300, strongSuccesses: 9 }),
      { failureCount: 0, terminalRating: 'good' }, now, () => 0.5);
    assert.equal(reentered.strongSince, now);
    assert.equal(reentered.strongSuccesses, 0);
    const events = [null, '说谎', '说谎', '说谎'].map((response, index) => ({
      eventId: `reinforcement-${index}`, occurredAt: now, response,
      outcome: response === null ? 'rejected' as const : 'accepted' as const,
      submittedWordId: response === null ? null : 'word-b',
      rating: response === null ? 'forgot' as const : 'good' as const,
    }));
    assert.deepEqual(derivePureCueAssessment(servedSnapshot(), events), { failureCount: 1, terminalRating: null });
    assert.throws(() => derivePureCueAssessment(servedSnapshot(), events.slice(0, 3)), /covered assessment/);
  });

  test('validates accepted outcomes against frozen answer forms and derives one clean assessment', () => {
    assert.deepEqual(derivePureCueAssessment(servedSnapshot(), [{
      eventId: 'event-a',
      occurredAt: now,
      response: '說謊',
      outcome: 'accepted',
      submittedWordId: 'word-b',
      rating: 'good',
    }]), { failureCount: 0, terminalRating: 'good' });

    assert.throws(() => derivePureCueAssessment(servedSnapshot(), [{
      eventId: 'event-b',
      occurredAt: now,
      response: '别的',
      outcome: 'accepted',
      submittedWordId: 'word-a',
      rating: 'good',
    }]), /frozen accepted-answer forms/);

    assert.throws(() => derivePureCueAssessment(servedSnapshot(), [{
      eventId: '',
      occurredAt: now,
      response: '说谎',
      outcome: 'accepted',
      submittedWordId: 'word-b',
      rating: 'good',
    }]), /event id must be non-empty/);
    assert.throws(() => derivePureCueAssessment(servedSnapshot(), [{
      eventId: 'event-invalid-rating',
      occurredAt: now,
      response: '说谎',
      outcome: 'accepted',
      submittedWordId: 'word-b',
      rating: 'surprise' as 'good',
    }]), /Invalid pure cue rating/);
  });
});

describe('pure cue persistence', { concurrency: false }, () => {
  let dataDir = '';
  let sqlite: DatabaseSync;
  let dbModule: typeof import('../server/db.ts');

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-pure-cues-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?pure-cues=${Date.now()}`);
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys=ON');
    for (const [id, hanzi, traditional] of [
      ['word-a', '撒谎', '撒謊'],
      ['word-b', '说谎', '說謊'],
      ['word-c', '骗人', '騙人'],
      ['word-d', '瞒骗', '瞞騙'],
    ]) {
      sqlite.prepare(`
        INSERT INTO lexical_words (
          id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
        ) VALUES (?, ?, ?, 'pinyin', 'meaning', '[]', '[]', 1, ?)
      `).run(id, hanzi, traditional, now);
    }
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('creates and extends learner-private cues without moving the scheduler clock', () => {
    const created = dbModule.createPureCueWithoutTransaction({
      id: 'pure-a',
      stimulus: ' to tell an untruth ',
      axisNote: ' ordinary speech ',
      acceptedWordIds: ['word-a', 'word-b'],
      createdAt: now,
    });
    assert.deepEqual(created, {
      id: 'pure-a', stimulus: 'to tell an untruth', axisNote: 'ordinary speech',
      acceptedWordIds: ['word-a', 'word-b'], intervalHours: 24, easeFactor: 2.5,
      lastStudiedAt: null, nextDueAt: now, strongSince: null, strongSuccesses: 0, active: true,
    });

    const extended = dbModule.extendPureCueAcceptedWordsWithoutTransaction({
      id: 'pure-a',
      acceptedWordIds: ['word-b', 'word-c'],
    });
    assert.deepEqual(extended.acceptedWordIds, ['word-a', 'word-b', 'word-c']);
    assert.equal(extended.nextDueAt, created.nextDueAt);
    assert.equal(extended.intervalHours, created.intervalHours);
    assert.throws(() => dbModule.extendPureCueAcceptedWordsWithoutTransaction({
      id: 'missing', acceptedWordIds: ['word-a'],
    }), /does not exist/);
    assert.throws(() => dbModule.createPureCueWithoutTransaction({
      id: 'bad', stimulus: 'bad', acceptedWordIds: ['word-a', 'missing'], createdAt: now,
    }), /Unknown or invisible/);
  });

  test('stores effective production proxy policy while preserving suppression', () => {
    assert.equal(dbModule.isWordProductionProxied('word-a'), false);
    assert.equal(dbModule.setWordProductionProxiedWithoutTransaction({
      wordId: 'word-a', proxied: true, updatedAt: now,
    }), 'applied');
    assert.equal(dbModule.isWordProductionProxied('word-a'), true);
    assert.equal(dbModule.setWordProductionProxiedWithoutTransaction({
      wordId: 'word-a', proxied: false, updatedAt: '2026-09-18T01:00:00.000Z',
    }), 'applied');
    sqlite.prepare(`
      UPDATE word_skill_relevance SET relevance_state = 'suppressed'
      WHERE word_id = 'word-a' AND skill_id = 'production'
    `).run();
    assert.equal(dbModule.setWordProductionProxiedWithoutTransaction({
      wordId: 'word-a', proxied: true, updatedAt: '2026-09-18T02:00:00.000Z',
    }), 'preserved_suppressed');
    assert.equal(sqlite.prepare(`
      SELECT relevance_state FROM word_skill_relevance
      WHERE word_id = 'word-a' AND skill_id = 'production'
    `).get()?.relevance_state, 'suppressed');
  });

  test('composes a standalone pure cue review item with a frozen server snapshot', () => {
    const payload = dbModule.getSessionPayload('2026-09-18');
    const item = payload.buckets.review.find((candidate) => candidate.itemType === 'pure_cue_production');
    assert.ok(item);
    assert.equal(item.itemType, 'pure_cue_production');
    assert.equal(item.snapshot.pureCueId, 'pure-a');
    assert.equal(item.snapshot.stimulus, 'to tell an untruth');
    assert.equal('word' in item, false);
    assert.deepEqual(item.snapshot.acceptedAnswers.map((answer) => answer.wordId), ['word-a', 'word-b', 'word-c']);
  });

  test('freezes server answer forms and consumes a snapshot once without word scheduling effects', () => {
    const snapshot = dbModule.issuePureCueServedSnapshot({
      snapshotId: 'snapshot-pure-a', pureCueId: 'pure-a', servedAt: now,
    });
    assert.deepEqual(snapshot.acceptedAnswers.map((answer) => answer.wordId), ['word-a', 'word-b', 'word-c']);
    dbModule.extendPureCueAcceptedWordsWithoutTransaction({
      id: 'pure-a', acceptedWordIds: ['word-d'],
    });
    assert.deepEqual(
      dbModule.getPureCueServedSnapshot(snapshot.snapshotId)?.acceptedAnswers.map((answer) => answer.wordId),
      ['word-a', 'word-b', 'word-c'],
    );
    sqlite.prepare(`UPDATE lexical_words SET hanzi = 'changed' WHERE id = 'word-a'`).run();
    assert.equal(dbModule.getPureCueServedSnapshot(snapshot.snapshotId)?.acceptedAnswers[0]?.hanzi, '撒谎');

    const input = {
      attemptId: 'pure-attempt-a',
      snapshotId: snapshot.snapshotId,
      sessionId: 'session-a',
      sessionActionId: 'session-a/pure-a',
      committedAt: '2026-09-18T01:00:00.000Z',
      events: [{
        eventId: 'pure-event-a',
        occurredAt: '2026-09-18T00:59:00.000Z',
        response: '说谎',
        outcome: 'accepted' as const,
        submittedWordId: 'word-b',
        rating: 'good' as const,
      }],
    };
    const first = dbModule.recordPureCueAssessment(input, () => 0.5);
    assert.equal(first.scheduledCue.intervalHours, 60);
    assert.equal(dbModule.recordPureCueAssessment(input, () => 0.5).scheduledCue.intervalHours, 60);
    assert.throws(() => dbModule.recordPureCueAssessment({
      ...input, attemptId: 'different-attempt',
    }), /already committed with different evidence/);
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM learner_owned_word_skill_state
      WHERE word_id IN ('word-a', 'word-b', 'word-c')
    `).get()?.count, 0);
  });

  test('scopes pure-cue reads by required learner context', () => {
    sqlite.prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('other', 'Other', ?)`).run(now);
    assert.equal(dbModule.runWithLearnerId('other', () => dbModule.getPureCue('pure-a')), null);
    assert.deepEqual(dbModule.runWithLearnerId('other', () => dbModule.getPureCues()), []);
    assert.throws(() => dbModule.runWithLearnerId('other', () => dbModule.recordPureCueAssessment({
      attemptId: 'cross-learner', snapshotId: 'snapshot-pure-a', sessionId: 'session-a',
      sessionActionId: 'session-a/pure-a', committedAt: now,
      events: [{ eventId: 'cross-event', occurredAt: now, response: '说谎',
        outcome: 'accepted', submittedWordId: 'word-b', rating: 'good' }],
    })), /snapshot .* unavailable/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pure_cue_attempts WHERE learner_id = 'other'").get()?.count, 0);
  });

  test('captures one pre-lapse scheduler snapshot for every event in a batch and restores it once', () => {
    sqlite.prepare(`
      INSERT INTO word_skill_state (
        word_id, skill_id, enabled, interval_hours, last_studied_at, next_due_at, ease_factor
      ) VALUES ('word-b', 'production', 1, 240, ?, '2026-09-28T00:00:00.000Z', 2.4)
    `).run(now);
    sqlite.prepare(`
      INSERT INTO word_study_admission_state (word_id, study_phase, earliest_next_study_at)
      VALUES ('word-b', 'review', '2026-09-18T06:00:00.000Z')
    `).run();
    dbModule.upsertStudySessionRecord({
      id: 'scheduler-session', startedAt: now, endedAt: null,
      processingState: 'open', processedAt: null,
    });
    const insertAttempt = sqlite.prepare(`
      INSERT INTO study_attempt_events (
        id, occurred_at, session_id, session_action_id, session_event_sequence,
        action_attempt_sequence, action_kind, target_word_id, sampled_skill_ids_json,
        response, outcome, rating, content_ref_json, metadata_json, projected_at
      ) VALUES (?, ?, 'scheduler-session', 'scheduler-action', ?, ?, 'production',
        'word-b', '["production"]', ?, ?, ?, NULL, '{}', NULL)
    `);
    insertAttempt.run('scheduler-event-1', now, 1, 1, 'wrong', 'incorrect', 'forgot');
    insertAttempt.run('scheduler-event-2', '2026-09-18T00:01:00.000Z', 2, 2, '说谎', 'correct', 'good');

    const captured = dbModule.captureProductionSchedulerSnapshotForAttemptBatchWithoutTransaction({
      sourceAttemptId: 'scheduler-event-2', capturedAt: '2026-09-18T00:02:00.000Z',
    });
    assert.deepEqual(captured.sourceAttemptIds, ['scheduler-event-1', 'scheduler-event-2']);
    assert.equal(captured.productionSkillState?.intervalHours, 240);
    assert.equal(captured.admissionState?.earliestNextStudyAt, '2026-09-18T06:00:00.000Z');
    assert.equal(captured.legacyReviewItemMirror, null);

    sqlite.prepare(`
      UPDATE word_skill_state SET interval_hours = 6, ease_factor = 2.25,
        last_studied_at = '2026-09-18T00:03:00.000Z', next_due_at = '2026-09-18T06:03:00.000Z'
      WHERE word_id = 'word-b' AND skill_id = 'production'
    `).run();
    sqlite.prepare(`
      UPDATE word_study_admission_state SET earliest_next_study_at = '2026-09-19T00:00:00.000Z'
      WHERE word_id = 'word-b'
    `).run();
    sqlite.prepare(`
      INSERT INTO reflection_operation_invocations (
        invocation_id, created_at, origin_kind, origin_proposal_id,
        origin_superseded_proposal_id, operation_kind, operation_version,
        operation_json, application_state, application_updated_at,
        unsupported_reason, applied_at, application_error, stale_reason,
        effect_refs_json, satisfying_effect_refs_json
      ) VALUES ('compensation-invocation', ?, 'manual', NULL, NULL, 'promote_pure_cue', 1,
        '{}', 'pending', ?, NULL, NULL, NULL, NULL, '[]', '[]')
    `).run(now, now);

    const restored = dbModule.restoreProductionSchedulerSnapshotWithoutTransaction({
      sourceAttemptId: 'scheduler-event-2',
      compensationInvocationId: 'compensation-invocation',
      restoredAt: '2026-09-18T02:00:00.000Z',
    });
    assert.equal(restored.kind, 'restored');
    const restoredSkill = sqlite.prepare(`
      SELECT interval_hours, ease_factor FROM word_skill_state
      WHERE word_id = 'word-b' AND skill_id = 'production'
    `).get() as { interval_hours: number; ease_factor: number };
    assert.equal(restoredSkill.interval_hours, 240);
    assert.equal(restoredSkill.ease_factor, 2.4);
    assert.equal(sqlite.prepare(`
      SELECT earliest_next_study_at FROM word_study_admission_state WHERE word_id = 'word-b'
    `).get()?.earliest_next_study_at, '2026-09-18T06:00:00.000Z');
    assert.equal(dbModule.restoreProductionSchedulerSnapshotWithoutTransaction({
      sourceAttemptId: 'scheduler-event-1',
      compensationInvocationId: 'different-invocation',
      restoredAt: '2026-09-18T03:00:00.000Z',
    }).kind, 'already_restored');
    assert.deepEqual(dbModule.restoreProductionSchedulerSnapshotWithoutTransaction({
      sourceAttemptId: 'historical-attempt',
      compensationInvocationId: 'compensation-invocation',
      restoredAt: '2026-09-18T03:00:00.000Z',
    }), { kind: 'unavailable', reason: 'pre_release_snapshot_unavailable' });
  });
});
