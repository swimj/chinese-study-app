import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import type { TurnContext, TutorResult } from './tutor.ts';

const demo = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};
type Journal = ReturnType<typeof openJournal>;

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

async function settled(journal: Journal, id: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const item = journal.get().wordIntakes.find((item) => item.id === id);
    if (item && item.status !== 'pending') return item;
    await delay(5);
  }
  throw new Error('Word preparation did not finish');
}

test('word submission acknowledges durably, keeps user actions during generation, and feeds vocabulary practice', async () => {
  const started = gate();
  const finish = gate();
  const friendStarted = gate();
  const friendFinish = gate();
  let intakes = 0;
  const j = openJournal(':memory:', {
    ...demo,
    async tutor(ctx) {
      if (ctx.trigger === 'wordIntake') {
        intakes++;
        started.resolve();
        await finish.promise;
      }
      return demoTutor(ctx);
    },
    async friend() {
      friendStarted.resolve();
      await friendFinish.promise;
      return '好。';
    },
  });
  try {
    const action = {
      type: 'addWord' as const,
      id: randomUUID(),
      text: '报备',
      context: '物业要求我们报备。',
    };
    const first = await j.act(action);
    assert.equal(first.wordIntakes[0].status, 'pending');
    assert.equal(first.tutor.length, 0);
    await started.promise;
    await j.act({ type: 'newThread', id: randomUUID(), title: 'Visits' });
    const chat = j.act({ type: 'chat', id: randomUUID(), message: '你好！', source: '' });
    await friendStarted.promise;
    finish.resolve();
    await delay(10);
    friendFinish.resolve();
    await chat;
    const ready = await settled(j, action.id);
    assert.equal(ready.status, 'ready');
    assert.equal(j.get().chat[1].text, '好。');
    assert.equal(j.get().saved[0].source, action.context);
    assert.match(j.get().saved[0].detail, /物业报备/);
    const duplicate = await j.act(action);
    assert.equal(duplicate.wordIntakes.length, 1);
    await assert.rejects(j.act({ ...action, text: '图书馆' }), /different request/);
    const reuse = await j.act({ ...action, id: randomUUID() });
    assert.equal(reuse.wordIntakes[1].status, 'ready');
    assert.deepEqual(reuse.wordIntakes[1].savedIds, ready.savedIds);
    assert.equal(intakes, 1);
    const practice = await j.act({ type: 'practice', mode: 'Build vocabulary', id: randomUUID() });
    assert.match(practice.practice.card?.introduction ?? '', /报备/);
    assert.match(practice.practice.card?.prompt ?? '', /property manager/);
  } finally {
    finish.resolve();
    friendFinish.resolve();
    j.close();
  }
});

test('a clarification survives reopen and its reply resolves the original durable intake', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-intake-'));
  const path = join(dir, 'test.db');
  const id = randomUUID();
  let j = openJournal(path, demo);
  try {
    await j.act({ type: 'addWord', id, text: '蜘' });
    const ask = await settled(j, id);
    assert.deepEqual(ask.suggestions, ['蜘蛛']);
    assert.equal(j.get().saved.length, 0);
    assert.equal(j.get().tutor.at(-1)?.text, ask.question);
    j.close();
    // Existing journal files kept unanswered questions solely in the intake.
    const db = new DatabaseSync(path);
    db.exec("UPDATE journal SET body=json_set(body, '$.tutor', json('[]'))");
    db.close();
    j = openJournal(path, demo);
    const question = j.get().tutor.at(-1);
    assert.equal(question?.text, ask.question);
    assert.equal(question?.wordRequestId, id);
    const second = randomUUID();
    await j.act({ type: 'addWord', id: second, text: '行' });
    await settled(j, second);
    const answer = {
      type: 'tutor' as const,
      id: randomUUID(),
      wordReplyTo: { intakeId: id, requestId: id },
      message: 'Yes, the spider.',
      surface: 'home',
      source: '',
    };
    await j.act(answer);
    const ready = await settled(j, id);
    assert.deepEqual(ready.history, [
      { question: ask.question, suggestions: ask.suggestions, reply: answer.message },
    ]);
    const state = j.get();
    assert.equal(state.saved[0].title, '蜘蛛');
    assert.equal(state.wordIntakes[1].status, 'clarify');
    assert.match(state.tutor.at(-1)?.text ?? '', /蜘蛛/);
    assert.equal(state.tutor.at(-2)?.text, answer.message);
    assert.deepEqual((await j.act(answer)).tutor, state.tutor);
    await assert.rejects(j.act({ ...answer, id: randomUUID() }), /question has changed/);
  } finally {
    j.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reading disambiguation preserves both senses and sentence splitting waits for a selection', async () => {
  const j = openJournal(':memory:', demo);
  try {
    const id = randomUUID();
    await j.act({ type: 'addWord', id, text: '行' });
    assert.match((await settled(j, id)).question ?? '', /háng/);
    await j.act({ type: 'clarifyWord', id: randomUUID(), intakeId: id, reply: 'the second' });
    assert.equal((await settled(j, id)).status, 'ready');
    const other = randomUUID();
    await j.act({ type: 'addWord', id: other, text: '行', context: '我们明天去，行吗？' });
    assert.equal((await settled(j, other)).status, 'ready');
    assert.deepEqual(
      j.get().saved.map((s) => s.word?.pinyin),
      ['háng', 'xíng'],
    );
    const split = randomUUID();
    await j.act({ type: 'addWord', id: split, text: '散场以后去透透气' });
    assert.deepEqual((await settled(j, split)).suggestions, ['散场', '透透气', '散场 + 透透气']);
    assert.equal(j.get().saved.length, 2);
    await j.act({ type: 'clarifyWord', id: randomUUID(), intakeId: split, reply: 'both please' });
    assert.equal((await settled(j, split)).savedIds?.length, 2);
    assert.deepEqual(
      j
        .get()
        .saved.slice(2)
        .map((s) => s.title),
      ['散场', '透透气'],
    );
  } finally {
    j.close();
  }
});

