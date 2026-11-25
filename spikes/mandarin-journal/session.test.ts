import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { importHosted, type HostedExport } from './hosted-import.ts';
import { openJournal } from './journal.ts';
import { catalogue, demoFriend, demoTutor } from './practice.ts';
import { events } from './record.ts';
import {
  AHEAD, cardSeconds, cardTime, CHUNK_SECONDS, currentCard, extend, finishCard, finishesSession, formsFor, freshAllowed, needsCard,
  newSession, noteFailure, openRecalls, pendingRecalls, resume, NO_NEW_WITHIN, SESSION_SECONDS, stale,
  type Purpose, type Session,
} from './session.ts';
import type { TurnContext, TutorResult } from './tutor.ts';

const demo = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};
type Journal = ReturnType<typeof openJournal>;
async function settle(j: Journal) {
  for (let i = 0; i < 150 && j.busy(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(j.busy(), false, 'background work should finish');
}
function sandbox() {
  const folder = mkdtempSync(join(tmpdir(), 'journal-session-'));
  return { path: join(folder, 'journal.db'), done: () => rmSync(folder, { recursive: true, force: true }) };
}
/** Reads or rewrites the stored journal body between actions. */
type Stored = { practice: { mode: string; cards: { targets?: string[]; purpose: Purpose; teaching?: unknown[] }[]; session: Session } };
function body(path: string, change?: (b: Stored) => void): Stored {
  const db = new DatabaseSync(path);
  try {
    const parsed = JSON.parse(String(db.prepare('SELECT body FROM journal WHERE id=1').get()!.body));
    if (change) {
      change(parsed);
      db.prepare('UPDATE journal SET body=?,revision=revision+1 WHERE id=1').run(JSON.stringify(parsed));
    }
    return parsed;
  } finally {
    db.close();
  }
}
let made = 0;
/** A practice card the tutor would return, a typed recall that any purpose allows; each prompt is new. */
function recallCard(label = 'Pick'): TutorResult {
  return {
    reply: 'Intro.',
    action: {
      kind: 'practice',
      title: label,
      detail: 'Fits.',
      exercise: { kind: 'recall', prompt: label + ' ' + ++made + ': also, too.', accepted: [], choices: [], answer: '也', explanation: 'e' },
    },
  };
}
const card = (kind: 'choice' | 'open', purpose?: Purpose) => ({ kind, purpose });

test('cards are estimated by form, and real time counts up to a cap', () => {
  assert.equal(cardSeconds(card('choice')), 20);
  assert.equal(cardSeconds(card('open')), 90);
  assert.equal(cardSeconds({ kind: 'lesson', purpose: 'teach' }), 60, 'a lesson is a read');
  const now = new Date('2026-11-24T12:00:00Z');
  assert.equal(cardTime(card('choice'), '2026-11-24T11:59:30Z', now), 30);
  assert.equal(cardTime(card('choice'), '2026-11-24T10:00:00Z', now), 60, 'a walk away counts at most three estimates');
  assert.equal(cardTime(card('open'), null, now), 90);
});

test('a session ends when its time is spent, prepares ahead within the budget, and Keep going extends it', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const p = { mode: 'Daily mix', cards: [card('open')], index: 0, result: null, session: newSession(now) };
  assert.equal(needsCard(p), true);
  p.cards.push(card('choice'), card('choice'));
  assert.equal(p.cards.length - 1, AHEAD);
  assert.equal(needsCard(p), false, 'two ready ahead is enough');
  p.session.spent = SESSION_SECONDS - 100;
  p.session.shownAt = new Date(now.getTime() - 200_000).toISOString();
  finishCard(p, now);
  assert.equal(p.session.ended, true, 'the open card took the last of the time');
  assert.equal(p.index, 1);
  assert.equal(p.session.shownAt, null, 'the learner sees the end, not the prepared card behind it');
  assert.equal(needsCard(p), false, 'an ended session prepares nothing');
  extend(p.session, now);
  assert.equal(p.session.ended, false);
  assert.equal(p.session.budget, p.session.spent + CHUNK_SECONDS);
  assert.equal(needsCard(p), true);
  // Prepared cards that already fill the budget stop the worker.
  p.session.spent = p.session.budget - 30;
  assert.equal(needsCard(p), false);
  // Past mistakes replays what exists and prepares nothing.
  assert.equal(needsCard({ ...p, mode: 'Past mistakes', session: newSession(now) }), false);
});

test('finishing a card needs its session, and Try again resumes a paused session without adding time', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  assert.throws(() => finishCard({ mode: 'Daily mix', cards: [card('choice')], index: 0, result: null }, now), /No practice session/);
  const session = newSession(now);
  session.spent = 300;
  session.stopped = 'failed';
  session.failures = 2;
  resume(session, now);
  assert.equal(session.budget, SESSION_SECONDS);
  assert.equal(session.stopped, undefined);
  assert.equal(session.failures, 0);
  assert.throws(() => resume(session, now), /Only a session paused/);
  for (let i = 0; i < 7; i++) noteFailure(session, new Error('boom ' + i + ' ' + 'x'.repeat(300)), now);
  assert.equal(session.errors?.length, 5, 'only the latest few reasons are kept');
  assert.match(session.errors![4].error, /^Error: boom 6 x+$/);
  assert.equal(session.errors![4].error.length, 200);
  assert.equal(session.errors![4].at, now.toISOString());
});

