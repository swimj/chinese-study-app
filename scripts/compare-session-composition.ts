import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { StatementSync } from 'node:sqlite';
import { configureHostedDatabase, readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';

/**
 * Rehearsal alignment and cost check for the session-composition stack. It never
 * prints learner content: only counts, timings and mismatch counts.
 *
 * --phase=before (pre-0077 schema): record each learner's full-scan due review
 *   objectives and pure-cue plans at --now into --output.
 * --phase=after (post-0077 schema): recompute the full-scan reference and the
 *   indexed reads at the same --now, compare all three, then time a timed Start
 *   and its closure inside a rolled-back transaction.
 */
const args = readStrictArguments(['data-dir', 'phase', 'now', 'output', 'learner']);
configureHostedDatabase(args);
const phase = requireArgument(args, 'phase');
if (phase !== 'before' && phase !== 'after') throw new Error('--phase must be before or after.');
const now = requireArgument(args, 'now');
if (new Date(now).toISOString() !== now) throw new Error('--now must be a canonical UTC timestamp.');
const output = requireArgument(args, 'output');
if (!path.isAbsolute(output)) throw new Error('--output must be an absolute path.');

const connection = await import('../server/db/connection.ts');
const { installLearnerContextSqlFunction, runWithLearnerId } = await import('../server/db/learner-context.ts');
const reference = await import('./lib/session-composition-reference.ts');
connection.initDbConnection(); installLearnerContextSqlFunction();
const db = connection.getDb();

/** Count statement executions and their time while `work` runs. */
function measure<T>(work: () => T): { result: T; ms: number; prepared: number; executed: number } {
  let prepared = 0; let executed = 0; const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    prepared++; const statement = prepare(sql);
    return new Proxy(statement, { get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...values: unknown[]) => { if (property === 'run' || property === 'get' || property === 'all') executed++;
        return (value as (...input: unknown[]) => unknown).apply(target, values); };
    } }) as StatementSync;
  }) as typeof db.prepare;
  const started = performance.now();
  try { return { result: work(), ms: Math.round((performance.now() - started) * 10) / 10, prepared, executed }; }
  finally { db.prepare = prepare; }
}
const learners = (args.get('learner') ? [args.get('learner')!] : (db.prepare('SELECT learner_id FROM learners WHERE disabled_at IS NULL ORDER BY learner_id').all() as { learner_id: string }[])
  .map((row) => row.learner_id));
const cuePlans = [[0, 'alignment-0'], [40, 'alignment-40'], [300, 'alignment-300']] as const;
type Snapshot = { review: { wordId: string; skillId: string; urgency: number; nextDueAt: string | null }[];
  cues: Record<string, { rechecks: string[]; routine: string[] }> };
function snapshot(): Snapshot {
  return { review: reference.referenceDueReviewObjectives(now).map(({ wordId, skillId, urgency, nextDueAt }) => ({ wordId, skillId, urgency, nextDueAt })),
    cues: Object.fromEntries(cuePlans.map(([count, seed]) => [seed, reference.referencePureCuePlan({ ordinaryReviewCount: count, sessionSeed: seed, now })])) };
}
/**
 * Each schedule row's merged scheduling state, normalized so absent defaults compare
 * equal (enabled 1, no strong successes, null facts omitted), as a digest per row.
 */
const { mergePureCueSchedulerState, mergeWordSchedulerState } = await import('../server/db/vocabulary-schedule-columns.ts');
const { createHash } = await import('node:crypto');
function stateDigests(): Record<string, string> {
  const digest = (state: Record<string, unknown>, row: Record<string, unknown>) => {
    const normalized: Record<string, unknown> = { enabled: 1, ...state };
    if (normalized.strongSuccesses === 0) delete normalized.strongSuccesses;
    for (const key of Object.keys(normalized)) if (normalized[key] === null || normalized[key] === undefined) delete normalized[key];
    const facts = [row.next_eligible_at, row.last_practised_at, row.refresh_requested_at ?? null, row.refresh_until ?? null, row.policy_version, row.state_version];
    return createHash('sha256').update(JSON.stringify([Object.keys(normalized).sort().map((key) => [key, normalized[key]]), facts])).digest('hex').slice(0, 16);
  };
  const digests: Record<string, string> = {};
  for (const row of db.prepare('SELECT * FROM learner_word_schedules').iterate() as Iterable<Record<string, unknown>>)
    digests[`w/${row.learner_id}/${row.word_id}`] = digest(mergeWordSchedulerState(row), row);
  for (const row of db.prepare('SELECT * FROM learner_pure_cue_schedules').iterate() as Iterable<Record<string, unknown>>)
    digests[`c/${row.learner_id}/${row.content_id}`] = digest(mergePureCueSchedulerState(row), row);
  return digests;
}
const differences = (left: unknown[], right: unknown[]) => {
  let differing = Math.abs(left.length - right.length);
  for (let index = 0; index < Math.min(left.length, right.length); index++) if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) differing++;
  return differing;
};