test('unfinished work resumes after restart, a failed turn retries, and an old worker cannot apply twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-intake-'));
  const path = join(dir, 'test.db');
  const id = randomUUID();
  const firstStarted = gate();
  const firstFinished = gate();
  let j = openJournal(path, {
    ...demo,
    async tutor(ctx) {
      firstStarted.resolve();
      await firstFinished.promise;
      return demoTutor(ctx);
    },
  });
  try {
    await j.act({ type: 'addWord', id, text: '图书馆' });
    await firstStarted.promise;
    j.close();
    let attempts = 0;
    j = openJournal(path, {
      ...demo,
      async tutor(ctx) {
        // Saving the word also queues a picture consideration; count word turns only.
        if (ctx.trigger !== 'wordIntake') return demoTutor(ctx);
        if (!attempts++) throw new Error('simulated failure');
        return demoTutor(ctx);
      },
    });
    assert.equal((await settled(j, id)).status, 'failed');
    const retry = { type: 'retryWord' as const, intakeId: id, id: randomUUID() };
    await j.act(retry);
    await j.act(retry);
    assert.equal((await settled(j, id)).status, 'ready');
    firstFinished.resolve();
    await delay(10);
    assert.equal(attempts, 2);
    assert.equal(j.get().saved.length, 1);
  } finally {
    firstFinished.resolve();
    j.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a legacy freeform stash still requires semantic review; unknown offline targets retain the original request', async () => {
  const j = openJournal(':memory:', {
    ...demo,
    async tutor(ctx): Promise<TutorResult> {
      if (ctx.trigger === 'ask')
        return {
          reply: 'Saved.',
          action: { kind: 'stash', title: '蜘', detail: 'A spider.', exercise: null },
        };
      return demoTutor(ctx);
    },
  });
  try {
    await j.act({ type: 'tutor', id: randomUUID(), message: 'Save 蜘', source: '', surface: 'home' });
    const id = randomUUID();
    await j.act({ type: 'addWord', id, text: '蜘' });
    assert.equal((await settled(j, id)).status, 'clarify');
    const other = randomUUID();
    await j.act({ type: 'addWord', id: other, text: '超导体' });
    assert.match((await settled(j, other)).error ?? '', /offline/);
    assert.equal(j.get().saved.length, 1);
  } finally {
    j.close();
  }
});

test('a meaningful legacy stash keeps its identity when semantic bootstrap supplies the practice example', async () => {
  const j = openJournal(':memory:', demo);
  try {
    const stashed = await j.act({
      id: randomUUID(),
      type: 'tutor',
      surface: 'home',
      source: '',
      message: 'Save 分心',
    });
    const existing = stashed.saved[0].id;
    const id = randomUUID();
    await j.act({ id, type: 'addWord', text: '分心' });
    assert.deepEqual((await settled(j, id)).savedIds, [existing]);
    assert.equal(j.get().saved.length, 1);
    assert.match(j.get().saved[0].word?.example ?? '', /分心/);
  } finally {
    j.close();
  }
});