test('one new word per four session cards, and none near the end of the box', () => {
  const at = new Date('2026-11-24T12:00:00Z');
  const deck = (cards: ReturnType<typeof card>[]) => ({ mode: 'Daily mix', cards, index: 0, result: null, session: newSession(at) });
  assert.equal(freshAllowed(deck([card('open', 'material')])), 1);
  assert.equal(freshAllowed(deck([card('choice', 'teach'), card('open', 'weakness')])), 0);
  assert.equal(freshAllowed(deck([card('choice', 'teach'), card('open'), card('open'), card('open')])), 1);
  const late = deck([card('open', 'material')]);
  late.session.spent = SESSION_SECONDS - NO_NEW_WITHIN + 1;
  late.index = 1;
  assert.equal(freshAllowed(late), 0, 'a lesson this late would leave its recall past the box');
});

test('the purpose decides the forms: recall for any target, a choice only for a confused contrast and never after teaching', () => {
  assert.deepEqual(formsFor('teach'), ['recall']);
  assert.deepEqual(formsFor('teach', true), ['recall'], 'never a choice right after teaching');
  assert.deepEqual(formsFor('review'), ['recall']);
  assert.deepEqual(formsFor('weakness'), ['recall']);
  assert.deepEqual(formsFor('weakness', true), ['recall', 'choice']);
  assert.deepEqual(formsFor('review', true), ['recall', 'choice']);
  assert.deepEqual(formsFor('material'), ['recall', 'open'], 'open production comes from material, not from a target');
});

test('an ended session is put away after an hour', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const s = newSession(new Date('2026-11-24T10:00:00Z'));
  assert.equal(stale(s, now), false, 'an open session is never put away');
  s.ended = true;
  assert.equal(stale(s, now), true);
});

