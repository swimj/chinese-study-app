import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { getDb, openDatabase, setDb, closeDbConnection } from '../server/db/connection.ts';
import { installLearnerContextSqlFunction, runWithLearnerId } from '../server/db/learner-context.ts';
import { bootstrapLearner } from '../server/db/identity.ts';
import { completeLearningWordSession, completeUnstudiedWordSession } from '../server/db/persistence.ts';
import { stageSessionCompletion, getCurrentSessionCompletion, getSessionCompletion, undoSessionCompletion,
  closeSessionCompletion, closeDueSessionCompletions } from '../server/db/session-completion.ts';
import { getSessionDebrief } from '../server/db/session-debrief.ts';
import { getSessionWordReport } from '../server/db/session-word-outcomes.ts';
import type { StageSessionCompletionRequest } from '../src/domain/session-completion.ts';
let dir: string;
const owner = <T>(work: () => T) => runWithLearnerId('a', work);
const t0 = '2026-10-12T00:00:00.000Z';
const plus = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();
function input(revisionId: string, pendingCommit: StageSessionCompletionRequest['pendingCommit'] = null): StageSessionCompletionRequest {
  return { revisionId, startedAt: '2026-10-11T23:55:00.000Z', studyDayKey: '2026-10-12',
    summary: { completedAt: t0, completedReviewActionCount: 0, failedReviewActionCount: 0,
      activeDurationMs: 1000, completedLearningWordCount: 0, debriefInventory: [] }, pendingCommit, reflectionEvidence: null };
}
function word(id: string, status = 'unstudied', streak = 0) {
  owner(() => getDb().prepare(`INSERT INTO words (id,hanzi,pinyin,meaning,examples_json,status,priority,created_at,learning_streak)
    VALUES (?,?,'xué','learn','[]',?,0,?,?)`).run(id, id, status, t0, streak));
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-completion-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = dir;
  await import('../server/db.ts'); bootstrapLearner({ learnerId: 'a' }); bootstrapLearner({ learnerId: 'b' });
});
after(() => { closeDbConnection(); fs.rmSync(dir, { recursive: true, force: true }); });
test('fixed acknowledged deadline and revision retries; Undo cancels without accepting the final action', () => {
  word('undo-new');
  owner(() => {
    const staged = stageSessionCompletion('undo', input('r1', { type: 'commit-unstudied-word-session', wordId: 'undo-new' }), t0);
    assert.equal(staged.closeAt, plus(15_000)); assert.equal(staged.canUndo, true);
    assert.deepEqual(staged.report.newWords.map(w => w.id), ['undo-new']);
    assert.equal(getDb().prepare('SELECT status FROM words WHERE id = ?').get('undo-new')?.status, 'unstudied');
    assert.deepEqual(getSessionWordReport('undo'), { newWords: [], graduatedWords: [] });
    assert.equal(stageSessionCompletion('undo', input('r1', { type: 'commit-unstudied-word-session', wordId: 'undo-new' }), plus(10_000)).closeAt, plus(15_000));
    assert.throws(() => stageSessionCompletion('undo', { ...input('r1'), studyDayKey: '2026-10-11' }, plus(10_000)), /different input/);
    assert.equal(undoSessionCompletion('undo', 'r1', plus(14_999)).status, 'cancelled');
    assert.equal(undoSessionCompletion('undo', 'r1', plus(16_000)).status, 'cancelled');
    assert.equal(closeDueSessionCompletions(plus(20_000)), 0);
    assert.equal(getCurrentSessionCompletion(plus(20_000)), null);
    assert.throws(() => closeSessionCompletion('undo', 'r1', plus(20_000)), /cancelled/);
  });
});
test('deadline wins Undo race and applies final commit, summary and jobs exactly once', () => {
  word('deadline-new');
  owner(() => {
    stageSessionCompletion('deadline', input('r1', { type: 'commit-unstudied-word-session', wordId: 'deadline-new' }), t0);
    assert.throws(() => undoSessionCompletion('deadline', 'r1', plus(15_000)), /Undo window has closed/);
    const closed = getSessionCompletion('deadline', plus(15_001))!;
    assert.equal(closed.status, 'closed'); assert.equal(closed.canUndo, false);
    assert.deepEqual(closed.report.newWords.map(w => w.id), ['deadline-new']);
    assert.equal(getDb().prepare('SELECT completed_at FROM review_session_summaries WHERE session_id = ?').get('deadline')?.completed_at, t0);
    assert.equal(getDb().prepare('SELECT ended_at FROM study_sessions WHERE id = ?').get('deadline')?.ended_at, t0);
    assert.equal(getSessionDebrief('deadline')?.status, 'ready');
    assert.equal(closeSessionCompletion('deadline', 'r1', plus(20_000)).status, 'closed');
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM learner_session_word_outcomes WHERE session_id = ?').get('deadline')?.n, 1);
    assert.throws(() => stageSessionCompletion('deadline', input('r2'), plus(20_000)), /already closed/);
  });
});
test('earlier actual introduction and graduation outcomes are attributed once; preview final graduation stays provisional', () => {
  word('earlier-new'); word('earlier-grad', 'learning', 2); word('final-grad', 'learning', 2); word('not-grad', 'learning', 0);
  owner(() => {
    completeUnstudiedWordSession('earlier-new', '2026-10-12', 'report');
    completeUnstudiedWordSession('earlier-new', '2026-10-12', 'report');
    completeLearningWordSession('earlier-grad', true, 'report'); completeLearningWordSession('earlier-grad', true, 'report');
    completeLearningWordSession('not-grad', true, 'report');
    const staged = stageSessionCompletion('report', input('r1', { type: 'commit-learning-word-session', wordId: 'final-grad', success: true }), t0);
    assert.deepEqual(staged.report.newWords.map(w => w.id), ['earlier-new']);
    assert.deepEqual(new Set(staged.report.graduatedWords.map(w => w.id)), new Set(['earlier-grad','final-grad']));
    assert.equal(getDb().prepare('SELECT status FROM words WHERE id = ?').get('final-grad')?.status, 'learning');
    closeSessionCompletion('report', 'r1', plus(1_000));
    assert.equal(getDb().prepare('SELECT status FROM words WHERE id = ?').get('final-grad')?.status, 'review');
    assert.equal(getDb().prepare('SELECT learning_streak FROM words WHERE id = ?').get('earlier-grad')?.learning_streak, 3);
    assert.equal(runWithLearnerId('b', () => getSessionCompletion('report', plus(2_000))), null);
  });
});
test('an enqueue failure rolls back final scheduling and summary; explicit close retry resumes exact stored intent', () => {
  word('failure-new');
  owner(() => {
    stageSessionCompletion('failure', input('r1', { type: 'commit-unstudied-word-session', wordId: 'failure-new' }), t0);
    getDb().exec(`CREATE TEMP TRIGGER fail_completion_job BEFORE INSERT ON learner_session_debrief_jobs
      WHEN NEW.session_id = 'failure' BEGIN SELECT RAISE(ABORT, 'test enqueue failure'); END`);
    assert.throws(() => closeSessionCompletion('failure', 'r1', plus(15_000)), /test enqueue failure/);
    assert.equal(getSessionCompletion('failure', plus(16_000))?.status, 'failed');
    assert.equal(getDb().prepare('SELECT status FROM words WHERE id = ?').get('failure-new')?.status, 'unstudied');
    assert.equal(getDb().prepare('SELECT 1 FROM review_session_summaries WHERE session_id = ?').get('failure'), undefined);
    getDb().exec('DROP TRIGGER fail_completion_job');
    assert.equal(closeSessionCompletion('failure', 'r1', plus(17_000)).status, 'closed');
  });
});
test('deadline and exact inventory survive DB reopen', () => {
  owner(() => stageSessionCompletion('restart', input('r1'), t0));
  closeDbConnection(); setDb(openDatabase(path.join(dir, 'app.db'))); installLearnerContextSqlFunction();
  assert.equal(closeDueSessionCompletions(plus(15_000)), 1);
  owner(() => { assert.equal(getSessionCompletion('restart', plus(16_000))?.status, 'closed');
    assert.equal(getSessionDebrief('restart')?.exerciseCount, 0); });
});
test('staged learning day stays fixed across midnight; supplied extra summary identity cannot redirect completion', () => {
  word('midnight-grad', 'learning', 2);
  owner(() => {
    const staged = input('r1', { type: 'commit-learning-word-session', wordId: 'midnight-grad', success: true });
    staged.summary.completedAt = '2026-10-12T23:59:59.000Z';
    Object.assign(staged.summary, { sessionId: 'injected-session' });
    stageSessionCompletion('midnight', staged, '2026-10-12T23:59:59.000Z');
    closeSessionCompletion('midnight', 'r1', '2026-10-13T00:00:14.000Z');
    assert.equal(getDb().prepare('SELECT last_learning_success_on FROM words WHERE id = ?').get('midnight-grad')?.last_learning_success_on, '2026-10-12');
    assert.equal(getDb().prepare('SELECT 1 FROM review_session_summaries WHERE session_id = ?').get('injected-session'), undefined);
    assert.equal(getSessionDebrief('midnight')?.sessionId, 'midnight');
  });
});
test('malformed deferred learning flags and missing word references reject staging without a durable deadline', () => {
  owner(() => {
    assert.throws(() => stageSessionCompletion('bad-success', input('r1',
      { type: 'commit-learning-word-session', wordId: 'midnight-grad', success: 'yes' } as unknown as StageSessionCompletionRequest['pendingCommit']), t0), /Expected boolean/);
    assert.throws(() => stageSessionCompletion('bad-word', input('r1', { type: 'commit-unstudied-word-session', wordId: 'missing' }), t0), /Word not found/);
    assert.equal(getSessionCompletion('bad-success', plus(2_000)), null);
    assert.equal(getSessionCompletion('bad-word', plus(2_000)), null);
  });
});
test('closed reports reject new attributed outcomes while exact accepted-unit retries remain idempotent', () => {
  word('report-late'); word('report-accepted');
  owner(() => {
    completeUnstudiedWordSession('report-accepted', '2026-10-12', 'locked-report');
    stageSessionCompletion('locked-report', input('r1'), t0);
    assert.throws(() => completeUnstudiedWordSession('report-late', '2026-10-12', 'locked-report'), /Session is closing/);
    assert.throws(() => undoSessionCompletion('locked-report', 'r1', plus(1_000)), /No undoable final action/);
    closeSessionCompletion('locked-report', 'r1', plus(2_000));
    assert.throws(() => completeUnstudiedWordSession('report-late', '2026-10-12', 'locked-report'), /already closed/);
    assert.equal(completeUnstudiedWordSession('report-accepted', '2026-10-12', 'locked-report').status, 'learning');
    assert.deepEqual(getSessionCompletion('locked-report', plus(3_000))?.report.newWords.map(w => w.id), ['report-accepted']);
  });
});