if (phase === 'before') {
  const recorded: Record<string, Snapshot & { referenceMs: number; referenceStatements: number }> = {};
  for (const learner of learners) runWithLearnerId(learner, () => {
    const measured = measure(() => reference.referenceDueReviewObjectives(now));
    recorded[learner] = { ...snapshot(), referenceMs: measured.ms, referenceStatements: measured.executed };
  });
  const states = stateDigests();
  fs.writeFileSync(output, JSON.stringify({ now, recorded, states }), { mode: 0o600 });
  console.log(JSON.stringify({ phase, now, scheduleRows: Object.keys(states).length, learners: Object.entries(recorded).map(([, value]) => ({ dueObjectives: value.review.length,
    referenceMs: value.referenceMs, referenceStatements: value.referenceStatements })) }, null, 2));
} else {
  const before = JSON.parse(fs.readFileSync(output, 'utf8')) as { now: string; recorded: Record<string, Snapshot>; states: Record<string, string> };
  if (before.now !== now) throw new Error('--now must match the before phase.');
  // Every surviving schedule row keeps its merged scheduling state across the migration.
  // A pending pruning migration (0076) may remove word schedules; nothing may appear or change.
  const states = stateDigests(); const keys = new Set([...Object.keys(states), ...Object.keys(before.states)]);
  const removed = [...keys].filter((key) => !(key in states));
  const stateMismatches = [...keys].filter((key) => key in states && states[key] !== before.states[key]).length
    + [...keys].filter((key) => !(key in before.states)).length + removed.filter((key) => !key.startsWith('w/')).length;
  const { readVocabularyDueReviewObjectives } = await import('../server/vocabulary/review-selection.ts');
  const { planVocabularyPureCues } = await import('../server/vocabulary/pure-cue-serving.ts');
  const { startVocabularyStudy, nextVocabularyExercise, commandVocabularyStudy } = await import('../server/vocabulary/study.ts');
  const { stageVocabularySessionCompletion, closeVocabularySessionCompletion } = await import('../server/db/vocabulary-sessions.ts');
  const { setHostedServiceControl, readHostedServiceControl } = await import('../server/db/hosted-operations.ts');
  const report: unknown[] = []; let mismatches = stateMismatches;
  for (const learner of learners) runWithLearnerId(learner, () => {
    const prior = before.recorded[learner];
    const after = snapshot();
    const oldRead = measure(() => reference.referenceDueReviewObjectives(now));
    const indexed = measure(() => readVocabularyDueReviewObjectives(now).map(({ wordId, skillId, urgency, nextDueAt }) => ({ wordId, skillId, urgency, nextDueAt })));
    const cueDifferences = cuePlans.map(([count, seed]) => {
      const plan = planVocabularyPureCues({ ordinaryReviewCount: count, sessionSeed: seed, now, adopt: false });
      const actual = { rechecks: plan.rechecks.map((cue) => cue.contentId), routine: plan.routine.map((cue) => cue.contentId) };
      return differences([actual], [after.cues[seed]]) + (prior ? differences([after.cues[seed]], [prior.cues[seed]]) : 0);
    });
    const counts = { migratedVsBefore: prior ? differences(after.review, prior.review) : null, indexedVsReference: differences(indexed.result, after.review),
      cuePlans: cueDifferences.reduce((sum, value) => sum + value, 0) };
    mismatches += (counts.migratedVsBefore ?? 0) + counts.indexedVsReference + counts.cuePlans;
    // A timed Start and its closure, rolled back: Start admits, serves its first card; closure fills the session record.
    let start: ReturnType<typeof measure> | null = null; let close: ReturnType<typeof measure> | null = null; let admitted: Record<string, number> | null = null;
    let startError: string | null = null;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!readHostedServiceControl('timed_sessions').enabled) setHostedServiceControl({ key: 'timed_sessions', enabled: true, actorId: 'composition-rehearsal' });
      const started = measure(() => startVocabularyStudy({ timeZone: 'America/New_York' }));
      start = { ...started, result: null };
      const context = started.result.session.context;
      admitted = { words: context.words.length, review: context.reviewOrder?.length ?? 0,
        unstudied: context.words.filter((word) => word.mode === 'unstudied').length, solidify: context.words.filter((word) => word.mode === 'solidify').length };
      // Wrap the day at once and skip the open word, so closure runs over a session that served almost nothing.
      const sessionId = started.result.session.sessionId;
      db.prepare("UPDATE vocabulary_timed_session_records SET started_at='2000-01-01T00:00:00.000Z' WHERE session_id=?").run(sessionId);
      let view = nextVocabularyExercise(sessionId, 'rehearsal-wrap', { activeDurationMs: 7_200_000 });
      for (let step = 0; step < 10 && view.session.projection.phase !== 'completed'; step++) {
        view = view.currentWordId ? commandVocabularyStudy(sessionId, `rehearsal-skip-${step}`, { type: 'skip', scope: 'word', wordId: view.currentWordId })
          : commandVocabularyStudy(sessionId, `rehearsal-skip-${step}`, { type: 'skip', scope: 'exercise' });
        if (view.session.projection.phase !== 'completed') view = nextVocabularyExercise(sessionId, `rehearsal-next-${step}`, { activeDurationMs: 7_200_000 });
      }
      close = { ...measure(() => {
        const staged = stageVocabularySessionCompletion(sessionId, view.session.actions.length);
        return closeVocabularySessionCompletion(sessionId, staged.completionId);
      }), result: null };
    } catch (error) { startError = error instanceof Error ? error.message.slice(0, 200) : 'unknown'; }
    finally { db.exec('ROLLBACK'); }
    report.push({ dueObjectives: after.review.length, mismatches: counts,
      oldFullScan: { ms: oldRead.ms, statements: oldRead.executed }, indexedRead: { ms: indexed.ms, statements: indexed.executed },
      timedStart: start && { ms: start.ms, statements: start.executed, prepared: start.prepared, admitted },
      close: close && { ms: close.ms, statements: close.executed }, startError });
  });
  console.log(JSON.stringify({ phase, now, scheduleRowsBefore: Object.keys(before.states).length, scheduleRowsAfter: Object.keys(states).length,
    removedWordSchedules: removed.length, stateMismatches, mismatches, learners: report }, null, 2));
  if (mismatches) process.exitCode = 1;
}
