import assert from 'node:assert/strict';
import test from 'node:test';
import { assignPolicy, CHECKUP_DAYS, GRADUATION_VERSION, lifecycle, type Outcome, type PolicyId } from './lifecycle.ts';
import { graduationExperiment } from './priority-report.ts';
import { rank, signalsFrom, type Signal } from './priority.ts';
import type { RecordedEvent, Target } from './record.ts';
import { dueAllowed } from './session.ts';

// Day n of November 2026 at noon UTC; teaching happens on day 1.
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour)).toISOString();
const recall = (day: number, correct = true): Outcome => ({ at: at(day), correct, typed: true });
const choice = (day: number, correct = true): Outcome => ({ at: at(day), correct, typed: false });
const taught = at(1, 10);

test('each new word is assigned one of three policies at random, with the policy version', () => {
  assert.deepEqual(assignPolicy(() => 0), { policy: 'A', version: GRADUATION_VERSION });
  assert.deepEqual(assignPolicy(() => 0.5), { policy: 'B', version: GRADUATION_VERSION });
  assert.deepEqual(assignPolicy(() => 0.99), { policy: 'C', version: GRADUATION_VERSION });
  const seen = new Set(Array.from({ length: 200 }, () => assignPolicy().policy));
  assert.deepEqual([...seen].sort(), ['A', 'B', 'C']);
});

test('a taught word waits for its first recall, then follows its policy’s schedule', () => {
  assert.equal(lifecycle('A', taught, [], 'UTC').state, 'first');
  assert.equal(lifecycle('A', taught, [], 'UTC').due, '2026-11-01', 'its first recall is due at once');
  // The same-session recall settles the word but is not a clean recall: it is not due yet.
  const afterSession = lifecycle('B', taught, [recall(1)], 'UTC');
  assert.deepEqual([afterSession.state, afterSession.clean, afterSession.due], ['settling', 0, '2026-11-02']);
  const schedules: [PolicyId, number[], string][] = [
    ['A', [2, 3], 'graduated on the second clean recall, a day apart'],
    ['B', [2, 5], 'then three days'],
    ['C', [2, 5, 12], 'then three and seven days'],
  ];
  for (const [policy, days, why] of schedules) {
    const outcomes = [recall(1), ...days.map((d) => recall(d))];
    const life = lifecycle(policy, taught, outcomes, 'UTC');
    assert.equal(life.state, 'graduated', policy + ': ' + why);
    assert.equal(life.recallsToGraduate, outcomes.length);
    assert.equal(lifecycle(policy, taught, outcomes.slice(0, -1), 'UTC').state, 'settling', policy + ' needs every clean recall');
  }
});

test('a recall before it is due counts for nothing, and a correct choice never counts', () => {
  const early = lifecycle('B', taught, [recall(2), recall(3)], 'UTC');
  assert.equal(early.clean, 1, 'day 3 is only one day after the first clean recall; B waits three');
  assert.equal(early.due, '2026-11-05');
  const choices = lifecycle('A', taught, [choice(2), choice(3)], 'UTC');
  assert.deepEqual([choices.state, choices.clean, choices.recalls], ['first', 0, 0]);
});

test('a miss resets the schedule, whether typed or a choice', () => {
  const missed = lifecycle('A', taught, [recall(2), recall(3, false)], 'UTC');
  assert.deepEqual([missed.state, missed.clean, missed.due], ['settling', 0, '2026-11-04']);
  const wrongChoice = lifecycle('C', taught, [recall(2), recall(5), choice(6, false)], 'UTC');
  assert.deepEqual([wrongChoice.clean, wrongChoice.due], [0, '2026-11-07']);
  const again = lifecycle('A', taught, [recall(2), recall(3, false), recall(4), recall(5)], 'UTC');
  assert.equal(again.state, 'graduated');
  assert.equal(again.recallsToGraduate, 4, 'every typed recall until graduation is counted');
});

test('the check-up is one typed recall fourteen days after graduation; a miss reopens the word', () => {
  const graduated = [recall(2), recall(3)];
  const waiting = lifecycle('A', taught, graduated, 'UTC');
  assert.equal(waiting.due, '2026-11-' + String(3 + CHECKUP_DAYS));
  const early = lifecycle('A', taught, [...graduated, recall(10)], 'UTC');
  assert.equal(early.state, 'graduated', 'a recall before the check-up is due is not the check-up');
  const passed = lifecycle('A', taught, [...graduated, recall(17)], 'UTC');
  assert.deepEqual([passed.state, passed.due, passed.checkups], ['checked', null, [{ at: at(17), passed: true }]]);
  const failed = lifecycle('A', taught, [...graduated, recall(17, false)], 'UTC');
  assert.deepEqual([failed.state, failed.clean, failed.due], ['settling', 0, '2026-11-18']);
  assert.equal(failed.checkups[0].passed, false);
  assert.equal(failed.recallsToGraduate, 2, 'recalls to graduate count to the first graduation');
});

const target = (form: string): Target => ({
  id: 1, form, kind: 'word', gloss: null, pinyin: null, origin: 'saved', createdAt: at(1), hosted: null,
});
const lesson = (form: string, policy: PolicyId, when = taught): Signal => ({
  form, role: 'taught', at: when, eventId: 'l-' + form, practice: true, graduation: { policy, version: GRADUATION_VERSION }, sentences: ['我出去透透气。'],
});
const recalled = (form: string, day: number, correct = true): Signal => ({
  form, role: correct ? 'correct' : 'missed', at: at(day), eventId: 'r-' + form + day, practice: true, exercise: 'recall',
});

