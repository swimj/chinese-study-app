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
    assert.equal(next.practice.done, true);
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
    await j.act({
      id: randomUUID(),
      type: 'tutor',
      message: 'Please keep 分心 for later.',
      surface: 'read',
      source: src,
    });
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

test('a reflection belongs to one stretch and one thread across reopening and discussion', async () => {
  const inputs: TurnContext[] = [];
  const j = openJournal(':memory:', {
    ...demo,
    tutor: async (ctx) => {
      inputs.push(ctx);
      if (ctx.trigger !== 'reflect') return { reply: 'We can discuss that line.', action: null };
      const turn = ctx.reflectionTurns!.find((t) => t.role === 'user')!;
      return {
        reply: '',
        action: null,
        reflection: {
          overview: 'You described waiting for birds.',
          takeaways: [{ messageId: turn.id, quote: turn.text, text: 'Who is feeding whom?' }],
        },
      };
    },
  });
  try {
    const bird = await j.act({ id: randomUUID(), type: 'newThread', title: 'Birds' });
    const threadId = bird.activeThreadId;
    const send = (message: string) =>
      j.act({ id: randomUUID(), type: 'chat', source: 'Birds', message, threadId });
    const reflect = () => j.act({ id: randomUUID(), type: 'reflect', source: 'Birds', threadId });
    await send('等着鸟来喂');
    const first = (await reflect()).reflections[0];
    assert.equal((await reflect()).reflections[0].id, first.id);
    assert.equal(inputs.length, 1);
    await send('今天又去看鸟了。');
    await reflect();
    assert.deepEqual(
      inputs[1].reflectionTurns?.filter((t) => t.role === 'user').map((t) => t.text),
      ['今天又去看鸟了。'],
    );
    await j.act({ id: randomUUID(), type: 'newThread', title: 'Films' });
    assert.equal(j.get().chat.length, 0);
    await assert.rejects(send('stale tab'), /conversation changed/);
    await j.act({
      id: randomUUID(),
      type: 'tutor',
      surface: 'chat',
      source: '等着鸟来喂',
      message: 'Why?',
      referenceId: first.id,
    });
    assert.match(inputs.at(-1)!.source, /Who is feeding whom/);
    await j.act({ id: randomUUID(), type: 'selectThread', threadId });
    assert.equal(j.get().chat.length, 4);
  } finally {
    j.close();
  }
});

test('the tutor can confirm a queued exercise, discuss its exact attempt and continue with fresh prompts', async () => {
  let generated = 0;
  const inputs: TurnContext[] = [];
  const j = openJournal(':memory:', {
    ...demo,
    tutor: async (ctx) => {
      inputs.push(ctx);
      if (ctx.trigger === 'answer')
        return { reply: '只放在地点前，很清楚。', observation: '只 limits the location here.', action: null };
      if (ctx.message === 'Already queued?' || ctx.message === 'Why there?')
        return { reply: 'Yes.', action: null };
      const prompt =
        ctx.trigger === 'practice' ? 'Describe another scene ' + ++generated : 'Where did you wait?';
      return {
        reply: 'Ready.',
        action: {
          kind: 'practice',
          title: 'Only at the café',
          detail: 'Practice scope.',
          exercise: {
            kind: 'open',
            prompt,
            choices: [],
            answer: '只在门外等。',
            explanation: 'Limit the place.',
          },
        },
      };
    },
  });
  try {
    const ask = (message: string, referenceId?: string) =>
      j.act({ id: randomUUID(), type: 'tutor', surface: 'home', source: '只是在等', message, referenceId });
    await ask('Give me practice for later.');
    await ask('Already queued?');
    assert.equal(inputs.at(-1)?.practiceStatus?.pending.length, 1);
    assert.equal(j.get().saved.length, 0);
    assert.equal(j.get().activity.filter((row) => row.text.includes('Queued')).length, 1);
    const start = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    const cardId = start.practice.card!.id;
    const finish = await j.act({ id: randomUUID(), type: 'answer', cardId, answer: '我只在咖啡店外面等。' });
    const attempt = finish.attempts.at(-1)!;
    assert.equal(finish.practice.result?.feedback, '只放在地点前，很清楚。');
    assert.equal(finish.tutor.at(-1)?.reference?.id, attempt.id);
    assert.equal(finish.tutor.filter((t) => t.text === attempt.result.feedback).length, 0);
    await ask('Why there?', attempt.id);
    assert.match(inputs.at(-1)!.source, /只放在地点前，很清楚/);
    await j.act({ id: randomUUID(), type: 'next', cardId });
    const continued = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix', continue: true });
    assert.match(continued.practice.card!.prompt, /another scene/);
    assert.equal(generated, 3);
    assert.ok(inputs.at(-1)?.previousPrompts?.includes('Where did you wait?'));
    // Changing mode keeps unattempted generated cards.
    await j.act({ id: randomUUID(), type: 'practice', mode: 'Past mistakes' });
    const back = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.equal(back.practice.card?.id, continued.practice.card?.id);
  } finally {
    j.close();
  }
});

