import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { importHosted, type HostedExport } from './hosted-import.ts';
import { openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import { rank, signalsFrom, type Signal } from './priority.ts';
import { events, judgments, targets, type RecordedEvent, type Target } from './record.ts';
import { notice } from './situations/notice.ts';
import type { TurnContext } from './tutor.ts';

const demo = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};
type Journal = ReturnType<typeof openJournal>;
async function settle(j: Journal) {
  for (let i = 0; i < 100 && j.busy(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(j.busy(), false, 'background work should finish');
}
function sandbox() {
  const folder = mkdtempSync(join(tmpdir(), 'journal-record-'));
  return { path: join(folder, 'journal.db'), done: () => rmSync(folder, { recursive: true, force: true }) };
}
const read = <T>(path: string, f: (db: DatabaseSync) => T) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return f(db);
  } finally {
    db.close();
  }
};
const hosted = (over: Partial<HostedExport['words'][number]> & { hanzi: string }): HostedExport['words'][number] => ({
  pinyin: null, meaning: null, mode: 'practice', inStash: true, dismissedAt: null, addedAt: null, lastPractisedAt: null,
  dueAt: null, intervalHours: null, attempts: 0, incorrect: 0, lastIncorrectAt: null, recentMistakes: [], ...over,
});

test('chat is read through its reflection, so a reach the learner was shown links to the word already held', async () => {
  const box = sandbox();
  const db = new DatabaseSync(box.path);
  importHosted(db, {
    exportedAt: '2026-11-20T00:00:00.000Z',
    learner: 'test',
    words: [hosted({ hanzi: '分心', meaning: 'be distracted', dueAt: '2026-11-01T00:00:00.000Z', intervalHours: 240, attempts: 6, incorrect: 2 })],
  });
  db.close();
  const j = openJournal(box.path, demo);
  try {
    await j.act({ id: randomUUID(), type: 'chat', message: '我在图书馆老是 get distracted。', source: '' });
    await settle(j);
    assert.equal(read(box.path, judgments).length, 0, 'a chat line waits for its reflection');
    await j.act({ id: randomUUID(), type: 'reflect', source: '' });
    await settle(j);
    const [chat, event] = read(box.path, events);
    assert.equal(chat.kind, 'chat');
    assert.equal(event.kind, 'reflect');
    assert.equal(event.text, '我在图书馆老是 get distracted。');
    assert.match(String(event.context.tutorSaid), /分心/, 'the judgment sees the takeaways the learner read');
    const [judgment] = read(box.path, judgments);
    assert.equal(judgment.eventId, event.id);
    assert.equal(judgment.source, 'demo:notice-v1');
    const target = read(box.path, targets).find((t) => t.form === '分心')!;
    assert.equal(target.origin, 'imported', 'the need attaches to the imported word rather than creating another');
    const top = j.priority()[0];
    assert.equal(top.target.form, '分心');
    assert.match(top.reasons.join(' '), /needed in “get distracted”/);
    assert.match(top.reasons.join(' '), /also in the old app/);
  } finally {
    j.close();
    box.done();
  }
});

test('converted history becomes events without times, and the model never reads it', async () => {
  const box = sandbox();
  const seed = new DatabaseSync(box.path);
  seed.exec('CREATE TABLE journal(id INTEGER PRIMARY KEY, revision INTEGER, body TEXT)');
  seed.prepare('INSERT INTO journal VALUES (1, 3, ?)').run(
    JSON.stringify({
      tutor: [{ role: 'user', text: 'How do I say get distracted?' }],
      activeThreadId: 'first',
      threads: [{ id: 'first', title: 'Library', turns: [{ id: 't1', role: 'user', text: '我老是 get distracted。' }] }],
      reflections: [], annotationThreads: [], activity: [], saved: [], pending: [], notice: '',
      reading: { documentId: 'river', positions: {}, annotations: [], imports: [] },
      attempts: [{ id: 'a1', card: { id: 'c', kind: 'choice', prompt: 'p', choices: ['修理', '修复'], answer: '修复', explanation: 'e', source: 's', targets: ['修复'] }, answer: '修理', result: { correct: false, feedback: 'e' } }],
      practice: { mode: 'Daily mix', cards: [], index: 0, result: null },
    }),
  );
  seed.close();
  const j = openJournal(box.path, demo);
  try {
    await settle(j);
    const converted = read(box.path, events);
    assert.deepEqual(converted.map((e) => e.kind).sort(), ['answer', 'ask', 'chat']);
    assert.ok(converted.every((e) => e.at === null));
    const all = read(box.path, judgments);
    assert.deepEqual(all.map((x) => x.source), ['rule:choice-v1'], 'only the free rule judgment, no model reading');
    assert.equal(j.priority()[0]?.target.form, undefined, 'no target exists for an unsaved word');
    j.close();
    // Reopening does not convert twice.
    const again = openJournal(box.path, demo);
    again.close();
    assert.equal(read(box.path, events).length, converted.length);
  } finally {
    box.done();
  }
});

