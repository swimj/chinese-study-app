import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import type { TurnContext } from './tutor.ts';
const demo = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};
test('a real journal carries chat into practice and retains the served exercise and outcome on reopen', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'mandarin-journal-test-')),
    path = join(folder, 'journal.db');
  let j = openJournal(path, demo);
  try {
    const request = {
      id: randomUUID(),
      type: 'chat' as const,
      message: '在家容易 get distracted。',
      source: 'library',
    };
    await Promise.all([j.act(request), j.act(request)]);
    assert.equal(j.get().chat.length, 2);
    await assert.rejects(j.act({ ...request, message: 'different' }), /different request/);
    const practice = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.equal(practice.practice.card?.kind, 'open');
    assert.equal(practice.learning.length, 1);
    const cardId = practice.practice.card!.id;
    await assert.rejects(j.act({ id: randomUUID(), type: 'next', cardId }), /Answer before/);
    await j.act({ id: randomUUID(), type: 'answer', cardId, answer: '我本来想整理照片，结果刷起视频来了。' });
    j.close();
    j = openJournal(path, demo);
    assert.equal(j.get().practice.result?.correct, null);
    const next = await j.act({ id: randomUUID(), type: 'next', cardId });
    assert.equal(next.practice.card?.id, 'restore-data');
    await assert.rejects(j.act({ id: randomUUID(), type: 'answer', cardId, answer: '修复' }), /changed/);
  } finally {
    j.close();
    rmSync(folder, { recursive: true });
  }
});
test('stash and past mistakes use this learner’s own actions', async () => {
  const j = openJournal(':memory:', demo);
  try {
    const src = '散场以后 · 我本来只想出去透透气。';
    await j.act({ id: randomUUID(), type: 'tutor', message: 'Please keep 分心 for later.', surface: 'read', source: src });
    assert.equal(j.get().saved[0].title, '分心');
    let s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Past mistakes' });
    assert.equal(s.practice.card, null);
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Build vocabulary' });
    const c = s.practice.card!;
    assert.match(c.prompt, /分心/);
    await j.act({ id: randomUUID(), type: 'answer', cardId: c.id, answer: c.choices[1] });
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Past mistakes' });
    assert.equal(s.practice.card?.id, c.id);
    await j.act({ id: randomUUID(), type: 'answer', cardId: c.id, answer: c.choices[0] });
    await j.act({ id: randomUUID(), type: 'next', cardId: c.id });
    s = await j.act({ id: randomUUID(), type: 'practice', mode: 'Past mistakes' });
    assert.equal(s.practice.card, null);
  } finally {
    j.close();
  }
});
test('failed tutor turn can retry without a partial message', async () => {
  let fails = true;
  const j = openJournal(':memory:', {
    ...demo,
    tutor: async (ctx) => {
      if (fails) throw Error('offline');
      return demoTutor(ctx);
    },
  });
  try {
    const a = {
      id: randomUUID(),
      type: 'tutor' as const,
      message: 'stash 透透气',
      surface: 'read',
      source: 'essay',
    };
    await assert.rejects(j.act(a), /offline/);
    assert.equal(j.get().tutor.length, 0);
    fails = false;
    await j.act(a);
    await j.act(a);
    assert.equal(j.get().saved.length, 1);
  } finally {
    j.close();
  }
});
