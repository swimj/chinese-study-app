import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import express from 'express';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { computeVocabularyProgress, getVocabularyProgress, loadVocabularyProgressInput, type VocabularyProgressInput } from '../server/db/vocabulary-progress.ts';
import { registerVocabularyProgressRoutes, type VocabularyProgressCost } from '../server/vocabulary/progress-routes.ts';
import type { VocabularyEncounterEvidence, VocabularySessionProjection, VocabularyWordMode } from '../src/domain/vocabulary-session.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-13T18:00:00.000Z');
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY + extraMs).toISOString();

type EncounterOptions = {
  id?: string; word?: string | null; kind?: 'recognition' | 'production' | 'contrast' | 'introduction'; role?: 'general' | 'teaching' | 'priming';
  content?: string; mode?: VocabularyWordMode | null; cue?: boolean; outcome?: 'accepted' | 'rejected'; help?: boolean; response?: string | null;
  responses?: { outcome: 'accepted' | 'rejected'; response?: string | null; help?: boolean; selfAssessment?: 'accepted' | 'rejected' }[];
  at?: string; undone?: boolean; skipped?: boolean; accepted?: string[];
  reveal?: { wordId: string; hanzi: string; traditional?: string | null; pinyin: string }[];
};
let sequence = 0;
function encounter(o: EncounterOptions = {}): VocabularyEncounterEvidence {
  const id = o.id ?? `e${++sequence}`, at = o.at ?? ago(1);
  const responses = (o.responses ?? [{ outcome: o.outcome ?? 'accepted', response: o.response ?? null, help: o.help }]).map((r, index) => ({
    kind: 'response' as const, protocolVersion: 1 as const, actionId: `${id}-r${index}`, clientActionId: `${id}-c${index}`, sequence: index, occurredAt: at,
    payload: { encounterId: id, response: r.response ?? null, outcome: r.outcome, ...(r.help === undefined ? {} : { helpUsed: r.help }), ...(r.selfAssessment ? { selfAssessment: r.selfAssessment } : {}) },
  }));
  return {
    encounterId: id, wordId: o.cue ? null : (o.word === undefined ? 'w1' : o.word), workNumber: 1, presentedActionId: `${id}-p`, presentedAt: at,
    mode: o.cue ? null : (o.mode === undefined ? 'practice' : o.mode),
    snapshot: { contentId: o.content ?? `${o.cue ? 'cue' : o.word ?? 'w1'}-${o.kind ?? 'recognition'}`, contentVersion: 1, kind: o.kind ?? 'recognition', role: o.role ?? 'general',
      body: { prompt: 'prompt', ...(o.reveal ? { revealWords: o.reveal.map(word => ({ meaning: 'm', traditional: null, ...word })) } : {}) },
      assessment: { acceptedAnswers: o.accepted ?? [] }, ...(o.cue ? { schedulingScope: 'pure_cue' as const } : {}) },
    responses, effectiveResponses: responses, feedback: [], effectiveFeedback: [], skipped: o.skipped ?? false, presentationUndone: o.undone ?? false,
  };
}
type WordState = { initialMode: VocabularyWordMode; teachingCompleted?: boolean; admitted?: boolean };
function report(encounters: VocabularyEncounterEvidence[], words: Record<string, WordState> = {}): VocabularySessionProjection {
  return { encounters, words: Object.fromEntries(Object.entries(words).map(([id, word]) => [id, { wordId: id, mode: word.initialMode, admitted: true, teachingCompleted: false, ...word }])) } as unknown as VocabularySessionProjection;
}
const completion = (stagedAt: string, encounters: VocabularyEncounterEvidence[], words?: Record<string, WordState>, activeDurationMs: number | null = 60_000) =>
  ({ stagedAt, activeDurationMs, report: report(encounters, words) });
function compute(completions: VocabularyProgressInput['completions'], options: Partial<VocabularyProgressInput> = {}, timeZone?: string) {
  return computeVocabularyProgress({ completions, judgedEncounterIds: new Set(), unfairEncounterIds: new Set(),
    wordLabels: new Map([['w1', { hanzi: '一', pinyin: 'yī' }], ['w2', { hanzi: '二', pinyin: 'èr' }]]), ...options }, NOW, timeZone);
}
const repeat = <T>(count: number, make: (index: number) => T) => Array.from({ length: count }, (_, index) => make(index));