test('daily mix teaches a saved word on a lesson card that asks nothing, and finishing it records the lesson with an assigned policy', async () => {
  const box = sandbox();
  const asked: TurnContext[] = [];
  const j = openJournal(box.path, {
    ...demo,
    tutor: async (ctx: TurnContext) => {
      if (ctx.trigger === 'teach') asked.push(ctx);
      return demoTutor(ctx);
    },
  });
  try {
    await j.act({ id: randomUUID(), type: 'addWord', text: '报备', context: '朋友说出去玩要跟男朋友报备' });
    await settle(j);
    assert.match(j.priority()[0].reasons.join(), /saved, not practiced yet/);
    const s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    const card = s.practice.card!;
    assert.equal(card.kind, 'lesson', 'the word is taught on a card of its own');
    assert.equal(card.purpose, 'teach');
    assert.equal(card.teaching![0].parts[0].kind, 'text', 'the lesson opens with a scene');
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].teach, {
      form: '报备',
      pinyin: 'bàobèi',
      gloss: 'Notify someone for the record or to keep them informed.',
      encounter: '朋友说出去玩要跟男朋友报备',
      savedExample: {
        text: '周末有访客，需要提前向物业报备。',
        translation: 'If you have visitors this weekend, you need to notify the property manager in advance.',
      },
    });
    await assert.rejects(j.act({ id: randomUUID(), type: 'answer', cardId: card.id, answer: '报备' }), /nothing to answer/);
    await j.act({ id: randomUUID(), type: 'next', cardId: card.id });
    await settle(j);
    const recorded = read(box.path, events);
    assert.equal(recorded.filter((e) => e.kind === 'answer').length, 0, 'no check right after teaching');
    const lesson = recorded.find((e) => e.kind === 'lesson')!;
    assert.deepEqual(lesson.targets, ['报备']);
    const graduation = lesson.context.graduation as { policy: string; version: string };
    assert.ok(['A', 'B', 'C'].includes(graduation.policy), 'one policy is assigned at random');
    assert.equal(graduation.version, 'graduation-v1');
    assert.ok((lesson.context.sentences as string[]).length, 'the taught sentences stay with the lesson');
    assert.equal(read(box.path, judgments).length, 0, 'the assignment is part of the event, not a rerunnable judgment');
    const ranked = j.priority().find((r) => r.target.form === '报备')!;
    assert.equal(ranked.purpose, 'settle');
    assert.equal(ranked.stage, 'first');
  } finally {
    j.close();
    box.done();
  }
});

test('when teaching fails, no lesson is shown and the word stays new', async () => {
  const box = sandbox();
  const j = openJournal(box.path, {
    ...demo,
    tutor: async (ctx: TurnContext) => {
      if (ctx.trigger === 'teach') throw new Error('offline');
      return demoTutor(ctx);
    },
  });
  try {
    await j.act({ id: randomUUID(), type: 'addWord', text: '分心' });
    await settle(j);
    await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    await settle(j);
    const stored = j.get();
    assert.ok(!stored.practice.card || stored.practice.card.kind !== 'lesson');
    assert.equal(read(box.path, events).filter((e) => e.kind === 'lesson').length, 0);
    assert.equal(j.priority().find((r) => r.target.form === '分心')?.purpose, 'teach', 'the word is still waiting to be taught');
  } finally {
    j.close();
    box.done();
  }
});

const target = (form: string, over: Partial<Target> = {}): Target => ({
  id: 1, form, kind: 'word', gloss: null, pinyin: null, origin: 'noticed', createdAt: '2026-11-01T00:00:00.000Z', hosted: null, ...over,
});
const at = (day: number) => new Date(Date.UTC(2026, 10, day, 12)).toISOString();
const now = new Date(Date.UTC(2026, 10, 23, 12));

