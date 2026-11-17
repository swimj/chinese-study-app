import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { installLearnerContextSqlFunction, runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { splitPureCueSchedulerState, splitWordSchedulerState } from '../server/db/vocabulary-schedule-columns.ts';
import { compareReviewCandidates } from '../server/db/review-policy.ts';
import { readVocabularyDueReviewObjectives, selectVocabularyReviewSkills, type VocabularyReviewSkill } from '../server/vocabulary/review-selection.ts';
import { planVocabularyPureCues } from '../server/vocabulary/pure-cue-serving.ts';
import { canServeVocabularyReviewProduction } from '../server/vocabulary/production-coverage.ts';
import { referenceDueReviewObjectives, referencePureCuePlan } from '../scripts/lib/session-composition-reference.ts';

// The indexed composition reads must return exactly what the full-scan
// reference returns, in the same order, for any learner state.
const base = Date.parse('2026-11-10T12:00:00.000Z');
const at = (hours: number) => new Date(base + hours * 3_600_000).toISOString();
const actor = { kind: 'operator' as const, id: 'test' };
let root: string; let baseline: string; let db: DatabaseSync;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'composition-reads-')); createBaselineFixture(path.join(root, 'baseline')); baseline = path.join(root, 'baseline', 'app.db'); });
after(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  const location = path.join(root, `${Math.random()}.db`); fs.copyFileSync(baseline, location);
  db = new DatabaseSync(location); db.exec('PRAGMA foreign_keys=ON'); setDb(db); installLearnerContextSqlFunction();
  migrateDatabase(db);
  for (const learner of ['alice', 'bob']) db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run(learner, learner, at(-1000));
});
afterEach(() => { setDb(null); db.close(); });

/** Deterministic generator so a failure names a reproducible seed. */
function rng(seed: string) {
  let counter = 0;
  const next = () => parseInt(createHash('sha256').update(`${seed}/${counter++}`).digest('hex').slice(0, 8), 16) / 0x100000000;
  return { next, chance: (p: number) => next() < p, pick: <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!,
    hours: (from: number, to: number) => at(Math.round(from + next() * (to - from))) };
}

function populate(seed: string, words: number, cues: number): void {
  const r = rng(seed);
  for (let index = 0; index < words; index++) {
    const id = `w${index}`;
    db.prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at) VALUES (?,?,'p','m','[]',1,?)`).run(id, `字${index}`, at(-1000));
    // Some words have an established catalog with no active sense, which makes them ineligible.
    if (r.chance(0.05)) db.prepare('INSERT INTO vocabulary_word_catalogs(word_id,sense_catalog_version,senses_established_at) VALUES (?,1,?)').run(id, at(-500));
    for (const learner of ['alice', 'bob']) {
      if (learner === 'bob' && r.chance(0.5)) continue;
      const mode = r.pick(['unstudied', 'unstudied', 'solidify', 'practice', 'practice', 'practice', 'maintain'] as const);
      db.prepare(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at,dismissed_at) VALUES (?,?,?,?,?,?,?)`)
        .run(learner, id, r.chance(0.5) ? 1 : 0, at(-900), mode, at(-900), r.chance(0.07) ? at(-10) : null);
      const studied = mode !== 'unstudied' && !r.chance(0.12);
      const state = { intervalHours: r.pick([6, 24, 48, 96, 300, 720]), easeFactor: 2.5, enabled: r.chance(0.08) ? 0 : 1, cleanCoveredSessions: 0,
        ...(r.chance(0.1) ? { postCompensationEarliestCheckAt: r.hours(-48, 48) } : {}), ...(r.chance(0.05) ? { resetUntil: r.hours(-24, 24) } : {}) };
      const stored = splitWordSchedulerState(state);
      db.prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json,
        interval_hours,enabled,reset_until,post_compensation_check_at,refresh_requested_at,refresh_until) VALUES (?,?,?,?,'test',?,?,?,?,?,?,?)`)
        .run(learner, id, r.chance(0.3) ? null : r.hours(-200, 200), studied ? r.hours(-1500, -1) : null, stored.json, stored.columns.interval_hours,
          stored.columns.enabled, stored.columns.reset_until, stored.columns.post_compensation_check_at,
          ...(mode === 'maintain' && r.chance(0.2) ? [at(-2), r.hours(1, 72)] : [null, null]));
      for (const skill of ['recognition', 'contextual_selection', 'production'] as const) {
        if (!r.chance(skill === 'production' ? 0.2 : 0.5)) continue;
        db.prepare(`INSERT INTO learner_owned_word_skill_state(learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
          VALUES (?,?,?,?,?,?,?,2.5)`).run(learner, id, skill, r.chance(0.1) ? 0 : 1, r.pick([6, 24, 72, 240]), r.hours(-800, -1), r.chance(0.4) ? null : r.hours(-100, 100));
      }
      for (const skill of ['recognition', 'contextual_selection', 'production'] as const) if (r.chance(0.06)) db.prepare(`INSERT INTO
        learner_owned_word_skill_relevance(learner_id,word_id,skill_id,relevance_state,updated_at) VALUES (?,?,?,?,?)`).run(learner, id, skill, r.pick(['suppressed', 'active']), at(-5));
      if (r.chance(0.08)) db.prepare(`INSERT INTO learner_owned_word_study_admission_state(learner_id,word_id,study_phase,earliest_next_study_at)
        VALUES (?,?,'review',?)`).run(learner, id, r.hours(-6, 6));
    }
  }
  for (let index = 0; index < cues; index++) {
    const id = `cue${index}`; const answer = `w${Math.floor(r.next() * words)}`;
    createVocabularyContent({ contentId: id, kind: 'exercise', payloadVersion: 1, body: { prompt: id }, accessScope: 'shared',
      availability: r.chance(0.05) ? 'retired' : 'active', originKind: 'human', words: [{ wordId: answer, relation: 'target' }], exerciseType: 'pure_cue',
      skill: 'production', exerciseRole: 'general', assessment: { match: 'prepared' }, answers: [{ wordId: answer, acceptedForms: [`字${answer}`] }] }, actor);
    for (const learner of ['alice', 'bob']) {
      if (r.chance(0.2)) continue;
      const strong = r.chance(0.45);
      const state = { intervalHours: strong ? 720 : r.pick([6, 24, 96]), easeFactor: 2.5, enabled: r.chance(0.05) ? 0 : 1, cleanCoveredSessions: 0,
        strongSince: strong ? r.hours(-2000, -100) : null, strongSuccesses: strong ? Math.floor(r.next() * 4) : 0,
        ...(r.chance(0.3) ? { maintenanceIdentity: `legacy-${index}` } : {}), ...(r.chance(0.08) ? { resetUntil: r.hours(-48, 48) } : {}),
        ...(r.chance(0.08) ? { postCompensationRecheckAt: r.hours(-48, 48) } : {}) };
      const stored = splitPureCueSchedulerState(state);
      db.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json,
        interval_hours,enabled,reset_until,strong_since,strong_successes,maintenance_identity,recheck_at) VALUES (?,?,?,?,'test',?,?,?,?,?,?,?,?)`)
        .run(learner, id, r.chance(0.2) ? null : r.hours(-300, 300), r.chance(0.2) ? null : r.hours(-3000, -1), stored.json, stored.columns.interval_hours,
          stored.columns.enabled, stored.columns.reset_until, stored.columns.strong_since, stored.columns.strong_successes,
          stored.columns.maintenance_identity, stored.columns.recheck_at);
      if (r.chance(0.05)) db.prepare('INSERT INTO learner_content_deactivations(learner_id,content_id,deactivated_at) VALUES (?,?,?)').run(learner, id, at(-3));
    }
  }
}