test('the first card arrives in the action, the rest are prepared ahead, and the session ends with Keep going', async () => {
  const box = sandbox();
  let calls = 0;
  const j = openJournal(box.path, {
    ...demo,
    tutor: async (ctx) => (ctx.trigger === 'practice' ? (calls++, recallCard()) : demoTutor(ctx)),
  });
  try {
    await j.act({ id: randomUUID(), type: 'chat', message: '我想去外面透透气。', source: '' });
    let s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.ok(s.practice.card, 'the first card is in the response');
    assert.equal(calls, 1, 'one model call before the first card');
    await settle(j);
    s = j.get();
    assert.equal(s.practice.session?.ready, 2);
    assert.equal(calls, 3);
    const first = s.practice.card!;
    await j.act({ id: randomUUID(), type: 'answer', cardId: first.id, answer: '也' });
    // Nearly all the session's time is spent, and this card has been up for half a minute.
    body(box.path, (b) => {
      b.practice.session.spent = SESSION_SECONDS - 20;
      b.practice.session.shownAt = new Date(Date.now() - 30_000).toISOString();
    });
    assert.equal(j.get().practice.session?.last, true, 'the learner can see this card finishes the session');
    s = await j.act({ id: randomUUID(), type: 'next', cardId: first.id });
    assert.equal(s.practice.done, true);
    assert.equal(s.practice.card, null);
    assert.equal(s.practice.session?.ended, true);
    assert.equal(s.practice.session?.finished, 1);
    await settle(j);
    assert.equal(calls, 3, 'an ended session prepares nothing more');
    assert.equal(s.practice.session?.ready, 2, 'the cards already prepared wait for Keep going');
    // Practice without continue starts a fresh session, taking the cards already prepared.
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.equal(s.practice.session?.ended, false, 'without continue, a finished session starts afresh');
    assert.equal(s.practice.session?.finished, 0);
    body(box.path, (b) => (b.practice.session.spent = SESSION_SECONDS + 20));
    const current = j.get().practice.card!;
    await j.act({ id: randomUUID(), type: 'answer', cardId: current.id, answer: '也' });
    s = await j.act({ id: randomUUID(), type: 'next', cardId: current.id });
    assert.equal(s.practice.session?.ended, true);
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix', continue: true });
    assert.equal(s.practice.session?.ended, false);
    assert.equal(s.practice.session?.budgetMinutes, 15, 'Keep going adds five minutes past what was spent');
    assert.ok(s.practice.card, 'a card prepared earlier is in front of the learner at once');
    await settle(j);
    assert.equal(j.get().practice.session?.ready, 2);
  } finally {
    j.close();
    box.done();
  }
});

test('a card prepared in the background never overwrites an answer given meanwhile, and reaches a waiting learner', async () => {
  const box = sandbox();
  let release!: () => void;
  let gate = Promise.resolve();
  const j = openJournal(box.path, {
    ...demo,
    tutor: async (ctx) => {
      if (ctx.trigger !== 'practice') return demoTutor(ctx);
      await gate;
      return recallCard('Gate');
    },
  });
  try {
    await j.act({ id: randomUUID(), type: 'chat', message: '我想去外面透透气。', source: '' });
    gate = new Promise<void>((r) => (release = r));
    const opening = j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    release();
    let s = await opening;
    const first = s.practice.card!;
    // The worker is now preparing the next card behind a closed gate.
    gate = new Promise<void>((r) => (release = r));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(j.busy(), true);
    await j.act({ id: randomUUID(), type: 'answer', cardId: first.id, answer: '又' });
    s = await j.act({ id: randomUUID(), type: 'next', cardId: first.id });
    assert.equal(s.practice.card, null);
    assert.equal(s.practice.session?.waiting, true, 'the learner waits calmly for the next card');
    assert.equal(s.practice.done, false);
    release();
    await settle(j);
    s = j.get();
    assert.equal(s.attempts.length, 1, 'the answer given during generation survives');
    assert.equal(s.attempts[0].answer, '又');
    assert.ok(s.practice.card, 'the prepared card reaches the waiting learner');
    assert.equal(s.practice.session?.waiting, false);
    assert.ok(body(box.path).practice.session.shownAt, 'its time counts from when it appeared');
    const answers = events(new DatabaseSync(box.path, { readOnly: true })).filter((e) => e.kind === 'answer');
    assert.equal(answers.length, 1, 'the answer event is in the record');

    // A card prepared for a session the learner has left is dropped.
    gate = new Promise<void>((r) => (release = r));
    const current = s.practice.card!;
    await j.act({ id: randomUUID(), type: 'answer', cardId: current.id, answer: '也' });
    await j.act({ id: randomUUID(), type: 'next', cardId: current.id });
    await new Promise((r) => setTimeout(r, 30));
    await j.act({ id: randomUUID(), type: 'practice', mode: 'Past mistakes' });
    const pastCards = body(box.path).practice.cards.length;
    release();
    await settle(j);
    assert.equal(body(box.path).practice.mode, 'Past mistakes');
    assert.equal(body(box.path).practice.cards.length, pastCards);
  } finally {
    j.close();
    box.done();
  }
});