test('teaching, priming, undone and skipped encounters never count; one attempt per item per session from its first response', () => {
  const result = compute([completion(ago(1), [
    encounter({ role: 'teaching' }), encounter({ role: 'priming' }), encounter({ undone: true }), encounter({ skipped: true }),
    encounter({ word: 'w2', outcome: 'rejected', mode: 'practice' }), encounter({ word: 'w2', outcome: 'accepted', mode: 'practice' }),
    encounter({ word: 'w2', kind: 'contrast' }), encounter({ cue: true, content: 'c1' }), encounter({ cue: true, content: 'c1' }),
  ])]);
  assert.deepEqual(result.days.at(-2), { dayKey: '2026-11-12', wordItems: 2, cueItems: 1, activeDurationMs: 60_000 });
  assert.deepEqual(result.recognition, { rate: null, success: 0, failure: 1, void: 0, pending: 0 });
  assert.equal(result.days.length, 14);
  assert.equal(result.today, '2026-11-13');
});

test('help-used acceptance is a failure and adds no active vocabulary', () => {
  const result = compute([completion(ago(1), [encounter({ kind: 'recognition', help: true }), encounter({ kind: 'production', help: true })])]);
  assert.equal(result.recognition.failure, 1);
  assert.equal(result.activeVocabulary.total, 0);
});

test('rejected production: unfair is void, judged fair is failure, unjudged is pending, pronunciation is always failure; recognition ignores judgments', () => {
  const at = ago(29);
  const rejected = (id: string, extra: Partial<EncounterOptions> = {}) => encounter({ id, word: id, kind: 'production', outcome: 'rejected', at, ...extra });
  const encounters = [rejected('unfair'), rejected('fair'), rejected('unjudged'),
    rejected('pronunciation', { accepted: ['好'], responses: [{ outcome: 'rejected', response: '好', selfAssessment: 'rejected' }] }),
    encounter({ id: 'recognition', kind: 'recognition', outcome: 'rejected', at })];
  const prior = encounters.map(item => encounter({ word: item.wordId, kind: item.snapshot.kind as 'production', content: `prior-${item.encounterId}`, at: ago(60) }));
  const judged = new Set(['unfair', 'fair', 'pronunciation', 'recognition']);
  const result = compute([completion(ago(60), prior), completion(at, encounters)], { judgedEncounterIds: judged, unfairEncounterIds: new Set(['unfair', 'pronunciation', 'recognition']) });
  // Every word has a prior attempt on other content, and each encounter shows new content: all are transfer attempts.
  assert.deepEqual(result.transfer, { rate: null, success: 0, failure: 3, void: 1, pending: 1 });
  assert.deepEqual(result.recognition, { rate: null, success: 0, failure: 1, void: 0, pending: 0 });
});

test('a rate is null under 10 judged attempts and computed at 10', () => {
  const make = (count: number) => compute([completion(ago(1), repeat(count, index => encounter({ word: `w${index}`, outcome: index ? 'accepted' : 'rejected' })))]).recognition;
  assert.equal(make(9).rate, null);
  assert.deepEqual(make(10), { rate: 0.9, success: 9, failure: 1, void: 0, pending: 0 });
});

test('recognition is held-only and windowed to 30 days', () => {
  const result = compute([completion(ago(31), [encounter({ word: 'old', at: ago(31) })]),
    completion(ago(2), [encounter({ word: 'solid', mode: 'solidify' }), encounter({ word: 'held', mode: 'maintain' }), encounter({ cue: true, content: 'cue-recognition' })])]);
  assert.deepEqual(result.recognition, { rate: null, success: 1, failure: 0, void: 0, pending: 0 });
});

test('stickiness needs a gap of at least 21 days; unknown gaps are excluded', () => {
  const result = compute([
    completion(ago(80), [encounter({ word: 'exact', at: ago(80) }), encounter({ word: 'short', at: ago(80, 1) }), encounter({ cue: true, content: 'c', at: ago(80) })]),
    completion(ago(59), [encounter({ word: 'exact', at: ago(59) }), encounter({ word: 'short', at: ago(59) }), encounter({ cue: true, content: 'c', at: ago(30) }), encounter({ word: 'new', at: ago(30) })]),
  ]);
  assert.deepEqual(result.stickiness, { rate: null, success: 2, failure: 0, void: 0, pending: 0, wordAttempts: 1, cueAttempts: 1 });
});

test('transfer needs a prior attempt on other content, except pure cues, and the content must be new', () => {
  const result = compute([
    completion(ago(10), [encounter({ word: 'w1', content: 'a' }), encounter({ cue: true, content: 'cue-1' })]),
    completion(ago(5), [encounter({ word: 'w1', content: 'b' }), encounter({ word: 'w1', kind: 'production', content: 'p' }), encounter({ cue: true, content: 'cue-1' })]),
    completion(ago(1), [encounter({ word: 'w1', content: 'a' })]),
  ]);
  // First pure cue (no prior needed) and w1 recognition on new content b. Production p has no prior production; repeat of a is not new.
  assert.deepEqual(result.transfer, { rate: null, success: 2, failure: 0, void: 0, pending: 0 });
});