/** Selection as it was computed before: the best usable objective per word by the ranking comparator. */
function referenceSelection(now: string, canUseSkill: (wordId: string, skillId: VocabularyReviewSkill) => boolean) {
  const best = new Map<string, ReturnType<typeof referenceDueReviewObjectives>[number]>();
  for (const objective of referenceDueReviewObjectives(now)) {
    if (!canUseSkill(objective.wordId, objective.skillId)) continue;
    if (objective.skillId === 'production' && !canServeVocabularyReviewProduction(objective.wordId, objective.mode)) continue;
    const previous = best.get(objective.wordId);
    if (!previous || compareReviewCandidates(objective, previous) < 0) best.set(objective.wordId, objective);
  }
  return [...best.values()].sort(compareReviewCandidates).map(({ wordId, skillId }) => ({ wordId, skillId }));
}

for (const seed of ['a', 'b', 'c']) test(`indexed review and pure-cue reads equal the full-scan reference (seed ${seed})`, () => {
  populate(seed, 400, 120);
  for (const learner of ['alice', 'bob']) runWithLearnerId(learner, () => {
    for (const offset of [-72, -6, 0, 0.5, 13, 50, 400]) {
      const now = at(offset);
      const reference = referenceDueReviewObjectives(now);
      assert.deepEqual(readVocabularyDueReviewObjectives(now), reference, `${learner} at ${now}`);
      // Selection also runs the content-dependent check; make it reject some objectives.
      const canUse = (wordId: string, skill: VocabularyReviewSkill) => createHash('sha256').update(`${wordId}/${skill}`).digest()[0]! % 5 !== 0;
      assert.deepEqual(selectVocabularyReviewSkills({ now, canUseSkill: canUse }), referenceSelection(now, canUse), `${learner} selection at ${now}`);
      for (const [count, sessionSeed] of [[0, 's1'], [30, 's2'], [200, 's3']] as const) {
        const plan = planVocabularyPureCues({ ordinaryReviewCount: count, sessionSeed, now, adopt: false });
        assert.deepEqual({ rechecks: plan.rechecks.map((cue) => cue.contentId), routine: plan.routine.map((cue) => cue.contentId) },
          referencePureCuePlan({ ordinaryReviewCount: count, sessionSeed, now }), `${learner} cues at ${now} (${count})`);
      }
    }
    assert.ok(referenceDueReviewObjectives(at(0)).length > 20, 'fixture has due work');
  });
});

test('the review read visits due rows only, through the due index', () => runWithLearnerId('alice', () => {
  populate('plan', 50, 0);
  const statements: string[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => { statements.push(sql); return prepare(sql); }) as typeof db.prepare;
  try { readVocabularyDueReviewObjectives(at(0)); } finally { db.prepare = prepare; }
  assert.equal(statements.length, 1);
  const details = (prepare(`EXPLAIN QUERY PLAN ${statements[0]}`).all({ learner: 'alice', now: at(0) }) as { detail: string }[]).map((row) => row.detail).join('\n');
  assert.match(details, /SEARCH learner_word_schedules USING COVERING INDEX idx_learner_word_schedules_review_due \(learner_id=\? AND review_due_at<\?\)/);
  assert.match(details, /SEARCH learner_owned_word_skill_state USING COVERING INDEX idx_word_skill_state_review_due \(learner_id=\? AND review_due_at<\?\)/);
  assert.doesNotMatch(details, /SCAN learner_(word_schedules|owned_word_skill_state|words)\b/);
}));