test('failing generation stops the session instead of trapping it, and Keep going tries again', async () => {
  const box = sandbox();
  let failing = false;
  const j = openJournal(box.path, {
    ...demo,
    tutor: async (ctx) => {
      if (ctx.trigger !== 'practice') return demoTutor(ctx);
      if (failing) throw new Error('offline');
      return recallCard();
    },
  });
  try {
    await j.act({ id: randomUUID(), type: 'chat', message: '我想去外面透透气。', source: '' });
    failing = true;
    let s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.equal(s.practice.card, null);
    await settle(j);
    s = j.get();
    assert.equal(s.practice.session?.stopped, 'failed');
    assert.equal(s.practice.done, true, 'the learner sees an end state, not an endless wait');
    assert.match(s.notice, /could not prepare/);
    const stopped = body(box.path).practice.session;
    assert.deepEqual(stopped.errors?.map((e) => e.error), ['Error: offline', 'Error: offline'], 'each failure keeps its reason');
    assert.ok(stopped.errors?.every((e) => !Number.isNaN(Date.parse(e.at))));
    failing = false;
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix', continue: true });
    assert.ok(s.practice.card);
    assert.equal(s.practice.session?.stopped, null);
    assert.equal(body(box.path).practice.session.budget, SESSION_SECONDS, 'Try again resumes without adding time');
    assert.equal(body(box.path).practice.session.id, stopped.id, 'the same session continues');
  } finally {
    j.close();
    box.done();
  }
});

const hosted = (over: Partial<HostedExport['words'][number]> & { hanzi: string }): HostedExport['words'][number] => ({
  pinyin: null, meaning: null, mode: 'practice', inStash: true, dismissedAt: null, addedAt: null, lastPractisedAt: null,
  dueAt: null, intervalHours: null, attempts: 0, incorrect: 0, lastIncorrectAt: null, recentMistakes: [], ...over,
});

test('each card carries its purpose, a new word gets a lesson, and every other target is tested by typed recall', async () => {
  const box = sandbox();
  const db = new DatabaseSync(box.path);
  importHosted(db, {
    exportedAt: '2026-11-20T00:00:00.000Z',
    learner: 'test',
    words: [
      hosted({ hanzi: '分心', meaning: 'be distracted', dueAt: '2026-11-01T00:00:00.000Z', intervalHours: 240, attempts: 6, incorrect: 2 }),
      hosted({ hanzi: '修复', meaning: 'restore', dueAt: '2026-11-01T00:00:00.000Z', intervalHours: 240, attempts: 4, incorrect: 1 }),
    ],
  });
  db.close();
  const asked: { form: string; message: string; forms?: string[] }[] = [];
  const j = openJournal(box.path, {
    ...demo,
    tutor: async (ctx) => {
      if (ctx.trigger !== 'practice') return demoTutor(ctx);
      asked.push({ form: ctx.source.match(/^Target: (\S+)/)?.[1] ?? 'material', message: ctx.message, forms: ctx.exerciseForms });
      return recallCard();
    },
  });
  try {
    // 分心 becomes a weakness from the learner's own Chinese; 透透气 is saved and never taught.
    await j.act({ id: randomUUID(), type: 'chat', message: '我在图书馆老是 get distracted。', source: '' });
    await j.act({ id: randomUUID(), type: 'reflect', source: '' });
    await j.act({ id: randomUUID(), type: 'addWord', text: '透透气', context: '图书馆太闷了' });
    await settle(j);
    const ranked = Object.fromEntries(j.priority().map((r) => [r.target.form, r.purpose]));
    assert.deepEqual(ranked, { 分心: 'weakness', 透透气: 'teach', 修复: 'review' });
    await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    await settle(j);
    const cards = body(box.path).practice.cards;
    assert.deepEqual(
      cards.map((c) => [c.targets?.[0], c.purpose]),
      [['分心', 'weakness'], ['透透气', 'teach'], ['修复', 'review']],
    );
    assert.ok(cards[1].teaching?.length, 'the new word is taught in beats');
    assert.equal((cards[1] as { kind?: string }).kind, 'lesson', 'and asked nothing on its lesson card');
    const message = Object.fromEntries(asked.map((a) => [a.form, a.message]));
    assert.match(message['分心'], /typed recall/);
    assert.equal(message['透透气'], undefined, 'no exercise is generated with the lesson');
    assert.match(message["修复"], /recall exercise/);
    for (const a of asked.filter((x) => x.form !== 'material')) assert.deepEqual(a.forms, ['recall'], a.form + ' may only be recalled');
  } finally {
    j.close();
    box.done();
  }
});