test('a pure-cue production resolves to exactly one reveal word; an ambiguous match is skipped', () => {
  const reveal = [{ wordId: 'w-hao', hanzi: '好', traditional: null, pinyin: 'hǎo' }, { wordId: 'w-ma', hanzi: '吗', traditional: '嗎', pinyin: 'ma' }];
  const ambiguous = [{ wordId: 'x1', hanzi: '行', pinyin: 'xíng' }, { wordId: 'x2', hanzi: '行', pinyin: 'háng' }];
  const result = compute([completion(ago(40), [encounter({ cue: true, kind: 'production', content: 'baseline' })]), completion(ago(1), [
    encounter({ cue: true, kind: 'production', content: 'c1', response: ' 嗎 ', reveal }),
    encounter({ cue: true, kind: 'production', content: 'c2', response: '行', reveal: ambiguous }),
    encounter({ cue: true, kind: 'production', content: 'c3', response: '不', reveal }),
  ])]);
  assert.equal(result.activeVocabulary.total, 1);
  assert.deepEqual(result.firstProductions, [{ wordId: 'w-ma', hanzi: '吗', pinyin: 'ma', dayKey: '2026-11-12' }]);
});

test('the baseline hides early first productions but keeps them in the total; the list is recent-first and capped', () => {
  const words = repeat(15, index => `n${index}`);
  const labels = new Map([['early', { hanzi: '早', pinyin: 'zǎo' }], ...words.map(id => [id, { hanzi: id, pinyin: id }] as const)]);
  const result = compute([
    completion(ago(60), [encounter({ word: 'early', kind: 'production', at: ago(60) })]),
    completion(ago(47), [encounter({ word: 'early', kind: 'production', at: ago(47) })]),
    ...words.map((id, index) => completion(ago(40 - index * 2), [encounter({ word: id, kind: 'production', at: ago(40 - index * 2) })])),
  ], { wordLabels: labels });
  assert.equal(result.activeVocabulary.total, 16);
  assert.equal(result.activeVocabulary.addedLast30Days, 9);
  assert.equal(result.firstProductions.length, 12);
  assert.equal(result.firstProductions[0]!.wordId, 'n14');
  assert.ok(!result.firstProductions.some(item => item.wordId === 'early'));
});

test('efficiency reports per teaching month the median sessions to Practice, settled and settling counts, null under 5', () => {
  const sessions: VocabularyProgressInput['completions'][number][] = [];
  // Six October words settle after 1..6 sessions; one stays settling. One November word settles.
  const october = repeat(7, index => `oct${index}`);
  for (let session = 0; session < 7; session++) {
    sessions.push(completion(`2026-10-${String(2 + session).padStart(2, '0')}T12:00:00.000Z`, [], Object.fromEntries(october.map((id, index) =>
      [id, { initialMode: index < 6 && session > index ? 'practice' : session === 0 ? 'unstudied' : 'solidify', teachingCompleted: session === 0 }]))));
  }
  sessions.push(completion('2026-11-02T12:00:00.000Z', [], { nov: { initialMode: 'unstudied', teachingCompleted: true }, unadmitted: { initialMode: 'unstudied', teachingCompleted: true, admitted: false } }));
  sessions.push(completion('2026-11-03T12:00:00.000Z', [], { nov: { initialMode: 'practice' } }));
  const result = compute(sessions);
  assert.deepEqual(result.efficiency, [
    { month: '2026-10', medianSessions: 3.5, settled: 6, settling: 1 },
    { month: '2026-11', medianSessions: null, settled: 1, settling: 0 },
  ]);
});

test('day bucketing follows the local 04:00 boundary and sums active time', () => {
  // 02:30 in New York on the 12th belongs to the 11th's study day.
  const result = compute([completion('2026-11-12T07:30:00.000Z', [encounter({ word: 'a' })], undefined, 1_000),
    completion('2026-11-12T09:30:00.000Z', [encounter({ word: 'a' }), encounter({ cue: true })], undefined, null)], {}, 'America/New_York');
  assert.equal(result.today, '2026-11-13');
  assert.deepEqual(result.days.find(day => day.dayKey === '2026-11-11'), { dayKey: '2026-11-11', wordItems: 1, cueItems: 0, activeDurationMs: 1_000 });
  assert.deepEqual(result.days.find(day => day.dayKey === '2026-11-12'), { dayKey: '2026-11-12', wordItems: 1, cueItems: 1, activeDurationMs: 0 });
});

