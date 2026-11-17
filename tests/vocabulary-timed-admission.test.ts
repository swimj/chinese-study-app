import assert from 'node:assert/strict';
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
import { admitTimedVocabularyStudy } from '../server/vocabulary/timed-admission.ts';
import { readVocabularyDueReviewObjectives, type VocabularyReviewSkill } from '../server/vocabulary/review-selection.ts';
import { readVocabularyPureCueStreams } from '../server/vocabulary/pure-cue-serving.ts';
import { timedReviewBound } from '../src/domain/timed-session.ts';
import { createTimedSessionRecord, finalizeTimedSession } from '../server/db/vocabulary-timed-sessions.ts';
import { createVocabularySession } from '../server/db/vocabulary-sessions.ts';
import { projectVocabularySession } from '../src/domain/vocabulary-session.ts';

const base = Date.parse('2026-11-10T12:00:00.000Z');
const at = (hours: number) => new Date(base + hours * 3_600_000).toISOString();
const now = at(0);
const actor = { kind: 'operator' as const, id: 'test' };
let root: string; let baseline: string; let db: DatabaseSync;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'timed-admission-')); createBaselineFixture(path.join(root, 'baseline')); baseline = path.join(root, 'baseline', 'app.db'); });
after(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  const location = path.join(root, `${Math.random()}.db`); fs.copyFileSync(baseline, location);
  db = new DatabaseSync(location); db.exec('PRAGMA foreign_keys=ON'); setDb(db); installLearnerContextSqlFunction();
  migrateDatabase(db);
  db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('alice', 'alice', at(-1000));
});
afterEach(() => { setDb(null); db.close(); });
const alice = <T>(work: () => T) => runWithLearnerId('alice', work);

/** `count` overdue practice words, more urgent with lower index; `solidify` due learning words. */
function words(count: number, solidify = 0): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count + solidify; index++) {
    const id = `w${String(index).padStart(4, '0')}`; ids.push(id);
    db.prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at) VALUES (?,?,'p','m','[]',1,?)`).run(id, id, at(-1000));
    db.prepare(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES ('alice',?,1,?,?,?)`)
      .run(id, at(-900 + index), index < count ? 'practice' : 'solidify', at(-900));
    db.prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json,interval_hours,enabled)
      VALUES ('alice',?,NULL,?,'test','{"easeFactor":2.5,"cleanCoveredSessions":0}',24,1)`).run(id, at(-48 - (count - index)));
  }
  return ids.slice(0, count);
}
function cue(id: string, wordId: string, schedule: { next?: string | null; last?: string | null; strongSince?: string | null; recheckAt?: string | null; successes?: number }): void {
  createVocabularyContent({ contentId: id, kind: 'exercise', payloadVersion: 1, body: { prompt: id }, accessScope: 'shared', availability: 'active',
    originKind: 'human', words: [{ wordId, relation: 'target' }], exerciseType: 'pure_cue', skill: 'production', exerciseRole: 'general',
    assessment: { match: 'prepared' }, answers: [{ wordId, acceptedForms: [wordId] }] }, actor);
  db.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json,
    interval_hours,strong_since,strong_successes,recheck_at) VALUES ('alice',?,?,?,'test','{"easeFactor":2.5}',?,?,?,?)`)
    .run(id, schedule.next ?? null, schedule.last === undefined ? at(-2000) : schedule.last, schedule.strongSince ? 720 : 24, schedule.strongSince ?? null, schedule.successes ?? 0, schedule.recheckAt ?? null);
}
function admit(options: { bound: number; usable?: (wordId: string, skill: VocabularyReviewSkill) => boolean; seed?: string }) {
  const checked: string[] = [];
  const admission = admitTimedVocabularyStudy({ now, sessionSeed: options.seed ?? 'seed', reviewBound: options.bound,
    teachingReady: () => false, isLearningContentUsable: () => true,
    isReviewContentUsable: (wordId, skill) => { checked.push(wordId); return options.usable ? options.usable(wordId, skill) : true; } });
  return { admission, checked };
}

test('the review bound is five items per minute of the allowance', () => {
  assert.equal(timedReviewBound(20 * 60_000), 100);
  assert.equal(timedReviewBound(5 * 60_000), 25);
  assert.equal(timedReviewBound(12 * 60_000 + 1), 61);
  assert.throws(() => timedReviewBound(0), /positive allowance/);
});

test('review admits the top of the ranking up to the bound and checks content only while walking it', () => alice(() => {
  const ids = words(300, 4);
  const { admission, checked } = admit({ bound: 100 });
  assert.deepEqual(admission.reviewWords.map((word) => word.wordId), ids.slice(0, 100));
  assert.ok(admission.reviewWords.every((word) => word.selectedSkill === 'production' && word.mode === 'practice'));
  // Content checks stop when the cap fills: 100 checks for a 300-word due set.
  assert.equal(checked.length, 100);
  // Learning has no cap of its own and takes nothing from review.
  assert.deepEqual(admission.learningWordIds, ['w0300', 'w0301', 'w0302', 'w0303']);
}));

test('a candidate that fails a content check is passed over and the next in rank takes its place', () => alice(() => {
  const ids = words(20);
  const failing = new Set(['w0001', 'w0004']);
  const { admission, checked } = admit({ bound: 5, usable: (wordId) => !failing.has(wordId) });
  assert.deepEqual(admission.reviewWords.map((word) => word.wordId), ids.slice(0, 7).filter((id) => !failing.has(id)));
  assert.equal(checked.length, 7);
}));

