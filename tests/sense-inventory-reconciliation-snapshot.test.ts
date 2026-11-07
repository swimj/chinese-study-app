import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { snapshotInventoryForReconciliation } from '../server/db/sense-inventory-reconciliation-report.ts';

const at = '2026-11-07T00:00:00.000Z';
const actor = { kind: 'service' as const, id: 'snapshot-fixture' };
let directory: string, baseline: string, db: DatabaseSync;
before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reconciliation-snapshot-'));
  const fixture = path.join(directory, 'baseline');
  createBaselineFixture(fixture); baseline = path.join(fixture, 'app.db');
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  const file = path.join(directory, 'current.db'); fs.copyFileSync(baseline, file);
  db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON');
  db.function('current_learner_id', () => 'learner'); migrateDatabase(db); setDb(db);
  db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('learner', 'Learner', at);
  for (const id of ['target', 'other']) db.prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES (?, '词', 'cí', 'word', '["word"]', '[]', 1, ?)`).run(id, at);
});
afterEach(() => { setDb(null); db.close(); });
function exercise(id: string, wordId: string, teaching = false, reference?: string): void {
  createVocabularyContent({ contentId: id, kind: 'exercise', payloadVersion: 1,
    body: { prompt: 'Word.', ...(reference ? { unusual: { deeply: [reference] } } : {}) },
    exerciseType: 'definition', skill: 'production', exerciseRole: teaching ? 'teaching' : 'general',
    assessment: { match: 'prepared_answer_membership' }, answers: [{ wordId, acceptedForms: ['词'] }],
    words: [{ wordId, relation: 'target' }], accessScope: 'shared', availability: 'active', originKind: 'human' }, actor);
}
function introduction(id: string, exerciseIds: string[]): void {
  createVocabularyContent({ contentId: id, kind: 'introduction', payloadVersion: 1, body: { text: 'Teaching.' },
    words: [{ wordId: 'other', relation: 'target' }],
    teachingExercises: exerciseIds.map(exerciseId => ({ exerciseId, exerciseVersion: 1 })),
    accessScope: 'shared', availability: 'active', originKind: 'human' }, actor);
}
function snapshot(mode?: 'offline' | 'online') {
  db.exec('BEGIN');
  try { return snapshotInventoryForReconciliation(db, 'target', { mode }); }
  finally { db.exec('ROLLBACK'); }
}
function dependencyIds(value: unknown, key: string): string[] {
  assert.ok(Array.isArray(value));
  return value.map((row: Record<string, unknown>) => String(row[key]));
}

test('snapshot retains arbitrary JSON references and the complete shared binding closure with deterministic rows', () => {
  exercise('z-direct', 'target', true);
  exercise('b-linked', 'other', true);
  exercise('c-linked', 'other', true);
  introduction('a-introduction', ['z-direct', 'b-linked']);
  introduction('b-introduction', ['b-linked', 'c-linked']);
  exercise('json-only', 'other', false, 'target');
  exercise('unrelated', 'other');
  const result = snapshot();
  const expected = ['a-introduction', 'b-introduction', 'b-linked', 'c-linked', 'json-only', 'z-direct'];
  assert.deepEqual(dependencyIds(result.dependencies.contents, 'content_id'), expected);
  assert.deepEqual(dependencyIds(result.dependencies.contentWords, 'content_id'), expected);
  assert.deepEqual(dependencyIds(result.dependencies.answers, 'exercise_id'), ['b-linked', 'c-linked', 'json-only', 'z-direct']);
  assert.deepEqual(dependencyIds(result.dependencies.introductionBindings, 'exercise_id'), ['z-direct', 'b-linked', 'b-linked', 'c-linked']);
  assert.deepEqual(snapshot(), result);
});

test('online snapshot omits preserved history while retaining identical active dependencies and embedded-reference blockers', () => {
  exercise('json-only', 'other', false, 'target');
  db.prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,status)
    VALUES ('session','learner',1,?,?, 'closed')`).run(JSON.stringify({ words: [{ wordId: 'target' }] }), at);
  db.prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,through_sequence,staged_at,close_at,status,input_json,report_json,policy_version,closed_at)
    VALUES ('completion','learner','session',1,0,?,?,'closed','{}','{}','fixture',?)`).run(at, at, at);
  db.prepare(`INSERT INTO vocabulary_reflection_session_evidence(completion_id,learner_id,session_id,projection_json,created_at)
    VALUES ('completion','learner','session','{}',?)`).run(at);
  db.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,status,evidence_snapshot_json,created_at)
    VALUES ('case','completion','learner','exercise_improvement','case','other','open',?,?)`).run(JSON.stringify({ nested: ['json-only'] }), at);
  db.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at)
    VALUES ('job','case','exercise_improvement','job','queued',?,?)`).run(at, at);
  const offline = snapshot(), online = snapshot('online');
  assert.equal(dependencyIds(offline.dependencies.retainedSessions, 'session_id').length, 1);
  assert.deepEqual(dependencyIds(online.dependencies.pendingReflectionJobs, 'job_id'), ['job']);
  for (const key of ['learnerSenses', 'wordSchedules', 'pureCueSchedules', 'retainedSessions', 'pendingCompletions', 'stashed', 'reserve']) {
    assert.deepEqual(online.dependencies[key], []); offline.dependencies[key] = [];
  }
  assert.deepEqual(online.dependencies.preservedCounts, {}); offline.dependencies.preservedCounts = {};
  assert.deepEqual(online, offline);
});
