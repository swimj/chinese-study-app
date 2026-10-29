import { vocabularyTeachingSource } from '../vocabulary/teaching-source.ts';
import { randomUUID } from 'node:crypto';
import { schedulePureCueAssessment } from '../../src/domain/pure-cues.ts';
import { normalizeProductionAnswerForProfile } from '../../src/study-profile.ts';
import { isDeepStrictEqual } from 'node:util';
import { SESSION_COMPLETION_UNDO_MS } from '../../src/domain/session-completion.ts';
import { advanceVocabularySession, projectVocabularySession, isCleanSolidifySession, VOCABULARY_SESSION_POLICY, type VocabularySessionAction,
  type VocabularySessionInitialContext, type VocabularySessionProjection } from '../../src/domain/vocabulary-session.ts';
import type { VocabularyPersistedSession, VocabularySessionCompletion } from '../../src/domain/vocabulary-session-api.ts';
export type { VocabularyPersistedSession, VocabularySessionCompletion } from '../../src/domain/vocabulary-session-api.ts';
import { getDb } from './connection.ts';
import { nextReviewSchedule } from './review-policy.ts';
import { REVIEW_PHASE_RECENCY_GUARD_HOURS } from './types.ts';
import { requestWordReserveReconciliation } from './word-reserve.ts';
import { createVocabularyPracticePreparation } from '../vocabulary/preparation.ts';
import { enqueueVocabularyConnections } from '../vocabulary/connections.ts';
import { applyVocabularyContextualSelection } from './vocabulary-contextual-selection.ts';
import { applyVocabularyRecognition } from './vocabulary-recognition.ts';
import { requireLearnerId } from './learner-context.ts';
import { emitBackendEvent, getVocabularyContentVersion } from './vocabulary-content.ts';
import { getVocabularyLearnerWord, getVocabularyWordSchedule, type VocabularySchedulerState } from './vocabulary-learners.ts';

export class VocabularySessionInputError extends Error {}
export class VocabularySessionConflictError extends Error {}
export class VocabularySessionNotFoundError extends Error {}
type StoredContext = VocabularySessionInitialContext & { wordStateVersions: Record<string, number> };
type SessionRow = { session_id: string; learner_id: string; status: VocabularyPersistedSession['status']; context_json: string; started_at: string; closed_at: string | null };
type CompletionRow = { completion_id: string; session_id: string; learner_id: string; revision_number: number; through_sequence: number;
  staged_at: string; close_at: string; status: VocabularySessionCompletion['status']; report_json: string; input_json: string; closed_at: string | null; last_error: string | null };