test('a weakness gets a bounded number of clean days, then graduates', () => {
  const need: Signal = { form: '修复', role: 'needed', at: at(18), eventId: 'e1' };
  const open = rank([target('修复')], [need], now);
  assert.ok(open[0].score > 2);
  const once = rank([target('修复')], [need, { form: '修复', role: 'correct', at: at(19), eventId: 'e2' }], now);
  assert.ok(once[0].score < open[0].score);
  const twice = rank(
    [target('修复')],
    [need, { form: '修复', role: 'correct', at: at(19), eventId: 'e2' }, { form: '修复', role: 'used', at: at(21), eventId: 'e3' }],
    now,
  );
  assert.equal(twice.length, 0, 'two clean days after the latest weakness retire it');
  const sameDay = rank(
    [target('修复')],
    [need, { form: '修复', role: 'correct', at: at(19), eventId: 'e2' }, { form: '修复', role: 'correct', at: at(19), eventId: 'e3' }],
    now,
  );
  assert.equal(sameDay.length, 1, 'repeats on one day count once');
});

test('a correct choice is recognition and never counts toward graduation; a wrong one is still a miss', () => {
  const event = (id: string, day: number, kind: 'choice' | 'recall'): [string, RecordedEvent] =>
    [id, { id, seq: day, at: at(day), kind: 'answer', surface: 'practice', ref: null, text: '修复', context: { kind }, targets: ['修复'] }];
  const rule = (eventId: string, kind: 'choice' | 'recall', correct: boolean) =>
    ({ id: 'j-' + eventId, eventId, at: at(23), source: 'rule:' + kind + '-v1', body: { correct, targets: ['修复'] } });
  const evs = new Map([event('c1', 19, 'choice'), event('c2', 20, 'choice'), event('c3', 21, 'choice'), event('r1', 19, 'recall'), event('r2', 21, 'recall')]);
  const roles = signalsFrom([rule('c1', 'choice', true), rule('c3', 'choice', false), rule('r1', 'recall', true)], evs).map((s) => s.role);
  assert.deepEqual(roles, ['recognized', 'missed', 'correct']);
  const need: Signal = { form: '修复', role: 'needed', at: at(18), eventId: 'n' };
  const choices = signalsFrom([rule('c1', 'choice', true), rule('c2', 'choice', true)], evs);
  const afterChoices = rank([target('修复')], [need, ...choices], now);
  assert.equal(afterChoices.length, 1, 'two correct choices on two days retire nothing');
  assert.doesNotMatch(afterChoices[0].reasons.join(), /clean day/);
  const recalls = signalsFrom([rule('r1', 'recall', true), rule('r2', 'recall', true)], evs);
  assert.equal(rank([target('修复')], [need, ...recalls], now).length, 0, 'two correct recalls on two days do');
});

test('target use in an open answer is a signal for priority, never for graduation', () => {
  const need: Signal = { form: '体面', role: 'needed', at: at(18), eventId: 'n' };
  const openUse = (day: number): Signal => ({ form: '体面', role: 'used', at: at(day), eventId: 'o' + day, practice: true });
  const prompted = rank([target('体面')], [need, openUse(19), openUse(21)], now);
  assert.equal(prompted.length, 1, 'natural use in open answers does not retire a weakness');
  const ownUse = (day: number): Signal => ({ form: '体面', role: 'used', at: at(day), eventId: 'u' + day });
  assert.equal(rank([target('体面')], [need, ownUse(19), ownUse(21)], now).length, 0, 'the learner’s own use elsewhere still does');
  const avoided: Signal = { form: '潜台词', role: 'avoided', at: at(20), eventId: 'a', practice: true };
  assert.equal(rank([target('潜台词')], [avoided], now).length, 0, 'an open answer that did without the expression is no weakness');
  const flawed: Signal = { form: '人家', role: 'flawed', at: at(20), eventId: 'f', practice: true };
  const raised = rank([target('人家')], [flawed], now);
  assert.equal(raised[0]?.pressing, true, 'a flawed use in an open answer raises the target');
  assert.equal(raised[0].purpose, 'weakness');
});