test('malformed reports and unordered completions fail loudly', () => {
  assert.throws(() => compute([{ stagedAt: ago(1), activeDurationMs: null, report: { words: {} } as unknown as VocabularySessionProjection }]), /Malformed vocabulary progress report/);
  assert.throws(() => compute([completion(ago(1), []), completion(ago(2), [])]), /ordered/);
});

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE vocabulary_session_completions(completion_id TEXT,learner_id TEXT,status TEXT,staged_at TEXT,input_json TEXT,report_json TEXT);
    CREATE TABLE reflection_cases(case_id TEXT,learner_id TEXT,kind TEXT);
    CREATE TABLE reflection_case_evidence(case_id TEXT,encounter_id TEXT);
    CREATE TABLE vocabulary_reflection_jobs(job_id TEXT,case_id TEXT,status TEXT,result_json TEXT,created_at TEXT);
    CREATE TABLE learner_words(learner_id TEXT,word_id TEXT);
    CREATE TABLE lexical_words(id TEXT,hanzi TEXT,pinyin TEXT);
    INSERT INTO learner_words VALUES ('a','w1');INSERT INTO lexical_words VALUES ('w1','一','yī');`);
  const insert = (id: string, learner: string, status: string, stagedAt: string, encounters: VocabularyEncounterEvidence[]) =>
    db.prepare('INSERT INTO vocabulary_session_completions VALUES (?,?,?,?,?,?)').run(id, learner, status, stagedAt, JSON.stringify({ activeDurationMs: 5000 }), JSON.stringify(report(encounters)));
  insert('closed', 'a', 'closed', ago(1), [encounter({ id: 'fair', kind: 'production', outcome: 'rejected' }), encounter({ id: 'unfair', word: 'w2', kind: 'production', outcome: 'rejected' }), encounter({ id: 'running', word: 'w3', kind: 'production', outcome: 'rejected' })]);
  insert('pending', 'a', 'pending', ago(1), [encounter({ word: 'pending-word' })]);
  insert('other', 'b', 'closed', ago(1), [encounter({ word: 'other-word' })]);
  db.exec(`INSERT INTO reflection_cases VALUES ('c1','a','learner_feedback'),('c2','a','learner_feedback'),('c3','a','learner_feedback'),('c4','a','exercise_improvement');
    INSERT INTO reflection_case_evidence VALUES ('c1','fair'),('c2','unfair'),('c3','running'),('c4','running');
    INSERT INTO vocabulary_reflection_jobs VALUES ('j1','c1','succeeded','{"input":{"unfairEncounterIds":[]}}','2026-11-12'),
      ('j2a','c2','succeeded','{"input":{"unfairEncounterIds":[]}}','2026-11-12'),('j2b','c2','succeeded','{"input":{"unfairEncounterIds":["unfair"]}}','2026-11-13'),
      ('j3','c3','running',NULL,'2026-11-12'),('j4','c4','succeeded','{"input":{}}','2026-11-12');`);
  return db;
}

test('the loader reads only the learner’s closed completions and its latest succeeded feedback judgments', () => {
  setDb(database());
  const { input, stats } = loadVocabularyProgressInput('a');
  assert.equal(stats.completions, 1);
  assert.deepEqual([...input.judgedEncounterIds].sort(), ['fair', 'unfair']);
  assert.deepEqual([...input.unfairEncounterIds], ['unfair']);
  assert.equal(input.completions[0]!.activeDurationMs, 5000);
  const progress = runWithLearnerId('a', () => getVocabularyProgress(NOW));
  assert.equal(progress.days.at(-2)!.wordItems, 3);
  const saved = { APP_AUTH_MODE: process.env.APP_AUTH_MODE, APP_MODE: process.env.APP_MODE, APP_DATA_DIR: process.env.APP_DATA_DIR };
  Object.assign(process.env, { APP_AUTH_MODE: 'clerk', APP_MODE: 'study', APP_DATA_DIR: '/tmp/vocabulary-progress' });
  try { assert.throws(() => getVocabularyProgress(NOW), /Learner context/); }
  finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('the endpoint validates the time zone, returns progress and logs its cost', async () => {
  setDb(database());
  const costs: VocabularyProgressCost[] = [];
  const app = express();
  app.use((_req, _res, next) => runWithLearnerId('a', next));
  registerVocabularyProgressRoutes(app, cost => costs.push(cost));
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const bad = await fetch(`http://127.0.0.1:${port}/api/vocabulary/progress?timeZone=Not/AZone`);
    assert.equal(bad.status, 400);
    const ok = await fetch(`http://127.0.0.1:${port}/api/vocabulary/progress?timeZone=America/New_York`);
    assert.equal(ok.status, 200);
    const body = await ok.json() as { days: unknown[] };
    assert.equal(body.days.length, 14);
    assert.equal(costs.length, 1);
    assert.equal(costs[0]!.completions, 1);
    assert.ok(costs[0]!.reportBytes > 0);
  } finally { server.close(); }
});