test('review words and fragile cues share one urgency ranking; items overdue by a full interval are pressing', () => alice(() => {
  const ids = words(8);
  // w4..w7 only anchor the cues: not due, so no cue answers a ranked word.
  db.prepare(`UPDATE learner_word_schedules SET next_eligible_at=? WHERE learner_id='alice' AND word_id IN ('w0004','w0005','w0006','w0007')`).run(at(1000));
  // Urgency is time since study over the 24-hour interval.
  const studied = (id: string, hours: number) => db.prepare(`UPDATE learner_word_schedules SET last_practised_at=? WHERE word_id=?`).run(at(-hours), id);
  studied('w0000', 52); studied('w0001', 48); studied('w0003', 40);
  // An objective with no study history ranks first but is not overdue; w0002's studied objective is 1.25.
  db.prepare(`UPDATE learner_word_schedules SET last_practised_at=NULL WHERE word_id='w0002'`).run();
  db.prepare(`INSERT INTO learner_owned_word_skill_state(learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
    VALUES ('alice','w0002','recognition',1,24,?,NULL,2.5)`).run(at(-30));
  // A cue's urgency is how far past its due date it is, in intervals, plus one.
  cue('c-hot', ids[4]!, { next: at(-30) });
  cue('c-warm', ids[5]!, { next: at(-12) });
  cue('c-unstudied', ids[6]!, { next: at(-40), last: null });
  const { admission } = admit({ bound: 6 });
  assert.deepEqual(admission.reviewOrder.map((entry) => `${entry.kind}:${entry.id}`), [
    'word:w0002', // unstudied production objective (infinite urgency)
    'pure_cue:c-unstudied', // 2.67, never studied
    'pure_cue:c-hot', // 2.25
    'word:w0000', // 2.17
    'word:w0001', // exactly 2
    'word:w0003', // 1.67; the cut falls before c-warm (1.5)
  ]);
  assert.deepEqual(admission.pressingKeys, ['pure_cue:c-hot', 'word:w0000', 'word:w0001']);
}));

test('every due recheck is admitted ahead of the bound; strong slots scale with the admitted review count', () => alice(() => {
  // Cue answers proxy their words' production review, so cues answer the least urgent words.
  const ids = words(50).slice(40);
  for (let index = 0; index < 3; index++) cue(`recheck-${index}`, ids[index]!, { recheckAt: at(-1 - index) });
  cue('recheck-future', ids[4]!, { recheckAt: at(5) });
  // About one strong cue in ninety wins a given day's roll.
  for (let index = 0; index < 600; index++) cue(`strong-${index}`, ids[index % 10]!, { strongSince: at(-3000), successes: 0 });
  const rolled = readVocabularyPureCueStreams(now).strong.length;
  assert.ok(rolled > 0, 'fixture has rolled strong cues');
  const { admission } = admit({ bound: 10 });
  const order = admission.reviewOrder.map((entry) => entry.id);
  assert.deepEqual(order.slice(0, 3), ['recheck-2', 'recheck-1', 'recheck-0']);
  assert.ok(!order.includes('recheck-future'));
  const strong = order.filter((id) => id.startsWith('strong-'));
  // (10 admitted review items) / 10 = one strong slot when enough cues rolled.
  assert.equal(strong.length, Math.min(1, rolled));
  assert.equal(order.filter((id) => id.startsWith('w')).length, 10);
}));

test('the admitted set equals the reference ranking per stream on a large due set', () => alice(() => {
  words(500, 3);
  const { admission } = admit({ bound: 100 });
  const ranked: string[] = [];
  for (const objective of readVocabularyDueReviewObjectives(now)) if (!ranked.includes(objective.wordId)) ranked.push(objective.wordId);
  assert.deepEqual(admission.reviewWords.map((word) => word.wordId), ranked.slice(0, 100));
}));

test('closure reads no schedules and records admitted pressing items left unstarted', () => alice(() => {
  words(300);
  const timed = { version: 1 as const, dayKey: now.slice(0, 10), budgetMs: 1_200_000, budgetSource: 'default' as const, dayActiveMsAtStart: 0,
    untilDayActiveMs: 1_200_000, pressingKeys: ['word:w0000', 'pure_cue:c-1'], facts: {} };
  const context = { sessionId: 'closing', words: [], reviewOrder: [], timed };
  createVocabularySession(context, now); createTimedSessionRecord('closing', timed, now);
  const prepared: string[] = []; const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => { prepared.push(sql); return prepare(sql); }) as typeof db.prepare;
  try { finalizeTimedSession({ context, actions: [], projection: projectVocabularySession(context, []), activeDurationMs: 0, now }); }
  finally { db.prepare = prepare; }
  assert.ok(!prepared.some((sql) => /schedules|skill_state|content_items/.test(sql)), `closure reads only its record: ${prepared.join(' | ')}`);
  const row = db.prepare(`SELECT unstarted_pressing_json FROM vocabulary_timed_session_records WHERE session_id='closing'`).get() as { unstarted_pressing_json: string };
  assert.deepEqual(JSON.parse(row.unstarted_pressing_json), ['word:w0000', 'pure_cue:c-1']);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM sqlite_schema WHERE name='learner_timed_skip_counts'`).get()!.n, 0);
}));