test('a choice is allowed only for a contrast the learner has demonstrably confused', () => {
  const slip: Signal = { form: '有意', role: 'needed', at: at(18), eventId: 's', evidence: '有意思的避开下乡' };
  const fresh = rank([target('有意')], [slip], now)[0];
  assert.equal(fresh.purpose, 'weakness');
  assert.equal(fresh.contrast, undefined, 'a slip comes back first as recall');
  const recalled: Signal = { form: '有意', role: 'correct', at: at(19), eventId: 'r', practice: true };
  assert.equal(rank([target('有意')], [slip, recalled], now)[0].contrast, true, 'after a recall, the confused contrast may be a choice');
  const miss = (day: number): Signal => ({ form: '修复', role: 'missed', at: at(day), eventId: 'm' + day, practice: true });
  assert.equal(rank([target('修复')], [miss(19)], now)[0].contrast, undefined);
  const twice = rank([target('修复')], [miss(19), miss(20)], now)[0];
  assert.equal(twice.contrast, true, 'a repeated miss is a demonstrated confusion');
  assert.equal(twice.purpose, 'review');
});

test('new signals outweigh the old app, whose misses still order its due words', () => {
  const due = { mode: 'practice', inStash: true, dismissed: false, addedAt: null, lastPractisedAt: null, dueAt: at(10), intervalHours: 240, lastIncorrectAt: null, recentMistakes: [] };
  const ranked = rank(
    [
      target('稳', { origin: 'imported', hosted: { ...due, attempts: 20, incorrect: 0 } }),
      target('修复', { origin: 'imported', hosted: { ...due, attempts: 20, incorrect: 6, lastIncorrectAt: at(15) } }),
      target('透透气'),
      target('报备', { origin: 'imported', hosted: { ...due, dismissed: true, attempts: 3, incorrect: 3 } }),
    ],
    [{ form: '透透气', role: 'flawed', at: at(5), eventId: 'e' }],
    now,
  );
  assert.deepEqual(ranked.map((r) => r.target.form), ['透透气', '修复', '稳']);
  assert.ok(ranked[1].score <= 0.3, 'the hosted SRS contributes at most 0.3');
});

test('an unstudied stash word waits to be taught; unstudied bulk words are not imported', () => {
  const box = sandbox();
  const db = new DatabaseSync(box.path);
  try {
    importHosted(db, {
      exportedAt: now.toISOString(),
      learner: 'test',
      words: [hosted({ hanzi: '钻空子', mode: 'unstudied' }), hosted({ hanzi: '公共汽车', mode: 'unstudied', inStash: false }), hosted({ hanzi: '稳', inStash: false, dueAt: at(10), attempts: 10, incorrect: 3 })],
    });
    const ranked = rank(targets(db), [], now);
    assert.deepEqual(ranked.map((r) => r.target.form), ['钻空子', '稳']);
    assert.match(ranked[0].reasons.join(), /in the old stash, never taught/);
    assert.ok(ranked[1].score > 0.1, 'a studied word outside the stash is not discounted');
  } finally {
    db.close();
    box.done();
  }
});

test('only the newest model reading of an event counts, and failed readings count for nothing', () => {
  const e = { id: 'e', seq: 1, at: at(20), kind: 'chat' as const, surface: 'chat', ref: null, text: '我想出去透气', context: {}, targets: [] };
  const reading = (when: number, needs: string[]) => ({
    id: String(when), eventId: 'e', at: at(when), source: 'model:x/notice-v1',
    body: { communicated: 'clear', uses: [], intended: [], needs: needs.map((form) => ({ form, kind: 'word', gloss: '', evidence: '透气', note: '' })) },
  });
  const failed = { id: 'f', eventId: 'e', at: at(22), source: 'model:x/notice-v1', body: { failed: 'timeout' } };
  const signals = signalsFrom([reading(20, ['透透气']), reading(21, ['出去走走']), failed], new Map([['e', e]]));
  assert.deepEqual(signals.map((s) => s.form), ['出去走走']);
});