test('a word waiting for its first recall is first in line; a due recall ranks high; a waiting one is open but not asked for', () => {
  const day = (n: number) => new Date(at(n, 15));
  const needs: Signal[] = [{ form: '修复', role: 'needed', at: at(1), eventId: 'n' }];
  const first = rank([target('透透气'), target('修复')], [lesson('透透气', 'B'), ...needs], day(2), 'UTC');
  assert.equal(first[0].target.form, '透透气');
  assert.deepEqual([first[0].purpose, first[0].stage], ['settle', 'first']);
  assert.deepEqual(first[0].taughtWith, ['我出去透透气。']);
  const waiting = rank([target('透透气')], [lesson('透透气', 'B'), recalled('透透气', 2)], day(3), 'UTC');
  assert.equal(waiting.length, 0, 'B waits three days after the first clean recall');
  const fresh = Array.from({ length: 6 }, (_, i) => ({ ...target('新' + i) }));
  const busy = Array.from({ length: 8 }, (_, i) => lesson('词' + i, 'C', at(1, 9)));
  const admitted = new Map(fresh.map((t) => [t.form, 'explicit save']));
  assert.ok(rank(fresh, [], day(1), 'UTC', admitted).some((r) => r.fresh), 'with nothing open, admitted new words are offered');
  const blocked = rank([...fresh, ...busy.map((s) => target(s.form))], busy.flatMap((s) => [s, recalled(s.form, 1)]), day(1), 'UTC', admitted);
  assert.equal(blocked.filter((r) => r.fresh).length, 0, 'settling words not yet due still hold back new ones');
  const due = rank([target('透透气'), target('修复')], [lesson('透透气', 'B'), recalled('透透气', 2), ...needs], day(5), 'UTC');
  assert.deepEqual(due.map((r) => [r.target.form, r.stage]), [['透透气', 'scheduled'], ['修复', undefined]]);
  const checkup = rank([target('透透气')], [lesson('透透气', 'A'), recalled('透透气', 2), recalled('透透气', 3)], day(17), 'UTC');
  assert.equal(checkup[0].stage, 'checkup');
  assert.equal(checkup[0].pressing, false, 'a graduated word is not open work');
  assert.equal(rank([target('透透气')], [lesson('透透气', 'A'), recalled('透透气', 2), recalled('透透气', 3)], day(10), 'UTC').length, 0);
});

test('an exercise flagged as bad counts neither for nor against the learner', () => {
  const event = (id: string, kind: RecordedEvent['kind'], ref: string | null = null, day = 2): [string, RecordedEvent] =>
    [id, { id, seq: day, at: at(day), kind, surface: 'practice', ref, text: '', context: { kind: 'recall' }, targets: ['透透气'] }];
  const rule = (eventId: string, correct: boolean) =>
    ({ id: 'j-' + eventId, eventId, at: at(2), source: 'rule:recall-v1', body: { correct, targets: ['透透气'] } });
  const events = new Map([event('a1', 'answer'), event('a2', 'answer', null, 3), event('f1', 'flag', 'a2', 3)]);
  const signals = signalsFrom([rule('a1', true), rule('a2', false)], events);
  assert.deepEqual(signals.map((s) => s.eventId), ['a1'], 'the flagged miss is left out');
  const life = rank([target('透透气')], [lesson('透透气', 'A'), ...signals], new Date(at(3, 15)), 'UTC');
  assert.equal(life[0].stage, 'scheduled', 'the bad cue did not reset the schedule');
});

test('due recalls compete but a backlog takes at most about half the session', () => {
  const settle = { kind: 'recall' as const, purpose: 'settle' as const, stage: 'scheduled' as const };
  const other = { kind: 'recall' as const, purpose: 'review' as const };
  assert.equal(dueAllowed([]), 1);
  assert.equal(dueAllowed([settle]), 0);
  assert.equal(dueAllowed([settle, other]), 1);
  assert.equal(dueAllowed([settle, other, settle, other]), 1);
  assert.equal(dueAllowed([{ ...settle, stage: 'first' as const }]), 1, 'a taught word’s first recall is not part of the backlog');
});

test('the experiment report scores the assigned policy and every policy in shadow', () => {
  const signals = [
    lesson('甲', 'A'), recalled('甲', 1), recalled('甲', 2), recalled('甲', 3), recalled('甲', 17),
    lesson('乙', 'C'), recalled('乙', 2), recalled('乙', 5), recalled('乙', 12), recalled('乙', 26, false),
  ];
  const { rows, assigned, shadow } = graduationExperiment(signals, 'UTC');
  assert.deepEqual(rows.map((r) => [r.form, r.assigned]), [['甲', 'A'], ['乙', 'C']]);
  assert.equal(rows[0].under.A.state, 'checked');
  assert.equal(rows[0].under.C.state, 'settling', 'C would still want a recall seven days on');
  assert.deepEqual(assigned.A, { words: 1, graduated: 1, checkupsTaken: 1, checkupsPassed: 1, recallsToGraduate: [3] });
  assert.deepEqual(assigned.C, { words: 1, graduated: 1, checkupsTaken: 1, checkupsPassed: 0, recallsToGraduate: [3] });
  assert.equal(shadow.A.words, 2);
  assert.deepEqual(shadow.A.recallsToGraduate, [3, 2], 'under A, 乙 would have graduated after two');
});
