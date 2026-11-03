import { createHash } from 'node:crypto';
import { getDb } from '../../server/db/connection.ts';
import { requireLearnerId } from '../../server/db/learner-context.ts';
import { getVocabularySession, stageVocabularySessionCompletion, closeVocabularySessionCompletion } from '../../server/db/vocabulary-sessions.ts';
import { SESSION_COMPLETION_UNDO_MS } from '../../src/domain/session-completion.ts';

import { projectVocabularySession } from '../../src/domain/vocabulary-session.ts';

// Deliberately conservative: this is incident recovery, not a general late-save API.
const stateTables = ['learners', 'learner_settings', 'learner_session_debrief_jobs', 'learner_words', 'learner_word_schedules', 'learner_pure_cue_schedules',
  'learner_owned_word_skill_state', 'learner_owned_word_study_admission_state',
  'learner_state_effects', 'vocabulary_sessions', 'session_actions', 'vocabulary_session_completions',
  'vocabulary_post_session_dispatches'] as const;
function refuse(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function previewEnoughRecovery(sessionId: string, now = new Date().toISOString()) {
  const db = getDb(), learnerId = requireLearnerId();
  const learner = db.prepare('SELECT disabled_at FROM learners WHERE learner_id=?').get(learnerId);
  refuse(learner && learner.disabled_at === null, 'Recovery requires an enabled learner.');
  const session = getVocabularySession(sessionId);
  const row = db.prepare('SELECT started_at,context_json FROM vocabulary_sessions WHERE session_id=? AND learner_id=?')
    .get(sessionId, learnerId) as {started_at: string; context_json: string};
  refuse(session.status === 'active' && !session.completion, 'Expected an active session with no completion revision; inspect existing completion instead.');
  const last = session.actions.at(-1);
  refuse(last?.kind === 'word_wrap' && last.payload.reason === 'enough', 'Final action must be Enough for today.');
  refuse(session.projection.phase === 'completed' && projectVocabularySession(session.context, session.actions.slice(0, -1)).phase === 'finishing',
    'Expected Enough for today to complete a finishing session.');
  const stagedAt = last.occurredAt;
  const closedAt = new Date(Date.parse(stagedAt) + SESSION_COMPLETION_UNDO_MS).toISOString();
  refuse(stagedAt >= row.started_at && closedAt <= now, 'Historical completion time is outside the valid recovery window.');
  refuse(!db.prepare("SELECT 1 FROM vocabulary_session_completions WHERE learner_id=? AND status IN ('pending','failed')").get(learnerId), 'Another completion is pending.');
  refuse(!db.prepare('SELECT 1 FROM vocabulary_sessions WHERE learner_id=? AND session_id<>? AND (started_at>=? OR closed_at>=?)')
    .get(learnerId, sessionId, row.started_at, row.started_at), 'Subsequent or overlapping study requires separate reconciliation.');
  refuse(!db.prepare('SELECT 1 FROM session_actions WHERE learner_id=? AND session_id<>? AND (occurred_at>=? OR recorded_at>=?)')
    .get(learnerId, sessionId, row.started_at, row.started_at), 'Subsequent actions require separate reconciliation.');
  refuse(!db.prepare('SELECT 1 FROM learner_state_effects WHERE learner_id=? AND applied_at>=?').get(learnerId, row.started_at), 'Later learning effects require separate reconciliation.');
  const context = JSON.parse(row.context_json) as {wordStateVersions: Record<string, number>};
  for (const word of Object.values(session.projection.words)) {
    const current = db.prepare('SELECT state_version FROM learner_words WHERE learner_id=? AND word_id=?').get(learnerId, word.wordId);
    refuse(current?.state_version === context.wordStateVersions[word.wordId], 'Learner word state changed since this session.');
  }
  for (const [table, column] of [['learner_word_schedules','last_practised_at'], ['learner_word_schedules','refresh_requested_at'],
    ['learner_pure_cue_schedules','last_practised_at'], ['learner_owned_word_skill_state','last_studied_at']] as const) {
    refuse(!db.prepare(`SELECT 1 FROM ${table} WHERE learner_id=? AND ${column}>=?`).get(learnerId, row.started_at), 'Scheduling changed since this session.');
  }
  refuse(!db.prepare('SELECT 1 FROM vocabulary_post_session_dispatches WHERE session_id=?').get(sessionId), 'Session already has downstream work.');
  const state = stateTables.map(table => [table, db.prepare(`SELECT * FROM ${table} WHERE learner_id=?`).all(learnerId)
    .map(value => JSON.stringify(value)).sort()]);
  const plan = { recovery: 'enough-session-v1', learnerId, sessionId, throughSequence: session.actions.length,
    stagedAt, closedAt, activeDurationMs: null, coveredWordIds: session.projection.coveredWordIds,
    uncoveredWordIds: session.projection.uncoveredWordIds };
  const digest = createHash('sha256').update(JSON.stringify({plan, state})).digest('hex');
  return {...plan, digest};
}

export function applyEnoughRecovery(sessionId: string, digest: string, now = new Date().toISOString()) {
  const db = getDb();
  refuse(!db.isTransaction, 'Recovery must own its outer transaction.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const plan = previewEnoughRecovery(sessionId, now);
    refuse(plan.digest === digest, 'Recovery plan changed; preview and review again.');
    const staged = stageVocabularySessionCompletion(sessionId, plan.throughSequence, plan.stagedAt);
    const closed = closeVocabularySessionCompletion(sessionId, staged.completionId, plan.closedAt);
    const effects = db.prepare('SELECT kind,count(*) AS count FROM learner_state_effects WHERE completion_id=? GROUP BY kind ORDER BY kind').all(closed.completionId);
    const dispatch = db.prepare('SELECT dispatch_id,status FROM vocabulary_post_session_dispatches WHERE completion_id=?').get(closed.completionId);
    refuse(closed.status === 'closed' && dispatch, 'Recovery did not produce a closed completion and dispatch.');
    db.exec('COMMIT');
    return { ...plan, recoveredAt: now, completionId: closed.completionId, status: closed.status, effects, dispatch };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