test('reading annotations survive a restart with a validated quote, position and tutor reference', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'journal-reading-'));
  const path = join(folder, 'journal.db');
  let source = '';
  const backend = {
    ...demo,
    tutor: async (ctx: TurnContext) => {
      source = ctx.source;
      return { reply: 'It gives the reason for stepping outside.', action: null };
    },
  };
  let j = openJournal(path, backend);
  try {
    const where = { documentId: 'after-the-show', paragraphId: 'street' };
    const a = {
      id: randomUUID(),
      type: 'annotate' as const,
      ...where,
      quote: '透透气',
      text: 'Is this also a change of scene?',
    };
    await assert.rejects(j.act({ ...a, quote: 'wrong paragraph' }), /selected text/);
    await j.act(a);
    await j.act(a);
    await j.act({ id: randomUUID(), type: 'readingPosition', ...where });
    j.close();
    j = openJournal(path, backend);
    const state = j.get();
    assert.equal(state.reading.positions['after-the-show'], 'street');
    assert.equal(state.reading.annotations.length, 1);
    await j.act({
      id: randomUUID(),
      type: 'tutor',
      surface: 'read',
      source: '透透气',
      referenceId: 'after-the-show/street/' + a.id,
      message: 'What about this?',
    });
    assert.match(source, /我本来只想出去/);
    assert.match(source, /Is this also a change of scene/);
    assert.equal(j.get().tutor.at(-1)?.reference?.kind, 'reading');
  } finally {
    j.close();
    rmSync(folder, { recursive: true });
  }
});

test('existing journals promote their original conversation and link prior feedback without losing attempts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const folder = mkdtempSync(join(tmpdir(), 'journal-legacy-'));
  const path = join(folder, 'journal.db');
  const legacy = new DatabaseSync(path);
  const card = {
    id: 'old-cafe',
    kind: 'open',
    prompt: 'Describe where you waited.',
    choices: [],
    answer: '只在外面等。',
    explanation: 'Placement',
  };
  const result = { correct: null, feedback: 'Your sentence limits the location.' };
  legacy.exec('CREATE TABLE journal(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)');
  legacy.prepare('INSERT INTO journal VALUES (1,0,?)').run(
    JSON.stringify({
      tutor: [{ role: 'assistant', text: result.feedback, source: JSON.stringify({ prompt: card.prompt }) }],
      chat: [
        { role: 'user', text: '我今天去看鸟了。' },
        { role: 'assistant', text: '看到什么鸟了？' },
      ],
      saved: [],
      learning: [],
      pending: [],
      attempts: [{ card, answer: '我只在外面等。', result }],
      practice: { started: true, mode: 'Daily mix', index: 0, cards: [card], result },
      lastPracticeContext: 'old',
      notice: '',
    }),
  );
  legacy.close();
  const j = openJournal(path, demo);
  try {
    const before = j.get();
    assert.equal(before.threads[0].title, 'Birdwatching');
    assert.equal(before.chat[0].id, 'legacy-turn-0');
    assert.equal(before.tutor[0].reference?.id, before.attempts[0].id);
    await j.act({ id: randomUUID(), type: 'newThread', title: 'Gardening' });
    await j.act({ id: randomUUID(), type: 'selectThread', threadId: 'first' });
    assert.deepEqual(j.get().attempts, before.attempts);
    assert.equal(j.get().practice.result?.feedback, result.feedback);
  } finally {
    j.close();
    rmSync(folder, { recursive: true });
  }
});