test('a session that keeps getting nothing new stops after a few tries and says nothing is left', async () => {
  const box = sandbox();
  let practiceCalls = 0;
  const j = openJournal(box.path, {
    ...demo,
    tutor: async (ctx: TurnContext) => {
      if (ctx.trigger !== 'practice') return demoTutor(ctx);
      practiceCalls++;
      return { reply: '', action: null };
    },
  });
  try {
    for (const message of ['我在图书馆看书。', '下午我去公园散步。', '晚上我做了饺子。', '周末我想去爬山。', '我最近在学吉他。'])
      await j.act({ id: randomUUID(), type: 'chat', message, source: '' });
    await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    await settle(j);
    const session = j.get().practice.session!;
    assert.equal(session.stopped, 'exhausted');
    assert.ok(practiceCalls <= 3, `stopped after ${practiceCalls} empty generations`);
  } finally {
    j.close();
    box.done();
  }
});

test('a deck saved before sessions existed is put away, and the next visit starts a session from current material', async () => {
  const box = sandbox();
  const j0 = openJournal(box.path, { ...demo, tutor: async (ctx) => (ctx.trigger === 'practice' ? recallCard() : demoTutor(ctx)) });
  await j0.act({ id: randomUUID(), type: 'chat', message: '我想去外面透透气。', source: '' });
  await settle(j0);
  j0.close();
  // The shape practice had before #624: starter cards and one personal card, no session.
  const personal = { id: 'personal-1', kind: 'choice', source: 'Chat', prompt: '他＿＿去了。', accepted: [], choices: ['也', '又'], answer: '也', explanation: 'e' };
  body(box.path, (b) => {
    b.practice = { started: true, mode: 'Daily mix', cards: [...catalogue.slice(0, 3), personal], index: 0, result: null } as unknown as Stored['practice'];
  });
  const j = openJournal(box.path, { ...demo, tutor: async (ctx) => (ctx.trigger === 'practice' ? recallCard() : demoTutor(ctx)) });
  try {
    let s = j.get();
    assert.equal(s.practice.card, null, 'the stale deck is not served as if current');
    assert.equal(s.practice.done, false, 'the practice page starts a session on its own');
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.ok(s.practice.session, 'a proper session starts');
    assert.equal(s.practice.card?.id, personal.id, 'the unattempted personal card comes back first');
    await settle(j);
    const ids = body(box.path).practice.cards.map((c) => (c as { id?: string }).id);
    assert.ok(!ids.some((id) => catalogue.some((seed) => seed.id === id)), 'starter cards are dropped');
  } finally {
    j.close();
    box.done();
  }
});

