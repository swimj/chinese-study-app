import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import type { StudyAttemptEvent } from '../src/domain/study-actions.ts';

describe('recovery highlights from durable learner evidence', { concurrency: false }, () => {
  let dataDir: string;
  let sqlite: DatabaseSync;
  let db: typeof import('../server/db.ts');
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-highlights-'));
    const oldMode = process.env.APP_MODE;
    const oldDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    db = await import('../server/db.ts');
    if (oldMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = oldMode;
    if (oldDir === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = oldDir;
    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON');
  });
  after(() => { sqlite.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  function history(word: string, skill: 'recognition' | 'production' = 'recognition') {
    sqlite.prepare(`INSERT INTO words
      (id, hanzi, traditional, pinyin, meaning, meanings_json, personal_notes, examples_json,
       status, priority, created_at, learning_streak, last_learning_success_on, last_learning_covered_on)
      VALUES (?, '殊不知', NULL, 'shu bu zhi', 'unexpectedly', '[]', '', '[]', 'review', 100, ?, 0, NULL, NULL)`)
      .run(word, '2026-10-01T00:00:00.000Z');
    const events: StudyAttemptEvent[] = [];
    for (let day = 1; day <= 6; day++) {
      const occurredAt = `2026-10-0${day}T10:00:00.000Z`;
      const event: StudyAttemptEvent = {
        id: `${word}-${day}`, sessionId: `${word}-session-${day}`, sessionActionId: `${word}-action-${day}`,
        occurredAt, sessionEventSequence: 1, actionAttemptSequence: 1,
        targetWordId: word, actionKind: skill, sampledSkillIds: [skill],
        outcome: day <= 3 ? 'incorrect' : 'correct', rating: day <= 3 ? 'forgot' : 'hard',
        response: skill === 'production' ? '殊不知' : null, contentRef: null,
        metadata: skill === 'production' ? { production: { result: day <= 3 ? 'rejected' : 'accepted_anchor',
          submittedWordId: day <= 3 ? null : word, anchorWordId: word, acceptedWordIds: [word] } } : {},
      };
      db.upsertStudySessionRecord({ id: event.sessionId, startedAt: occurredAt,
        endedAt: null, processingState: 'open', processedAt: null });
      db.insertStudyAttemptEvents([event]);
      sqlite.prepare('UPDATE study_attempt_events SET projected_at = ? WHERE id = ?').run(occurredAt, event.id);
      events.push(event);
    }
    // Earlier accepted actions need no finalized overall session.
    db.recordReviewSessionSummary({ sessionId: events[5].sessionId, completedAt: '2026-10-06T12:00:00.000Z',
      completedReviewActionCount: 1, failedReviewActionCount: 0, activeDurationMs: 1000 });
    return events;
  }

  test('derives repeatable evidence, accepts Hard, and requires learner-owned finalization', () => {
    const events = history('recognition');
    const result = db.getSessionRecoveryHighlights(events[5].sessionId)!;
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].troubleAttempts.map(x => x.attemptId), events.slice(0, 3).map(x => x.id));
    assert.deepEqual(result[0].successAttempts.map(x => x.attemptId), events.slice(3).map(x => x.id));
    assert.deepEqual(db.getSessionRecoveryHighlights(events[5].sessionId), result);
    assert.equal(db.getSessionRecoveryHighlights(events[0].sessionId), null);
    assert.equal(db.runWithLearnerId('other-learner', () => db.getSessionRecoveryHighlights(events[5].sessionId)), null);
  });

  test('same-session reinforcement never counts as a successful encounter', () => {
    const events = history('reinforcement');
    const last = events[5];
    sqlite.prepare("UPDATE study_attempt_events SET outcome = 'incorrect', rating = 'forgot' WHERE id = ?").run(last.id);
    db.insertStudyAttemptEvents([{ ...last, id: 'reinforcement-extra', actionAttemptSequence: 2,
      sessionEventSequence: 2 }]);
    sqlite.prepare('UPDATE study_attempt_events SET projected_at = ? WHERE id = ?').run(last.occurredAt, 'reinforcement-extra');
    assert.deepEqual(db.getSessionRecoveryHighlights(last.sessionId), []);
  });

  test('production requires exact target success evidence; unprojected evidence is not accepted', () => {
    const events = history('production', 'production');
    assert.equal(db.getSessionRecoveryHighlights(events[5].sessionId)?.length, 1);
    sqlite.prepare("UPDATE study_attempt_events SET metadata_json = '{}' WHERE id = ?").run(events[4].id);
    assert.deepEqual(db.getSessionRecoveryHighlights(events[5].sessionId), []);
    const other = history('unprojected');
    sqlite.prepare('UPDATE study_attempt_events SET projected_at = NULL WHERE id = ?').run(other[4].id);
    assert.deepEqual(db.getSessionRecoveryHighlights(other[5].sessionId), []);
  });

  test('applied unfair pair judgment excludes trouble even when restoration was unavailable', () => {
    const events = history('corrected', 'production');
    assert.equal(db.getSessionRecoveryHighlights(events[5].sessionId)?.length, 1);
    const operation = { kind: 'reconcile_production_cues', version: 1,
      sourceAttemptId: events[0].id, sourceAttemptFairness: 'misleading_or_overloaded_cue' };
    sqlite.prepare(`INSERT INTO reflection_operation_invocations
      (invocation_id, created_at, origin_kind, operation_kind, operation_version, operation_json,
       application_state, application_updated_at, applied_at, effect_refs_json)
      VALUES ('corrected-invocation', ?, 'manual', 'reconcile_production_cues', 1, ?, 'pending', ?, NULL, '[]')`)
      .run(events[5].occurredAt, JSON.stringify(operation), events[5].occurredAt);
    assert.equal(db.getSessionRecoveryHighlights(events[5].sessionId)?.length, 1, 'pending proposal is not a correction');
    sqlite.prepare(`UPDATE reflection_operation_invocations SET application_state = 'applied', applied_at = ?,
      effect_refs_json = '[{"type":"production_scheduler_compensation","id":"unavailable"}]'
      WHERE invocation_id = 'corrected-invocation'`).run(events[5].occurredAt);
    assert.deepEqual(db.getSessionRecoveryHighlights(events[5].sessionId), []);
  });
  test('scheduler restoration is scoped even when learners reuse session/action/attempt IDs', () => {
    const events = history('restoration', 'production');
    const source = events[0];
    sqlite.prepare("INSERT INTO learners (learner_id, display_name, created_at) VALUES ('other', 'Other', ?)").run(source.occurredAt);
    db.runWithLearnerId('other', () => {
      db.upsertStudySessionRecord({ id: source.sessionId, startedAt: source.occurredAt,
        endedAt: null, processingState: 'open', processedAt: null });
      db.insertStudyAttemptEvents([source]);
    });
    function restore(learner: string) {
      sqlite.prepare(`INSERT INTO pure_cue_scheduler_compensation_snapshots
        (learner_id, session_id, session_action_id, target_word_id, captured_at,
         production_skill_state_json, admission_state_json, compensated_by_invocation_id, compensated_at)
        VALUES (?, ?, ?, ?, ?, '{}', '{}', ?, ?)`)
        .run(learner, source.sessionId, source.sessionActionId, source.targetWordId,
          source.occurredAt, `${learner}-restore`, events[5].occurredAt);
      sqlite.prepare(`INSERT INTO pure_cue_scheduler_compensation_snapshot_attempts
        (learner_id, source_attempt_id, session_id, session_action_id) VALUES (?, ?, ?, ?)`)
        .run(learner, source.id, source.sessionId, source.sessionActionId);
    }
    restore('other');
    assert.equal(db.getSessionRecoveryHighlights(events[5].sessionId)?.length, 1);
    restore('test-learner');
    assert.deepEqual(db.getSessionRecoveryHighlights(events[5].sessionId), []);
  });

  test('active cue judgments exclude a miss, while retracted judgments do not', () => {
    const events = history('cue-judgment', 'production');
    const now = events[5].occurredAt;
    sqlite.prepare(`INSERT INTO reflection_operation_invocations
      (invocation_id, created_at, origin_kind, operation_kind, operation_version, operation_json,
       application_state, application_updated_at, applied_at, effect_refs_json)
      VALUES ('cue-judgment-op', ?, 'manual', 'repair_production_cue', 2, '{}', 'applied', ?, ?, '[{}]')`)
      .run(now, now, now);
    sqlite.prepare(`INSERT INTO production_cue_evidence_records
      (evidence_id, occurred_at, record_kind, task_id, source_attempt_id, judgment_kind, invocation_id)
      VALUES ('cue-judgment-evidence', ?, 'judgment', ?, ?, 'misleading_or_overloaded_cue', 'cue-judgment-op')`)
      .run(now, 'production-task:cue-judgment:default_production', events[0].id);
    assert.deepEqual(db.getSessionRecoveryHighlights(events[5].sessionId), []);
    db.appendProductionCueEvidenceCompensationWithoutTransaction({ occurredAt: now,
      sourceJudgmentEvidenceId: 'cue-judgment-evidence', reason: 'Retracted assessment' });
    assert.equal(db.getSessionRecoveryHighlights(events[5].sessionId)?.length, 1);
  });

  test('HTTP route distinguishes a completed empty summary from a missing summary', async () => {
    const { createApp } = await import('../server/index.ts');
    const server = createApp({ frontendDistPath: null }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const base = `http://127.0.0.1:${address.port}/api/study-sessions`;
      assert.equal((await fetch(`${base}/missing/recovery-highlights`)).status, 404);
      db.recordReviewSessionSummary({ sessionId: 'empty', completedAt: '2026-10-06T12:00:00.000Z',
        completedReviewActionCount: 0, failedReviewActionCount: 0, activeDurationMs: 0 });
      const response = await fetch(`${base}/empty/recovery-highlights`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { highlights: [] });
      const populated = await fetch(`${base}/recognition-session-6/recovery-highlights`);
      assert.equal(populated.status, 200);
      assert.equal((await populated.json()).highlights.length, 1);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

});