test('a notice quotes the learner exactly and answers for every intended form', () => {
  const input = {
    trigger: 'notice', message: '', surface: 'chat', source: '', tutorHistory: [], chatHistory: [], saved: [],
    notice: { kind: 'answer', text: '我只是看了一眼', intended: ['只是'], knownInText: ['只是'] },
  } as unknown as TurnContext;
  const ok = { notice: { communicated: 'clear', uses: [], needs: [], intended: [{ form: '只是', outcome: 'natural' }] } } as const;
  assert.equal(notice.validate(ok as never, input).intended[0].outcome, 'natural');
  assert.throws(() => notice.validate({ notice: { ...ok.notice, intended: [] } } as never, input), /intended form/);
  assert.throws(
    () => notice.validate({ notice: { ...ok.notice, needs: [{ form: '瞥', kind: 'word', gloss: 'glance', evidence: 'glanced', note: '' }] } } as never, input),
    /quote the learner text/,
  );
  assert.throws(() => notice.validate({ notice: { ...ok.notice, uses: [{ form: 'only', kind: 'word', quality: 'natural', note: '' }] } } as never, input), /Chinese/);
  assert.ok(notice.validate(demoTutor(input) as never, input));
});

test('new words wait behind a daily limit and behind open work, and a taught word settles before it graduates', () => {
  const fresh = Array.from({ length: 7 }, (_, i) => target('新' + i, { origin: 'saved', createdAt: at(22) }));
  assert.equal(rank(fresh, [], now).length, 5, 'five new words a day, as the hosted default');
  const taught = (form: string, day: number): Signal => ({ form, role: 'taught', at: at(day), eventId: 'e-' + form, practice: true });
  const taughtToday = ['甲', '乙', '丙'].map((form) => taught(form, 23));
  const afterTeaching = rank([...fresh, ...['甲', '乙', '丙'].map((f) => target(f, { origin: 'saved' }))], taughtToday, now);
  assert.equal(afterTeaching.filter((r) => r.fresh).length, 2, 'three taught today leave room for two');
  assert.ok(afterTeaching.find((r) => r.target.form === '甲')?.pressing, 'a word taught today is still settling');
  const busy = Array.from({ length: 8 }, (_, i) => ({ form: '弱' + i, role: 'needed' as const, at: at(20), eventId: 'n' + i }));
  const blocked = rank([...fresh, ...busy.map((s) => target(s.form))], busy, now);
  assert.equal(blocked.filter((r) => r.fresh).length, 0, 'eight open weaknesses hold back new words');
  const settled = rank([target('甲')], [taught('甲', 18), { form: '甲', role: 'correct', at: at(19), eventId: 'c1' }, { form: '甲', role: 'used', at: at(21), eventId: 'c2' }], now);
  assert.equal(settled.length, 0, 'two clean days after teaching retire it');
});

test('an old-app review is typed from memory and graded by its forms, ignoring spacing and punctuation', async () => {
  const box = sandbox();
  const db = new DatabaseSync(box.path);
  importHosted(db, {
    exportedAt: '2026-11-01T00:00:00.000Z',
    learner: 'test',
    words: [
      hosted({ hanzi: '战胜', pinyin: 'zhànshèng', meaning: 'to prevail over; to defeat', dueAt: '2026-11-05T00:00:00.000Z', intervalHours: 240, attempts: 13, incorrect: 4 }),
      hosted({ hanzi: '难得', pinyin: 'nándé', meaning: 'seldom; hard to come by', dueAt: '2026-11-05T00:00:00.000Z', intervalHours: 240, attempts: 9, incorrect: 3 }),
    ],
  });
  db.close();
  const j = openJournal(box.path, demo);
  try {
    let s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    const formFor = (prompt: string) => (prompt.startsWith('to prevail') ? '战胜' : '难得');
    let card = s.practice.card!;
    assert.equal(card.kind, 'recall');
    assert.equal(card.purpose, 'review');
    assert.ok(!card.prompt.includes(formFor(card.prompt)), 'the cue does not give the answer away');
    s = await j.act({ id: randomUUID(), type: 'answer', cardId: card.id, answer: ' ' + formFor(card.prompt) + '。' });
    assert.equal(s.practice.result?.correct, true);
    await j.act({ id: randomUUID(), type: 'next', cardId: card.id });
    await settle(j);
    s = j.get();
    card = s.practice.card!;
    assert.equal(card.kind, 'recall');
    s = await j.act({ id: randomUUID(), type: 'answer', cardId: card.id, answer: '不知道' });
    assert.equal(s.practice.result?.correct, false);
    assert.ok(s.practice.result?.feedback.startsWith(formFor(card.prompt)), 'a miss shows the expected form first');
    await settle(j);
    const sources = read(box.path, judgments).map((x) => x.source);
    assert.deepEqual(sources, ['rule:recall-v1', 'rule:recall-v1'], 'graded by rule, with no model reading');
  } finally {
    j.close();
    box.done();
  }
});