test('an ended session left past the stale window shows no card, and its prepared card returns in the next session', async () => {
  const box = sandbox();
  const tutor = async (ctx: TurnContext) => (ctx.trigger === 'practice' ? recallCard() : demoTutor(ctx));
  const j0 = openJournal(box.path, { ...demo, tutor });
  await j0.act({ id: randomUUID(), type: 'chat', message: '我想去外面透透气。', source: '' });
  await settle(j0);
  j0.close();
  // The live journal on 2026-11-24: the time ran out after card 10 while card 11 was already prepared.
  const prepared = { id: 'prepared-1', kind: 'open', source: 'Reading', prompt: '用「况且」说一句。', accepted: [], choices: [], answer: 'a', explanation: 'e', purpose: 'material' };
  const done = { ...prepared, id: 'done-1', prompt: '做完的。' };
  const lastAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  body(box.path, (b) => {
    b.practice = {
      started: true, mode: 'Daily mix', cards: [done, prepared], index: 1, result: null,
      session: { ...newSession(new Date(lastAt)), spent: 640, budget: 600, ended: true, lastAt, shownAt: null },
    } as unknown as Stored['practice'];
  });
  const j = openJournal(box.path, { ...demo, tutor });
  try {
    let s = j.get();
    assert.equal(s.practice.card, null, 'the put-away session serves no card the server would reject');
    assert.equal(s.practice.done, false, 'the practice page starts a fresh session on its own');
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.equal(s.practice.card?.id, prepared.id, 'the prepared card comes back first');
    s = await j.act({ id: randomUUID(), type: 'answer', cardId: prepared.id, answer: '周二人少，况且便宜。' });
    assert.ok(s.practice.result, 'the answer is accepted');
  } finally {
    j.close();
    box.done();
  }
});

test('a stored Build vocabulary session is put away on open, and its cards that taught on the exercise are dropped', async () => {
  const box = sandbox();
  const tutor = async (ctx: TurnContext) => (ctx.trigger === 'practice' ? recallCard() : demoTutor(ctx));
  const j0 = openJournal(box.path, { ...demo, tutor });
  await j0.act({ id: randomUUID(), type: 'chat', message: '我想去外面透透气。', source: '' });
  await settle(j0);
  j0.close();
  // The shape a Build vocabulary session had: a card teaching on the exercise itself.
  const taughtOnCard = (id: string) => ({
    id, kind: 'recall', source: 'Chat', prompt: 'Get some air: ' + id, accepted: [], choices: [], answer: '透透气', explanation: 'e',
    introduction: '透透气 is a short break outside.', purpose: 'material',
  });
  const queued = { id: 'queued', kind: 'recall', source: 'Chat', prompt: 'Also, too.', accepted: [], choices: [], answer: '也', explanation: 'e' };
  body(box.path, (b) => {
    const session = { id: 'old', startedAt: new Date().toISOString(), budget: 600, spent: 0, estimated: 0, shownAt: null, lastAt: new Date().toISOString(), failures: 0, attempts: 0, skipped: [], uses: {} };
    b.practice = { mode: 'Build vocabulary', cards: [taughtOnCard('front'), taughtOnCard('next')], index: 0, result: null, session } as unknown as Stored['practice'];
    (b as unknown as { pending: unknown[] }).pending = [taughtOnCard('pending'), queued];
  });
  const j = openJournal(box.path, { ...demo, tutor });
  try {
    let s = j.get();
    assert.deepEqual([s.practice.mode, s.practice.card], ['Daily mix', null], 'the old session is put away');
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.equal(s.practice.card?.id, 'queued', 'an ordinary queued card still comes back');
    await settle(j);
    const ids = body(box.path).practice.cards.map((c) => (c as { id?: string }).id);
    assert.ok(!ids.some((id) => ['front', 'next', 'pending'].includes(id!)), 'cards that taught on the exercise never return');
  } finally {
    j.close();
    box.done();
  }
});

