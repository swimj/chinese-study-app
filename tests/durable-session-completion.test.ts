import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { getDb, openDatabase, setDb, closeDbConnection } from '../server/db/connection.ts';
import { installLearnerContextSqlFunction, runWithLearnerId } from '../server/db/learner-context.ts';
import { bootstrapLearner, setLearnerDisabled } from '../server/db/identity.ts';
import { completeLearningWordSession, completeUnstudiedWordSession } from '../server/db/persistence.ts';
import { stageSessionCompletion, getCurrentSessionCompletion, getSessionCompletion, undoSessionCompletion,
  closeSessionCompletion, closeDueSessionCompletions } from '../server/db/session-completion.ts';
import { getSessionDebrief } from '../server/db/session-debrief.ts';
import { createSessionCompletionWorker } from '../server/session-completion/worker.ts';
import { getAttentionBadges } from '../server/db/attention.ts';
import { startReflectionGenerationRun, listReflectionGenerationRuns } from '../server/db/reflections.ts';
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
test('deadline and exact inventory survive DB reopen; provider disabled does not prevent closure', async () => {
  owner(() => stageSessionCompletion('restart', input('r1'), t0));
  closeDbConnection(); setDb(openDatabase(path.join(dir, 'app.db'))); installLearnerContextSqlFunction();
  const worker = createSessionCompletionWorker({ now: () => Date.parse(plus(15_000)),
    controls: () => ({ maintenanceMode: false, providerWorkEnabled: false }) });
  assert.equal(await worker.step(), true); await worker.stop();
  owner(() => { assert.equal(getSessionCompletion('restart', plus(16_000))?.status, 'closed');
    assert.equal(getSessionDebrief('restart')?.exerciseCount, 0); });
});
test('durable reflection dispatch persists across worker recreation and fences unknown outcomes against replay', async () => {
  owner(() => { const staged = input('r1'); staged.reflectionEvidence = { schemaVersion: 'session_reflection_evidence_supplement.v1', items: [] };
    stageSessionCompletion('reflection', staged, t0); closeSessionCompletion('reflection', 'r1', plus(1_000));
    assert.equal(getAttentionBadges().reflectionGenerating, true); });
  let calls = 0;
  const makeWorker = () => createSessionCompletionWorker({ now: () => Date.parse(plus(2_000)),
    controls: () => ({ maintenanceMode: false, providerWorkEnabled: true }), providerWork: async w => w(),
    reflectionService: { generate: async (id, evidence) => { calls++; assert.equal(id, 'reflection');
      assert.deepEqual(evidence, { schemaVersion: 'session_reflection_evidence_supplement.v1', items: [] });
      return { artifactId: 'result', proposalCount: 0, status: 'created' }; } } });
  const first = makeWorker(); assert.equal(await first.step(), true); await first.stop();
  const second = makeWorker(); assert.equal(await second.step(), false); await second.stop(); assert.equal(calls, 1);
  owner(() => assert.equal(getAttentionBadges().reflectionGenerating, false));
  owner(() => { const staged = input('r1'); staged.reflectionEvidence = { schemaVersion: 'session_reflection_evidence_supplement.v1', items: [] };
    stageSessionCompletion('interrupted', staged, t0); closeSessionCompletion('interrupted', 'r1', plus(1_000)); });
  owner(() => startReflectionGenerationRun({ runId: 'unknown-provider', sourceSessionId: 'interrupted',
    reflectionFlowVersion: 'pure_cue_post_session_reflection.v1', startedAt: plus(1_000), provider: 'openai', model: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna', promptVersion: 'pure-cue-reflection-v2.0', clientRequestId: 'unknown', eligibleItemCount: 0, includedItemCount: 0,
    evidenceBundle: { schemaVersion: 'pure_cue_reflection_bundle.v1', generatedAt: plus(1_000),
      session: { sessionId: 'interrupted', startedAt: t0, endedAt: t0, studyProfile: 'mandarin' }, items: [] } }));
  getDb().prepare(`UPDATE learner_session_reflection_dispatches SET status = 'running', active_token = 'unknown', expires_at = ?
    WHERE session_id = 'interrupted'`).run(plus(1_500));
  const recovered = makeWorker(); assert.equal(await recovered.step(), false); await recovered.stop(); assert.equal(calls, 1);
  assert.equal(getDb().prepare("SELECT status FROM learner_session_reflection_dispatches WHERE session_id = 'interrupted'").get()?.status, 'failed');
  owner(() => { const failed = listReflectionGenerationRuns().find(run => run.runId === 'unknown-provider')!;
    assert.equal(failed.state, 'failed'); assert.equal(failed.failureCode, 'interrupted'); assert.equal(failed.retryable, true); });
});
test('disabled queued learners cannot starve another learner; a crash before any provider start is safe to dispatch', async () => {
  const evidence = { schemaVersion: 'session_reflection_evidence_supplement.v1', items: [] };
  runWithLearnerId('b', () => { const staged = input('r1'); staged.reflectionEvidence = evidence;
    stageSessionCompletion('disabled', staged, t0); closeSessionCompletion('disabled', 'r1', plus(1_000)); });
  setLearnerDisabled('b', true);
  owner(() => { const staged = input('r1'); staged.reflectionEvidence = evidence;
    stageSessionCompletion('never-started', staged, t0); closeSessionCompletion('never-started', 'r1', plus(1_000)); });
  getDb().prepare(`UPDATE learner_session_reflection_dispatches SET status = 'running', active_token = 'pre-call', expires_at = ?
    WHERE session_id = 'never-started'`).run(plus(1_500));
  let calls = 0;
  const worker = createSessionCompletionWorker({ now: () => Date.parse(plus(2_000)),
    controls: () => ({ maintenanceMode: false, providerWorkEnabled: true }), providerWork: async w => w(),
    reflectionService: { generate: async id => { calls++; assert.equal(id, 'never-started');
      return { artifactId: 'started', proposalCount: 0, status: 'created' }; } } });
  assert.equal(await worker.step(), true); assert.equal(await worker.step(), false); await worker.stop();
  assert.equal(calls, 1); assert.equal(getDb().prepare("SELECT status FROM learner_session_reflection_dispatches WHERE session_id = 'disabled'").get()?.status, 'queued');
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
test('slow reflection never delays another durable completion deadline', async () => {
  owner(() => { const staged = input('r1'); staged.reflectionEvidence = { schemaVersion: 'session_reflection_evidence_supplement.v1', items: [] };
    stageSessionCompletion('slow-reflection', staged, t0); closeSessionCompletion('slow-reflection', 'r1', plus(1_000)); });
  let clock = Date.parse(plus(2_000)); let finishProvider!: () => void; let startedProvider!: () => void;
  const started = new Promise<void>(resolve => { startedProvider = resolve; });
  const provider = new Promise<void>(resolve => { finishProvider = resolve; });
  const worker = createSessionCompletionWorker({ now: () => clock, pollMs: 5,
    controls: () => ({ maintenanceMode: false, providerWorkEnabled: true }), providerWork: async w => w(),
    reflectionService: { generate: async () => { startedProvider(); await provider; return { artifactId: 'slow', proposalCount: 0, status: 'created' }; } } });
  worker.wake(); await started;
  owner(() => stageSessionCompletion('during-reflection', input('r1'), plus(2_000)));
  clock = Date.parse(plus(17_000));
  await new Promise(resolve => setTimeout(resolve, 30));
  owner(() => assert.equal(getDb().prepare('SELECT status FROM learner_session_completions WHERE session_id = ?').get('during-reflection')?.status, 'closed'));
  finishProvider(); await worker.stop();
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
test('completion route handlers acknowledge fixed deadlines, preserve ownership and expose validation/conflict statuses', async () => {
  const { createApp } = await import('../server/index.ts');
  const app = createApp({ frontendDistPath: null, resolveClerkProviderSubject: () => null });
  type RouteLayer = { route?: { path: string; methods: Record<string, boolean>;
    stack: Array<{ handle: (request: unknown, response: unknown) => unknown }> } };
  const layers = (app as unknown as { _router: { stack: RouteLayer[] } })._router.stack;
  const request = (pathname: string, method = 'GET', body?: unknown, learnerId = 'a') => runWithLearnerId(learnerId,
    () => new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      let status = 200;
      const response = { status: (next: number) => { status = next; return response; },
        json: (value: unknown) => { resolve({ status, json: value }); return response; } };
      for (const layer of layers) {
        const route = layer.route; if (!route?.methods[method.toLowerCase()]) continue;
        const actual = pathname.split('/'); const pattern = route.path.split('/');
        if (actual.length !== pattern.length || pattern.some((part, i) => !part.startsWith(':') && part !== actual[i])) continue;
        const params = Object.fromEntries(pattern.flatMap((part, i) => part.startsWith(':') ? [[part.slice(1), actual[i]!]] : []));
        try { Promise.resolve(route.stack[0]!.handle({ params, body }, response)).catch(reject); } catch (error) { reject(error); }
        return;
      }
      reject(new Error(`Missing route ${method} ${pathname}`));
    }));
  const route = '/api/study-sessions/http-session/completion';
  assert.equal((await request(route)).status, 404);
  assert.equal((await request(route, 'POST', { revisionId: 'bad' })).status, 400);
  const first = await request(route, 'POST', input('r1')); assert.equal(first.status, 200);
  const staged = first.json as { closeAt: string; revisionId: string };
  const retry = await request(route, 'POST', input('r1')); assert.equal(retry.status, 200);
  assert.equal((retry.json as { closeAt: string }).closeAt, staged.closeAt);
  assert.equal((await request(route, 'GET', undefined, 'b')).status, 404);
  assert.equal((await request(`${route}/undo`, 'POST', { revisionId: 'wrong' })).status, 404);
  assert.equal((await request(`${route}/undo`, 'POST', { revisionId: 'r1' })).status, 409);
  assert.equal((await request(route, 'POST', input('r2'))).status, 409);
  const current = await request('/api/session-completions/current');
  assert.equal((current.json as { completion: { revisionId: string } }).completion.revisionId, 'r1');
  assert.equal((await request(`${route}/close`, 'POST', { revisionId: 'r1' })).status, 200);
  assert.equal((await request(`${route}/close`, 'POST', { revisionId: 'r1' })).status, 200);
  assert.equal(((await request('/api/session-completions/current')).json as { completion: null }).completion, null);
});