let savepoints = 0;
function atomic<T>(work: () => T): T {
  const db = getDb(); const nested = db.isTransaction; const name = `vocabulary_session_${++savepoints}`;
  db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
  try { const result = work(); db.exec(nested ? `RELEASE ${name}` : 'COMMIT'); return result; }
  catch (error) { db.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK'); if (nested) db.exec(`RELEASE ${name}`); throw error; }
}
function timestamp(now: string): void {
  if (!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) throw new VocabularySessionInputError('Expected canonical UTC timestamp');
}
function sessionRow(sessionId: string): SessionRow {
  const value = getDb().prepare('SELECT * FROM vocabulary_sessions WHERE session_id = ? AND learner_id = ?').get(sessionId, requireLearnerId()) as SessionRow | undefined;
  if (!value) throw new VocabularySessionNotFoundError('Vocabulary session not found'); return value;
}
function completionRow(sessionId: string, completionId?: string): CompletionRow | undefined {
  return getDb().prepare(`SELECT * FROM vocabulary_session_completions WHERE session_id = ? AND learner_id = ?
    ${completionId ? 'AND completion_id = ?' : 'ORDER BY revision_number DESC LIMIT 1'}`)
    .get(...(completionId ? [sessionId, requireLearnerId(), completionId] : [sessionId, requireLearnerId()])) as CompletionRow | undefined;
}
function readActions(sessionId: string): VocabularySessionAction[] {
  return (getDb().prepare('SELECT action_json FROM session_actions WHERE session_id = ? AND learner_id = ? ORDER BY sequence_number')
    .all(sessionId, requireLearnerId()) as { action_json: string }[]).map((row) => JSON.parse(row.action_json) as VocabularySessionAction);
}
type SessionHead = Pick<SessionRow, 'learner_id' | 'status' | 'started_at'> & {
  sequence_number: number | null; action_id: string | null;
};
type SessionRuntime = { context: StoredContext; actions: VocabularySessionAction[]; projection: VocabularySessionProjection; head: SessionHead; completion?: VocabularySessionCompletion | null };
// Connection identity and learner ownership are both part of the cache boundary. The
// database remains authoritative: a head probe also catches another writer or an outer
// transaction rolling back a successful nested append, even at the same sequence number.
const runtimeCaches = new WeakMap<ReturnType<typeof getDb>, Map<string, SessionRuntime>>();
const MAX_CACHED_SESSIONS = 64;
function runtimeCache(): Map<string, SessionRuntime> {
  const db = getDb(); let cache = runtimeCaches.get(db);
  if (!cache) { cache = new Map(); runtimeCaches.set(db, cache); }
  return cache;
}
function runtimeKey(sessionId: string): string { return JSON.stringify([requireLearnerId(), sessionId]); }
function freezeRuntimeValue(value: unknown): void {
  if(value===null||typeof value!=='object'||Object.isFrozen(value))return;
  for(const child of Object.values(value))freezeRuntimeValue(child);
  Object.freeze(value);
}
function rememberRuntime(sessionId: string, runtime: SessionRuntime): void {
  // A caller must not turn a derived cache entry into another source of authority.
  freezeRuntimeValue(runtime.context);freezeRuntimeValue(runtime.actions);freezeRuntimeValue(runtime.projection);
  const cache = runtimeCache(); const key = runtimeKey(sessionId);
  cache.delete(key); cache.set(key, runtime);
  while (cache.size > MAX_CACHED_SESSIONS) cache.delete(cache.keys().next().value!);
}
function sessionHead(sessionId: string): SessionHead {
  const head = getDb().prepare(`SELECT s.learner_id, s.status, s.started_at, a.sequence_number, a.action_id
    FROM vocabulary_sessions s LEFT JOIN session_actions a ON a.session_id = s.session_id
      AND a.sequence_number = (SELECT sequence_number FROM session_actions WHERE session_id = s.session_id ORDER BY sequence_number DESC LIMIT 1)
    WHERE s.session_id = ? AND s.learner_id = ?`).get(sessionId, requireLearnerId()) as SessionHead | undefined;
  if (!head) { runtimeCache().delete(runtimeKey(sessionId)); throw new VocabularySessionNotFoundError('Vocabulary session not found'); }
  return head;
}
function sessionRuntime(sessionId: string): SessionRuntime {
  const head = sessionHead(sessionId); const cached = runtimeCache().get(runtimeKey(sessionId));
  if (cached && cached.head.started_at === head.started_at && cached.head.sequence_number === head.sequence_number && cached.head.action_id === head.action_id) {
    const runtime = { ...cached, head }; rememberRuntime(sessionId, runtime); return runtime;
  }
  const context = JSON.parse(sessionRow(sessionId).context_json) as StoredContext;
  const actions = readActions(sessionId);
  const runtime = { context, actions, projection: projectVocabularySession(context, actions), head };
  rememberRuntime(sessionId, runtime); return runtime;
}
function cachedSessionCompletion(sessionId: string, runtime: SessionRuntime, now: string): VocabularySessionCompletion | null {
  const head = getDb().prepare(`SELECT completion_id, status, closed_at, last_error FROM vocabulary_session_completions
    WHERE session_id = ? AND learner_id = ? ORDER BY revision_number DESC LIMIT 1`)
    .get(sessionId, requireLearnerId()) as Pick<CompletionRow, 'completion_id' | 'status' | 'closed_at' | 'last_error'> | undefined;
  if (!head) { runtime.completion = null; return null; }
  const previous = runtime.completion;
  // Closure recomputes the report; a rolled-back closure must also discard that
  // report. Other state changes retain the same staged report and immutable input.
  if (!previous || previous.completionId !== head.completion_id || (previous.status === 'closed') !== (head.status === 'closed')) {
    const row = completionRow(sessionId, head.completion_id);
    if (!row) throw new Error('Vocabulary completion disappeared during hydration');
    runtime.completion = completionDto(row, now);
    freezeRuntimeValue(runtime.completion.report); freezeRuntimeValue(runtime.completion.metadata);
  } else {
    runtime.completion = { ...previous, status: head.status, closedAt: head.closed_at, error: head.last_error,
      serverNow: now, canUndo: (head.status === 'pending' || head.status === 'failed') && now < previous.closeAt };
  }
  // Keep cached metadata separate from the returned, time-sensitive DTO.
  return { ...runtime.completion };
}
function sessionDto(sessionId: string, runtime: SessionRuntime, now: string): VocabularyPersistedSession {
  return { sessionId, status: runtime.head.status, context: runtime.context, actions: runtime.actions, projection: runtime.projection,
    completion: cachedSessionCompletion(sessionId, runtime, now) };
}
function completionDto(row: CompletionRow, now: string): VocabularySessionCompletion {
  const retained = JSON.parse(row.input_json) as {activeDurationMs?:number|null};
  const activeDurationMs = retained.activeDurationMs ?? null;
  return { completionId: row.completion_id, sessionId: row.session_id, revisionNumber: row.revision_number, throughSequence: row.through_sequence,
    stagedAt: row.staged_at, closeAt: row.close_at, status: row.status, closedAt: row.closed_at,
    report: JSON.parse(row.report_json) as VocabularySessionProjection, error: row.last_error, serverNow: now,
    canUndo: (row.status === 'pending' || row.status === 'failed') && now < row.close_at,
    metadata: {activeDurationMs,source:activeDurationMs===null?null:'client_visibility_and_focus'} };
}
export function getVocabularySessionCompletion(sessionId: string, now = new Date().toISOString()): VocabularySessionCompletion | null {
  sessionHead(sessionId); const row = completionRow(sessionId); return row ? completionDto(row, now) : null;
}
export function getVocabularySession(sessionId: string, now = new Date().toISOString()): VocabularyPersistedSession {
  return sessionDto(sessionId, sessionRuntime(sessionId), now);
}

/** Internal trusted creation: callers supply ready teaching requirements, never learner modes. */
export function createVocabularySession(context: VocabularySessionInitialContext, now = new Date().toISOString()): VocabularyPersistedSession {
  timestamp(now);
  return atomic(() => {
    const learnerId = requireLearnerId();
    const existing = getDb().prepare('SELECT learner_id FROM vocabulary_sessions WHERE session_id = ?').get(context.sessionId) as { learner_id: string } | undefined;
    if (existing) throw new VocabularySessionConflictError('Session identity already exists');
    if (getDb().prepare("SELECT 1 FROM vocabulary_session_completions WHERE learner_id = ? AND status IN ('pending','failed')").get(learnerId))
      throw new VocabularySessionConflictError('Finish saving the previous session before starting another');
    const wordStateVersions: Record<string, number> = {};
    const words = context.words.map((supplied) => {
      const actual = getVocabularyLearnerWord(supplied.wordId); const schedule = getVocabularyWordSchedule(supplied.wordId);
      if (!actual || !schedule) throw new VocabularySessionInputError('Session word is not enrolled for this learner');
      wordStateVersions[supplied.wordId] = actual.stateVersion;
      return { ...supplied, mode: actual.mode, automaticPromotionPaused: actual.automaticPromotionPaused, cleanCoveredSessions: schedule.schedulerState.cleanCoveredSessions ?? 0 };
    });
    const stored: StoredContext = { ...context, sessionId: context.sessionId, words, wordStateVersions };
    const projection = projectVocabularySession(stored, []);
    getDb().prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,status)
      VALUES (?,?,1,?,?,'active')`).run(context.sessionId, learnerId, JSON.stringify(stored), now);
    rememberRuntime(context.sessionId, { context: stored, actions: [], projection, head: { learner_id: learnerId, status: 'active', started_at: now, sequence_number: null, action_id: null } });
    emitBackendEvent({ name: 'vocabulary.session.started', learnerId, sessionId: context.sessionId, data: { wordIds: words.map((word) => word.wordId) } });
    return getVocabularySession(context.sessionId, now);
  });
}
function normalizeResponse(response: string | null): string { return normalizeProductionAnswerForProfile(response ?? '', 'mandarin'); }
/** Validate immutable content identity and the exact source body/assessment retained by the trusted serving adapter. */
function validatePresentation(action: Extract<VocabularySessionAction, { kind: 'presentation' }>, payload: VocabularySessionInitialContext['payload']): void {
  const snapshot = action.payload.snapshot;
  if(payload) {
    const retained=payload.snapshots[`${snapshot.contentId}/${snapshot.role}`];
    if(!retained||retained.contentVersion!==snapshot.contentVersion)throw new VocabularySessionInputError('Encounter is outside the frozen session repertoire');
  }
  const content = getVocabularyContentVersion(snapshot.contentId, snapshot.contentVersion);
  if (!content) throw new VocabularySessionInputError('Encounter content version is unavailable to this learner');
  if (!payload && getDb().prepare('SELECT 1 FROM learner_content_deactivations WHERE learner_id = ? AND content_id = ?').get(requireLearnerId(), snapshot.contentId))
    throw new VocabularySessionInputError('Encounter content is deactivated');
  if (!isDeepStrictEqual(snapshot.body.material, content.body)) throw new VocabularySessionInputError('Encounter source body does not match retained content version');
  if (content.kind === 'introduction') {
    if (!isDeepStrictEqual(snapshot.body.teachingSource, vocabularyTeachingSource(content.body))) throw new VocabularySessionInputError('Introduction recap does not match its pinned source');
    if (snapshot.kind !== 'introduction' || snapshot.assessment !== null) throw new VocabularySessionInputError('Introduction encounter kind mismatch');
  } else {
    const wordChoice = content.assessment !== null && typeof content.assessment === 'object' && !Array.isArray(content.assessment) && content.assessment.responseMode === 'word_choice';
    const expectedKind = content.skill === 'recognition' ? 'recognition' : content.skill === 'contextual_selection' || content.exerciseType === 'contrast' || wordChoice ? 'contrast' : 'production';
    if (snapshot.kind !== expectedKind) throw new VocabularySessionInputError('Exercise skill mismatch');
    if (content.exerciseRole !== (snapshot.role === 'general' ? 'general' : 'teaching')) throw new VocabularySessionInputError('Exercise serving role mismatch');
    if ((snapshot.schedulingScope === 'pure_cue') !== (content.exerciseType === 'pure_cue')) throw new VocabularySessionInputError('Exercise schedule scope mismatch');
    const answers = content.answers.flatMap((answer) => answer.acceptedForms);
    if (!snapshot.assessment || !isDeepStrictEqual(snapshot.assessment.criteria, content.assessment)
      || !isDeepStrictEqual(snapshot.assessment.acceptedAnswers, answers)) throw new VocabularySessionInputError('Encounter answer contract does not match retained content version');
  }
  if (action.payload.wordId && !content.words.some((word) => word.wordId === action.payload.wordId)) throw new VocabularySessionInputError('Encounter content is not associated with selected word');
}

/**
 * TRUSTED INTERNAL API. Never bind raw HTTP bodies here. Serving constructs snapshots from
 * authorized versions and response handlers derive outcomes. This validates both again at storage.
 * Identical client-ID retries are accepted; conflicting retries and gaps are rejected atomically.
 */
export function appendVocabularySessionActions(sessionId: string, incoming: readonly VocabularySessionAction[], now = new Date().toISOString()): VocabularyPersistedSession {
  timestamp(now);
  return atomic(() => {
    const runtime = sessionRuntime(sessionId); const row = runtime.head; const existing = runtime.actions; const all = [...existing];
    const fresh: VocabularySessionAction[] = [];
    for (const action of incoming) {
      const retry = all.find((entry) => entry.clientActionId === action.clientActionId);
      if (retry) {
        if (!isDeepStrictEqual(retry, action)) throw new VocabularySessionConflictError('Client action ID already has different input');
        continue;
      }
      if (row.status !== 'active') throw new VocabularySessionConflictError('Session does not accept actions while finalizing or closed');
      if (action.sequence !== all.length + 1) throw new VocabularySessionConflictError('Action sequence must match the next acknowledged boundary');
      if (action.kind === 'presentation') validatePresentation(action, runtime.context.payload);
      if (action.kind === 'response') {
        const presentation = all.find((entry): entry is Extract<VocabularySessionAction, { kind: 'presentation' }> => entry.kind === 'presentation' && entry.payload.encounterId === action.payload.encounterId);
        if (!presentation?.payload.snapshot.assessment) throw new VocabularySessionInputError('Response has no served assessment');
        const normalized = normalizeResponse(action.payload.response);
        const selfAssessment = action.payload.selfAssessment;
        if (selfAssessment !== undefined && presentation.payload.snapshot.kind !== 'recognition') throw new VocabularySessionInputError('Self assessment is only valid for recognition');
        let accepted = selfAssessment !== undefined ? selfAssessment === 'accepted'
          : normalized.length > 0 && presentation.payload.snapshot.assessment.acceptedAnswers.some((answer) => normalizeResponse(answer) === normalized);
        if (presentation.payload.snapshot.kind === 'contrast') {
          const criteria = presentation.payload.snapshot.assessment.criteria;
          const material = presentation.payload.snapshot.body.material;
          const choices = material !== null && typeof material === 'object' && !Array.isArray(material) ? material.choices : null;
          if (!action.payload.selectedWordId || !Array.isArray(choices) || !choices.some((choice) => choice !== null && typeof choice === 'object' && !Array.isArray(choice) && choice.wordId === action.payload.selectedWordId))
            throw new VocabularySessionInputError('Contrast response must select a served word identity');
          if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria) || typeof criteria.correctWordId !== 'string') throw new VocabularySessionInputError('Contrast assessment has no correct word identity');
          accepted = action.payload.selectedWordId === criteria.correctWordId;
        } else if (action.payload.selectedWordId !== undefined) throw new VocabularySessionInputError('Word choice is only valid for contrast');
        if (action.payload.outcome !== (accepted ? 'accepted' : 'rejected')) throw new VocabularySessionInputError('Response outcome does not match served answer contract');
      }
      all.push(action); fresh.push(action);
    }
    const context = runtime.context;
    const projection = fresh.length ? advanceVocabularySession(context, existing, runtime.projection, fresh) : runtime.projection;
    for (const action of fresh) {
      const encounterId = 'encounterId' in action.payload ? action.payload.encounterId : null;
      const wordId = 'wordId' in action.payload ? action.payload.wordId : null;
      getDb().prepare(`INSERT INTO session_actions(action_id,learner_id,session_id,sequence_number,client_action_id,kind,action_json,encounter_id,word_id,undoes_action_id,occurred_at,recorded_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(action.actionId, row.learner_id, sessionId, action.sequence, action.clientActionId, action.kind, JSON.stringify(action), encounterId, wordId,
          action.kind === 'undo' ? action.payload.undoesActionId : null, action.occurredAt, now);
      if (action.kind === 'presentation') {
        const encounter = projection.encounters.find((entry) => entry.encounterId === action.payload.encounterId)!;
        const snapshot = action.payload.snapshot;
        getDb().prepare(`INSERT INTO exercise_encounters(encounter_id,learner_id,session_id,presented_action_id,content_id,content_version,selected_through_word_id,context_json,served_snapshot_json,presented_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(encounter.encounterId, row.learner_id, sessionId, action.actionId, snapshot.contentId, snapshot.contentVersion,
            action.payload.wordId ?? snapshot.selectedThroughWordId ?? null, JSON.stringify({ mode: encounter.mode, workNumber: encounter.workNumber, role: snapshot.role,
              senseIds: snapshot.senseIds ?? [], mappingSnapshot: snapshot.mappingSnapshot ?? null }), JSON.stringify(snapshot), action.occurredAt);
        const content = getVocabularyContentVersion(snapshot.contentId, snapshot.contentVersion)!;
        for (const relationship of content.words) getDb().prepare('INSERT INTO encounter_words(learner_id,encounter_id,word_id,role) VALUES (?,?,?,?)')
          .run(row.learner_id, encounter.encounterId, relationship.wordId, relationship.relation);
        const selected = action.payload.wordId ?? snapshot.selectedThroughWordId;
        if (selected) getDb().prepare('INSERT INTO encounter_words(learner_id,encounter_id,word_id,role) VALUES (?,?,?,?)')
          .run(row.learner_id, encounter.encounterId, selected, 'selected_through');
      }
      // Protocol v1 and the existing table retain `feedback` as the spelling for learner reactions.
      if (action.kind === 'feedback') {
        const encounter = projection.encounters.find((entry) => entry.encounterId === action.payload.encounterId)!;
        getDb().prepare(`INSERT INTO learner_feedback(feedback_id,learner_id,session_id,source_action_id,encounter_id,content_id,content_version,word_id,kind,payload_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(action.actionId, row.learner_id, sessionId, action.actionId, encounter.encounterId, encounter.snapshot.contentId,
            encounter.snapshot.contentVersion, encounter.wordId, action.payload.feedback, JSON.stringify(action.payload), action.occurredAt);
      }
    }
    const last = all.at(-1);
    const updated = { ...runtime, context, actions: all, projection, head: { ...row, sequence_number: last?.sequence ?? null, action_id: last?.actionId ?? null } };
    rememberRuntime(sessionId, updated);
    return sessionDto(sessionId, updated, now);
  });
}

export function stageVocabularySessionCompletion(sessionId: string, throughSequence: number, now = new Date().toISOString(), options: {activeDurationMs?:number} = {}): VocabularySessionCompletion {
  timestamp(now);
  return atomic(() => {
    const row = sessionRow(sessionId); const previous = completionRow(sessionId);
    const activeDurationMs=options.activeDurationMs??null;
    if(activeDurationMs!==null&&(!Number.isSafeInteger(activeDurationMs)||activeDurationMs<0||activeDurationMs>Math.max(0,Date.parse(now)-Date.parse(row.started_at))+5000))
      throw new VocabularySessionInputError('Expected bounded integer activeDurationMs');
    if (previous && previous.status !== 'cancelled') {
      if (previous.through_sequence !== throughSequence) throw new VocabularySessionConflictError('Completion already freezes a different boundary');
      const priorInput=JSON.parse(previous.input_json) as {activeDurationMs?:number|null};
      if((priorInput.activeDurationMs??null)!==activeDurationMs)throw new VocabularySessionConflictError('Completion already has different active duration input');
      return completionDto(previous, now);
    }
    if (row.status !== 'active') throw new VocabularySessionConflictError('Session is not active');
    if (getDb().prepare("SELECT 1 FROM vocabulary_session_completions WHERE learner_id = ? AND status IN ('pending','failed')").get(row.learner_id))
      throw new VocabularySessionConflictError('Another completion is pending');
    const actions = readActions(sessionId);
    if (throughSequence !== actions.length) throw new VocabularySessionConflictError('Completion must freeze the exact acknowledged action boundary');
    const context = JSON.parse(row.context_json) as StoredContext;
    const report = projectVocabularySession(context, actions, { throughSequence });
    if (report.phase !== 'completed') throw new VocabularySessionConflictError('Finish session work before staging completion');
    const completionId = randomUUID(); const revision = (previous?.revision_number ?? 0) + 1;
    const closeAt = new Date(Date.parse(now) + SESSION_COMPLETION_UNDO_MS).toISOString();
    getDb().prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,through_sequence,staged_at,close_at,status,input_json,report_json,policy_version)
      VALUES (?,?,?,?,?,?,?,'pending',?,?,?)`).run(completionId, row.learner_id, sessionId, revision, throughSequence, now, closeAt,
        JSON.stringify({ context, actions, activeDurationMs }), JSON.stringify(report), VOCABULARY_SESSION_POLICY.version);
    getDb().prepare("UPDATE vocabulary_sessions SET status = 'finalizing' WHERE session_id = ?").run(sessionId);
    return completionDto(completionRow(sessionId, completionId)!, now);
  });
}
export function cancelVocabularySessionCompletion(sessionId: string, completionId: string, now = new Date().toISOString()): VocabularySessionCompletion {
  timestamp(now); sessionRow(sessionId);
  const previous = completionRow(sessionId, completionId);
  if (!previous) throw new VocabularySessionNotFoundError('Completion not found');
  if (previous.status === 'cancelled') return completionDto(previous, now);
  if (previous.status === 'closed' || now >= previous.close_at) {
    if (previous.status !== 'closed') closeVocabularySessionCompletion(sessionId, completionId, now);
    throw new VocabularySessionConflictError('Completion Undo window has closed');
  }
  return atomic(() => {
    getDb().prepare("UPDATE vocabulary_session_completions SET status = 'cancelled' WHERE completion_id = ?").run(completionId);
    getDb().prepare("UPDATE vocabulary_sessions SET status = 'active' WHERE session_id = ?").run(sessionId);
    return completionDto(completionRow(sessionId, completionId)!, now);
  });
}

function effect(completionId: string, sessionId: string, key: string, kind: string, before: unknown, after: unknown, now: string, wordId: string | null, pureCueId: string | null = null): void {
  getDb().prepare(`INSERT INTO learner_state_effects(effect_id,learner_id,word_id,pure_cue_content_id,completion_id,effect_key,kind,before_json,after_json,applied_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), requireLearnerId(), wordId, pureCueId, completionId, `${completionId}/${key}`, kind, JSON.stringify(before), JSON.stringify(after), now);
  emitBackendEvent({ name: `vocabulary.session.${kind}`, learnerId: requireLearnerId(), sessionId, entityKind: wordId ? 'word' : 'content',
    entityId: wordId ?? pureCueId ?? sessionId, data: { completionId, effectKey: `${completionId}/${key}` }, occurredAt: now });
}
function hoursAfter(now: string, hours: number): string { return new Date(Date.parse(now) + hours * 3_600_000).toISOString(); }
function nextUtcDay(now: string): string { return new Date(Date.parse(`${now.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(); }
function nextScheduler(before: VocabularySchedulerState, clean: boolean, rejectedCount: number, mode: string, cleanSolidify: boolean): VocabularySchedulerState {
  const scheduled = nextReviewSchedule(before, { failureCount: rejectedCount, successful: mode !== 'solidify' && clean });
  const intervalHours = mode === 'solidify' ? 24 : scheduled.intervalHours;
  const easeFactor = scheduled.easeFactor;
  return { ...before, intervalHours, easeFactor, cleanCoveredSessions: cleanSolidify ? (before.cleanCoveredSessions ?? 0) + 1 : 0 };
}
function applyReviewRecencyGuard(wordId: string, now: string): { before: { earliestNextStudyAt: string | null } | null; after: { earliestNextStudyAt: string } } {
  const learnerId = requireLearnerId();
  const before = getDb().prepare(`SELECT earliest_next_study_at AS earliestNextStudyAt
    FROM learner_owned_word_study_admission_state WHERE learner_id=? AND word_id=?`)
    .get(learnerId, wordId) as { earliestNextStudyAt: string | null } | undefined;
  const next = hoursAfter(now, REVIEW_PHASE_RECENCY_GUARD_HOURS);
  getDb().prepare(`INSERT INTO learner_owned_word_study_admission_state(learner_id,word_id,study_phase,earliest_next_study_at)
    VALUES (?,?,'review',?) ON CONFLICT(learner_id,word_id) DO UPDATE SET
      study_phase=excluded.study_phase,earliest_next_study_at=excluded.earliest_next_study_at`).run(learnerId, wordId, next);
  return { before: before ? { ...before } : null, after: { earliestNextStudyAt: next } };
}

function applyLearningEffects(completionId: string, context: StoredContext, projection: VocabularySessionProjection, now: string): void {
  const learnerId = requireLearnerId();
  for (const word of Object.values(projection.words)) {
    if (!word.admitted) continue;
    const current = getVocabularyLearnerWord(word.wordId); const schedule = getVocabularyWordSchedule(word.wordId);
    if (!current || !schedule) throw new Error('Enrolled session word lost its learner state');
    const externalModeChoice = current.stateVersion !== context.wordStateVersions[word.wordId];
    // A choice made outside this frozen session is newer authority, including a
    // same-mode choice that establishes a durable Solidify preference.
    const mode = externalModeChoice ? current.mode : word.explicitModeChoice ?? word.recommendedMode ?? word.mode;
    const automaticPromotionPaused = externalModeChoice ? current.automaticPromotionPaused
      : word.explicitModeChoice !== null ? word.explicitModeChoice === 'solidify'
      : word.teachingCompleted ? false : current.automaticPromotionPaused;
    if (mode !== current.mode || automaticPromotionPaused !== current.automaticPromotionPaused || (!externalModeChoice && word.explicitModeChoice !== null)) {
      getDb().prepare('UPDATE learner_words SET mode = ?,automatic_promotion_paused = ?,mode_changed_at = ?,state_version = state_version + 1 WHERE learner_id = ? AND word_id = ?')
        .run(mode, automaticPromotionPaused ? 1 : 0, mode === current.mode ? current.modeChangedAt : now, learnerId, word.wordId);
      effect(completionId, context.sessionId, `mode/${word.wordId}`, 'mode_applied', current, getVocabularyLearnerWord(word.wordId), now, word.wordId);
    }
    const encounters = projection.encounters.filter((entry) => entry.wordId === word.wordId);
    const production = encounters.filter((entry) => entry.snapshot.kind === 'production' && entry.snapshot.role === 'general').flatMap((entry) => entry.effectiveResponses);
    const initial = context.words.find((entry) => entry.wordId === word.wordId);
    const selectedSkill = initial?.selectedSkill ?? (initial?.contextualOnly ? 'contextual_selection' : initial?.recognitionOnly ? 'recognition' : undefined);
    const rejectedProductionCount = production.filter((response) => response.payload.outcome === 'rejected').length;
    const clean = production.length > 0 && rejectedProductionCount === 0;
    const lapse = rejectedProductionCount > 0;
    // Older retained sessions can contain several skills. Only actual general production
    // work updates review intervals; selecting another skill never supplies that evidence.
    const productionCompleted = word.covered && production.length > 0 && (selectedSkill === undefined || selectedSkill === 'production');
    // An early learner wrap can cover work without being evidence of successful recall.
    // Uncovered work preserves eligibility; its observations still enter post-session jobs.
    const solidifyCovered = word.covered && word.initialMode === 'solidify'
      && (selectedSkill === undefined || selectedSkill === 'production');
    if (productionCompleted || solidifyCovered || word.teachingCompleted) {
      const scheduler = nextScheduler(schedule.schedulerState, clean, rejectedProductionCount, mode, isCleanSolidifySession(word));
      const refresh = mode === 'maintain' && lapse;
      const next = mode === 'solidify' || word.teachingCompleted ? nextUtcDay(now)
        : refresh ? now : clean || lapse ? hoursAfter(now, scheduler.intervalHours) : schedule.nextEligibleAt;
      getDb().prepare(`UPDATE learner_word_schedules SET next_eligible_at = ?,last_practised_at = ?,policy_version = ?,scheduler_state_json = ?,
        state_version = state_version + 1,refresh_requested_at = ?,refresh_until = ? WHERE learner_id = ? AND word_id = ?`)
        .run(next, now, VOCABULARY_SESSION_POLICY.version, JSON.stringify(scheduler), refresh ? now : schedule.refreshRequestedAt,
          refresh ? hoursAfter(now, 72) : schedule.refreshUntil, learnerId, word.wordId);
      effect(completionId, context.sessionId, `production/${word.wordId}`, 'production_schedule_applied', schedule, getVocabularyWordSchedule(word.wordId), now, word.wordId);
    }
    const recognition = encounters.filter((entry) => entry.snapshot.kind === 'recognition').flatMap((entry) => entry.effectiveResponses);
    if (recognition.length && (word.covered || selectedSkill === undefined)) {
      const rejected = recognition.filter((response) => response.payload.outcome === 'rejected').length;
      const applied = applyVocabularyRecognition(word.wordId, rejected, now);
      effect(completionId, context.sessionId, `recognition/${word.wordId}`, 'recognition_outcome', applied.before,
        { schedule: applied.after, responseActionIds: recognition.map((response) => response.actionId),
          accepted: recognition.length - rejected, rejected }, now, word.wordId);
    }
    const contextual = encounters.filter((entry) => entry.snapshot.kind === 'contrast').flatMap((entry) => entry.effectiveResponses);
    if (contextual.length && (word.covered || selectedSkill === undefined)) {
      const rejected = contextual.filter((response) => response.payload.outcome === 'rejected').length;
      const applied = applyVocabularyContextualSelection(word.wordId, rejected, now);
      effect(completionId, context.sessionId, `contextual/${word.wordId}`, 'contextual_selection_outcome', applied.before,
        { schedule: applied.after, responseActionIds: contextual.map((response) => response.actionId), accepted: contextual.length - rejected, rejected }, now, word.wordId);
    }
    if (word.covered && (word.initialMode === 'practice' || word.initialMode === 'maintain')
      && encounters.some((entry) => entry.snapshot.role === 'general' && entry.effectiveResponses.length > 0)) {
      const guard = applyReviewRecencyGuard(word.wordId, now);
      effect(completionId, context.sessionId, `recency/${word.wordId}`, 'review_recency_guard_applied', guard.before, guard.after, now, word.wordId);
    }
    if (word.teachingCompleted) {
      getDb().prepare(`INSERT INTO teaching_completions(teaching_completion_id,learner_id,word_id,completion_id,source_kind,source_id,snapshot_json,completed_at)
        VALUES (?,?,?,?,'session',?,?,?)`).run(randomUUID(), learnerId, word.wordId, completionId, `${context.sessionId}/${word.wordId}`,
          JSON.stringify({ requirements: context.words.find((entry) => entry.wordId === word.wordId)?.teachingRequirements, encounters: encounters.filter((entry) => entry.snapshot.role === 'teaching') }), now);
      effect(completionId, context.sessionId, `teaching/${word.wordId}`, 'teaching_completed', null, { wordId: word.wordId }, now, word.wordId);
    }
  }
  for (const cue of projection.pureCueOutcomes) {
    if (!cue.covered) continue;
    const before = getDb().prepare('SELECT * FROM learner_pure_cue_schedules WHERE learner_id = ? AND content_id = ?').get(learnerId, cue.contentId) as { scheduler_state_json: string; last_practised_at: string | null; next_eligible_at: string | null } | undefined;
    const scheduler = before ? JSON.parse(before.scheduler_state_json) as VocabularySchedulerState : { intervalHours: 24, easeFactor: 2.5, enabled: 1, cleanCoveredSessions: 0 };
    const historical = scheduler as VocabularySchedulerState & {strongSince?:string|null;strongSuccesses?:number};
    const scheduled = schedulePureCueAssessment({id:cue.contentId,kind:'pure',stimulus:'',axisNote:'',teachingNote:'',acceptedWordIds:[],active:true,
      intervalHours:scheduler.intervalHours,easeFactor:scheduler.easeFactor,lastStudiedAt:before?.last_practised_at??null,nextDueAt:before?.next_eligible_at??now,
      strongSince:historical.strongSince??null,strongSuccesses:historical.strongSuccesses??0},
      {failureCount:cue.rejectedResponses,terminalRating:cue.rejectedResponses>0?null:'good'},now);
    const next = {...scheduler,intervalHours:scheduled.intervalHours,easeFactor:scheduled.easeFactor,
      strongSince:scheduled.strongSince,strongSuccesses:scheduled.strongSuccesses,cleanCoveredSessions:cue.rejectedResponses>0?0:(scheduler.cleanCoveredSessions??0)+1};
    getDb().prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json)
      VALUES (?,?,?,?,?,?) ON CONFLICT(learner_id,content_id) DO UPDATE SET next_eligible_at = excluded.next_eligible_at,last_practised_at = excluded.last_practised_at,
      policy_version = excluded.policy_version,scheduler_state_json = excluded.scheduler_state_json,state_version = state_version + 1`)
      .run(learnerId, cue.contentId, scheduled.nextDueAt, now, VOCABULARY_SESSION_POLICY.version, JSON.stringify(next));
    const after = getDb().prepare('SELECT * FROM learner_pure_cue_schedules WHERE learner_id = ? AND content_id = ?').get(learnerId, cue.contentId);
    effect(completionId, context.sessionId, `pure_cue/${cue.contentId}`, 'pure_cue_schedule_applied', before ?? null, after, now, null, cue.contentId);
  }
}
export function closeVocabularySessionCompletion(sessionId: string, completionId?: string, now = new Date().toISOString()): VocabularySessionCompletion {
  timestamp(now); sessionRow(sessionId); const previous = completionRow(sessionId, completionId);
  if (!previous) throw new VocabularySessionNotFoundError('Completion not found');
  if (previous.status === 'closed') return completionDto(previous, now);
  if (previous.status === 'cancelled') throw new VocabularySessionConflictError('Completion was cancelled');
  try {
    return atomic(() => {
      const fresh = completionRow(sessionId, previous.completion_id);
      if (!fresh) throw new VocabularySessionNotFoundError('Completion not found');
      if (fresh.status === 'closed') return completionDto(fresh, now);
      if (fresh.status === 'cancelled') throw new VocabularySessionConflictError('Completion was cancelled');
      const input = JSON.parse(previous.input_json) as { context: StoredContext; actions: VocabularySessionAction[] };
      const projection = projectVocabularySession(input.context, input.actions, { throughSequence: previous.through_sequence });
      applyLearningEffects(previous.completion_id, input.context, projection, now);
      getDb().prepare(`INSERT INTO vocabulary_post_session_dispatches(dispatch_id,learner_id,session_id,completion_id,evidence_json,status,created_at)
        VALUES (?,?,?,?,?,'queued',?)`).run(randomUUID(), requireLearnerId(), sessionId, previous.completion_id,
          JSON.stringify({ context: input.context, actions: input.actions, projection }), now);
      getDb().prepare("UPDATE vocabulary_sessions SET status = 'closed',closed_at = ? WHERE session_id = ?").run(now, sessionId);
      getDb().prepare("UPDATE vocabulary_session_completions SET status = 'closed',closed_at = ?,report_json = ?,last_error = NULL WHERE completion_id = ?")
        .run(now, JSON.stringify(projection), previous.completion_id);
      enqueueVocabularyConnections(sessionId, previous.completion_id, projection, now);
      requestWordReserveReconciliation(now);
      // General practice is future-session work. Admission or an in-flight teaching
      // observation is insufficient: queue only when teaching commits durably here.
      const taught = Object.values(projection.words).filter(word => word.teachingCompleted);
      if (taught.length) {
        const preparation = createVocabularyPracticePreparation({ now: () => now });
        for (const word of taught) preparation.ensure(word.wordId);
      }
      emitBackendEvent({ name: 'vocabulary.session.closed', learnerId: requireLearnerId(), sessionId,
        data: { completionId: previous.completion_id, throughSequence: previous.through_sequence, coveredWordIds: projection.coveredWordIds, uncoveredWordIds: projection.uncoveredWordIds }, occurredAt: now });
      return completionDto(completionRow(sessionId, previous.completion_id)!, now);
    });
  } catch (error) {
    getDb().prepare("UPDATE vocabulary_session_completions SET status = 'failed',last_error = ? WHERE completion_id = ? AND status IN ('pending','failed')")
      .run('Session could not be saved. Retry closing the session.', previous.completion_id);
    throw error;
  }
}
export function listDueVocabularySessionCompletions(now = new Date().toISOString()): { learnerId: string; sessionId: string; completionId: string }[] {
  timestamp(now);
  return (getDb().prepare(`SELECT learner_id AS learnerId,session_id AS sessionId,completion_id AS completionId
    FROM vocabulary_session_completions WHERE status = 'pending' AND close_at <= ? ORDER BY close_at,completion_id`).all(now) as { learnerId: string; sessionId: string; completionId: string }[]).map((row) => ({ ...row }));
}

/** Current learner's latest unfinished completion, retained independently of the HTTP projection. */
export function getCurrentVocabularyPendingCompletionSessionId(): string | null {
  const row=getDb().prepare(`SELECT session_id FROM vocabulary_session_completions
    WHERE learner_id=? AND status IN ('pending','failed') ORDER BY staged_at DESC,completion_id DESC LIMIT 1`)
    .get(requireLearnerId()) as {session_id:string}|undefined;
  return row?.session_id??null;
}