type Lesson = { kind: 'lesson' | 'recall' | 'open'; purpose?: Purpose; stage?: 'first'; targets?: string[] };
test('a lesson’s recall waits two other cards, and past the box the session finishes it before ending', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const lesson: Lesson = { kind: 'lesson', purpose: 'teach', targets: ['透透气'] };
  const other: Lesson = { kind: 'open', purpose: 'material' };
  const recall: Lesson = { kind: 'recall', purpose: 'settle', stage: 'first', targets: ['透透气'] };
  assert.deepEqual(pendingRecalls([lesson, other]), [{ form: '透透气', ready: false }]);
  assert.deepEqual(pendingRecalls([lesson, other, other]), [{ form: '透透气', ready: true }]);
  assert.deepEqual(pendingRecalls([lesson, other, other, recall]), []);
  const p = { mode: 'Daily mix', cards: [lesson, other, other, recall], index: 1, result: null, session: newSession(now) };
  assert.deepEqual(openRecalls(p), ['透透气']);
  p.session.spent = SESSION_SECONDS - 1;
  assert.equal(finishesSession(p, now), false, 'finishing this card leaves the recall open');
  finishCard(p, now);
  assert.equal(p.session.ended, undefined, 'the box is spent, but open work keeps the session going');
  assert.equal(currentCard(p), recall, 'the recall comes next, ahead of the other prepared card');
  assert.equal(needsCard(p), false);
  assert.equal(finishesSession(p, now), true);
  finishCard(p, now);
  assert.equal(p.session.ended, true);
  assert.equal(p.cards[p.index], other, 'the other card waits for Keep going');
  // With no recall prepared yet, the session waits for it and shows nothing else.
  const q = { mode: 'Daily mix', cards: [lesson, other, other], index: 1, result: null, session: newSession(now) };
  q.session.spent = SESSION_SECONDS;
  finishCard(q, now);
  assert.equal(currentCard(q), undefined);
  assert.equal(q.session.shownAt, null);
  assert.equal(needsCard(q), true, 'past the box, only the closing recall is still prepared');
});

/** A tutor whose material cards are fresh recalls and whose recall of 透透气 can be held back. */
function lessonTutor(hold?: () => Promise<void>) {
  return {
    ...demo,
    tutor: async (ctx: TurnContext) => {
      if (ctx.trigger !== 'practice') return demoTutor(ctx);
      if (!ctx.source.startsWith('Target: 透透气')) return recallCard('Material');
      await hold?.();
      return {
        reply: '',
        action: { kind: 'practice' as const, title: 'Recall', detail: 'd', exercise: { kind: 'recall' as const, prompt: 'Step out for some air. ' + ++made, accepted: [], choices: [], answer: '透透气', explanation: 'e' } },
      };
    },
  };
}
async function startWithLesson(j: Journal) {
  await j.act({ id: randomUUID(), type: 'addWord', text: '透透气' });
  for (const message of ['我在图书馆看书。', '下午我去公园散步。', '晚上我做了饺子。'])
    await j.act({ id: randomUUID(), type: 'chat', message, source: '' });
  await settle(j);
  const s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
  assert.equal(s.practice.card?.kind, 'lesson');
  return s.practice.card!;
}
async function answerAndNext(j: Journal, answer = '也') {
  const card = j.get().practice.card!;
  await j.act({ id: randomUUID(), type: 'answer', cardId: card.id, answer });
  return j.act({ id: randomUUID(), type: 'next', cardId: card.id });
}

test('a taught word is never checked right after its lesson: it returns as typed recall after two other cards', async () => {
  const box = sandbox();
  const j = openJournal(box.path, lessonTutor());
  try {
    const lesson = await startWithLesson(j);
    await j.act({ id: randomUUID(), type: 'next', cardId: lesson.id });
    await settle(j);
    let s = j.get();
    assert.equal(s.practice.card?.purpose, 'material', 'the session moves on after the lesson');
    await answerAndNext(j);
    await settle(j);
    assert.equal(j.get().practice.card?.purpose, 'material');
    await answerAndNext(j);
    await settle(j);
    s = j.get();
    assert.equal(s.practice.card?.kind, 'recall');
    assert.equal(s.practice.card?.purpose, 'settle');
    s = await j.act({ id: randomUUID(), type: 'answer', cardId: s.practice.card!.id, answer: '透透气' });
    assert.equal(s.practice.result?.correct, true);
    const answer = events(new DatabaseSync(box.path, { readOnly: true })).findLast((e) => e.kind === 'answer')!;
    assert.deepEqual([answer.targets, answer.context.stage], [['透透气'], 'first']);
    assert.notEqual(j.priority().find((r) => r.target.form === '透透气')?.stage, 'first', 'the first recall is done');
  } finally {
    j.close();
    box.done();
  }
});

test('past the box the session waits for a taught word’s recall and ends after it; Keep going serves the rest', async () => {
  const box = sandbox();
  let release!: () => void;
  let gate: Promise<void> = new Promise((r) => (release = r));
  const j = openJournal(box.path, lessonTutor(() => gate));
  try {
    const lesson = await startWithLesson(j);
    await j.act({ id: randomUUID(), type: 'next', cardId: lesson.id });
    // The worker is now preparing the recall behind a closed gate.
    await new Promise((r) => setTimeout(r, 50));
    // A moment before the box is spent: finishing the card in front crosses it.
    body(box.path, (b) => (b.practice.session.spent = SESSION_SECONDS - 0.01));
    assert.equal(j.get().practice.session?.last, false, 'this card does not end the session while the recall is open');
    let s = await answerAndNext(j);
    assert.equal(s.practice.session?.ended, false);
    assert.equal(s.practice.card, null, 'no other card is shown while wrapping up');
    assert.equal(s.practice.session?.waiting, true);
    release();
    await settle(j);
    s = j.get();
    assert.equal(s.practice.card?.purpose, 'settle', 'the recall arrives in front of the prepared card');
    assert.equal(s.practice.session?.last, true);
    s = await answerAndNext(j, '透透气');
    assert.equal(s.practice.session?.ended, true);
    assert.equal(s.practice.done, true);
    assert.ok((s.practice.session?.ready ?? 0) >= 1, 'the card prepared earlier waits for Keep going');
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix', continue: true });
    assert.equal(s.practice.card?.purpose, 'material');
  } finally {
    j.close();
    box.done();
  }
});

test('a learner who leaves before a taught word’s recall finds it first in line next session', async () => {
  const box = sandbox();
  const j = openJournal(box.path, lessonTutor());
  try {
    const lesson = await startWithLesson(j);
    await j.act({ id: randomUUID(), type: 'next', cardId: lesson.id });
    await settle(j);
    // The session is left behind before the recall; its unanswered cards are gone with it.
    body(box.path, (b) => {
      b.practice = { mode: 'Daily mix', cards: [], index: 0, result: null } as unknown as Stored['practice'];
      (b as unknown as { pending: unknown[] }).pending = [];
    });
    const s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.equal(s.practice.card?.purpose, 'settle');
    assert.match(s.practice.card?.prompt ?? '', /Step out for some air/);
  } finally {
    j.close();
    box.done();
  }
});

test('a flagged exercise is marked on its attempt and recorded, and leaves Past mistakes', async () => {
  const box = sandbox();
  const j = openJournal(box.path, lessonTutor());
  try {
    const lesson = await startWithLesson(j);
    await j.act({ id: randomUUID(), type: 'next', cardId: lesson.id });
    await settle(j);
    const card = j.get().practice.card!;
    await j.act({ id: randomUUID(), type: 'answer', cardId: card.id, answer: '不知道' });
    assert.equal(j.get().practice.canReviewMisses, true);
    const attempt = j.get().attempts.at(-1)!;
    const s = await j.act({ id: randomUUID(), type: 'flagExercise', attemptId: attempt.id });
    assert.ok(s.attempts.at(-1)!.flagged);
    assert.equal(s.practice.canReviewMisses, false);
    const flag = events(new DatabaseSync(box.path, { readOnly: true })).find((e) => e.kind === 'flag')!;
    assert.equal(flag.ref, attempt.id);
    const past = await j.act({ id: randomUUID(), type: 'practice', mode: 'Past mistakes' });
    assert.equal(past.practice.card, null, 'a flagged miss is not replayed');
  } finally {
    j.close();
    box.done();
  }
});
