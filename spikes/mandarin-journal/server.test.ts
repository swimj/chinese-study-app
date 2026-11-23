import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { actionSchema, openJournal } from './journal.ts';
import { catalogue, demoFriend, demoTutor } from './practice.ts';
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

test('the learner can annotate across verbatim chat turns and continue the same discussion after switching conversations', async () => {
  const inputs: TurnContext[] = [];
  let unavailable = true;
  const journal = openJournal(':memory:', {
    ...demo,
    friend: async () => '鸟食在阳台上。',
    tutor: async (ctx) => {
      inputs.push(ctx);
      if (unavailable) throw new Error('offline');
      return demoTutor(ctx);
    },
  });
  try {
    const learner = '看🐦鸟食！';
    const chat = await journal.act({
      id: randomUUID(),
      type: 'chat',
      message: learner,
      source: 'Birdwatching',
    });
    const [user, friend] = chat.chat;
    const anchor = {
      surface: 'chat' as const,
      ownerId: 'first',
      startId: user.id,
      endId: friend.id,
      startOffset: 1,
      endOffset: 2,
      quote: '🐦鸟食！\n鸟食',
    };
    const make = {
      id: randomUUID(),
      type: 'annotationPost' as const,
      anchor,
      message: 'Both speakers used 鸟食.',
      askTutor: false,
    };
    for (const invalid of [
      { ...anchor, quote: '🐦鸟食！鸟食' },
      { ...anchor, startOffset: 2, quote: learner.slice(2) + '\n鸟食' },
      { ...anchor, startId: friend.id, endId: user.id },
      { ...anchor, ownerId: 'missing' },
      { ...anchor, endOffset: 2000 },
      { ...anchor, endId: 'missing' },
    ]) {
      await assert.rejects(journal.act({ ...make, anchor: invalid }), /source/);
    }
    await journal.act(make);
    const ask = {
      id: randomUUID(),
      type: 'annotationPost' as const,
      annotationId: make.id,
      message: 'Save 鸟食 for study.',
      askTutor: true,
    };
    await journal.act({ id: randomUUID(), type: 'newThread', title: 'Films' });
    assert.equal(inputs.length, 0);
    await assert.rejects(journal.act(ask), /offline/);
    assert.equal(journal.get().annotationThreads[0].messages.length, 1);
    unavailable = false;
    await Promise.all([journal.act(ask), journal.act(ask)]);
    const ctx = inputs.at(-1)!;
    assert.equal(ctx.topic, 'Conversation');
    assert.equal(ctx.chatHistory[1].text, friend.text);
    assert.match(ctx.source, /Conversation partner: 鸟食在阳台上/);
    assert.match(ctx.source, /Both speakers used 鸟食/);
    assert.equal(ctx.annotations?.[0].quote, anchor.quote);
    const state = journal.get();
    assert.deepEqual(
      state.annotationThreads.map((t) => t.anchor),
      [anchor],
    );
    assert.deepEqual(
      state.annotationThreads[0].messages.map((m) => m.role),
      ['user', 'user', 'assistant'],
    );
    assert.equal(state.saved[0].reference?.id, make.id);
    assert.equal(state.activity.filter((a) => a.reference?.id === make.id).length, 3);
    assert.deepEqual(state.tutor, []);
    assert.equal(state.chat.length, 0);
    assert.equal(inputs.length, 2);
    const other = await journal.act({ id: randomUUID(), type: 'chat', message: '电影', source: '' });
    await assert.rejects(
      journal.act({ ...make, id: randomUUID(), anchor: { ...anchor, endId: other.chat[0].id } }),
      /source/,
    );
  } finally {
    journal.close();
  }
});

test('reading ranges preserve paragraph boundaries and the source of a repeated occurrence', async () => {
  const journal = openJournal(':memory:', demo);
  try {
    const doc = journal.get().reading.documents[0];
    const [a, b, c] = doc.paragraphs;
    const anchor = {
      surface: 'read' as const,
      ownerId: doc.id,
      startId: a.id,
      endId: c.id,
      startOffset: a.text.length - 5,
      endOffset: 6,
      quote: [a.text.slice(-5), b.text, c.text.slice(0, 6)].join('\n'),
    };
    const post = {
      id: randomUUID(),
      type: 'annotationPost' as const,
      askTutor: false,
      message: 'New paragraph',
      anchor,
    };
    const state = await journal.act(post);
    assert.deepEqual(state.annotationThreads[0].anchor, anchor);
    const second = b.text.lastIndexOf('我');
    assert.ok(second > b.text.indexOf('我'));
    const repeated = {
      ...anchor,
      startId: b.id,
      endId: b.id,
      startOffset: second,
      endOffset: second + 1,
      quote: '我',
    };
    await journal.act({ ...post, id: randomUUID(), anchor: repeated });
    assert.deepEqual(journal.get().annotationThreads[1].anchor, repeated);
    await assert.rejects(
      journal.act({
        ...post,
        id: randomUUID(),
        anchor: { ...anchor, quote: anchor.quote.replace(b.text, '') },
      }),
      /match/,
    );
    await assert.rejects(
      journal.act({ ...post, id: randomUUID(), annotationId: post.id }),
      /existing annotation/,
    );
    await assert.rejects(
      journal.act({ ...post, id: randomUUID(), anchor: undefined, annotationId: 'gone' }),
      /unavailable/,
    );
  } finally {
    journal.close();
  }
});

test('reader captures save each exact occurrence once and reopen as a margin thread', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'journal-capture-'));
  const path = join(folder, 'journal.db');
  const backend = { ...demo, tutor: async () => { throw Error('Unexpected tutor call'); } };
  let journal = openJournal(path, backend);
  try {
    const anchor = {
      surface: 'read' as const, ownerId: 'after-the-show', startId: 'street', endId: 'street',
      startOffset: 11, endOffset: 13, quote: '听着',
    };
    const capture = { id: randomUUID(), type: 'captureReading' as const, anchor };
    assert.equal(actionSchema.safeParse({ ...capture, anchor: { ...anchor, surface: 'chat' } }).success, false);
    await assert.rejects(journal.act({ ...capture, anchor: { ...anchor, quote: '听说' } }), /does not match/);
    await Promise.all([journal.act(capture), journal.act({ ...capture, id: randomUUID() })]);
    const second = { ...anchor, startOffset: anchor.startOffset + 2, endOffset: anchor.endOffset + 2 };
    const note = {
      id: randomUUID(), type: 'annotationPost' as const, anchor: second, message: 'The repeat', askTutor: false,
    };
    await journal.act(note);
    await journal.act({ ...capture, id: randomUUID(), anchor: second });
    journal.close();
    journal = openJournal(path, backend);
    const state = journal.get();
    assert.deepEqual(state.annotationThreads.map(t => [t.id, t.anchor]), [[capture.id, anchor], [note.id, second]]);
    assert.ok(state.annotationThreads.every(t => t.capturedAt));
    assert.equal(state.activity.filter(entry => entry.reference?.id === capture.id).length, 1);
    assert.deepEqual(state.reading.annotations.map(n => n.text), ['', 'The repeat']);
    assert.deepEqual(state.annotationThreads[0].messages, []);
    assert.deepEqual([state.saved, state.tutor, state.wordIntakes], [[], [], []]);
    assert.equal(state.practice.card, null);
    const reply = await journal.act({
      id: randomUUID(), type: 'annotationPost', annotationId: capture.id, message: 'As I listened', askTutor: false,
    });
    assert.equal(reply.annotationThreads[0].messages[0].text, 'As I listened');
    assert.equal(reply.annotationThreads[0].capturedAt, state.annotationThreads[0].capturedAt);
  } finally {
    journal.close();
    rmSync(folder, { recursive: true });
  }
});

test('old reading notes and reflection takeaways become stable, replyable threads without replaying history', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const folder = mkdtempSync(join(tmpdir(), 'journal-annotations-'));
  const path = join(folder, 'journal.db');
  let journal = openJournal(path, demo);
  try {
    await journal.act({ id: randomUUID(), type: 'chat', source: '', message: '我等着鸟来喂。' });
    const reflected = await journal.act({ id: randomUUID(), type: 'reflect', source: '' });
    const ref = reflected.reflections[0];
    const original = reflected.annotationThreads.find((t) => t.id === ref.takeaways[0].annotationId)!;
    assert.equal(original.messages[0].role, 'assistant');
    assert.equal(original.anchor.quote, ref.takeaways[0].quote);
    journal.close();
    const db = new DatabaseSync(path);
    const snapshot = JSON.parse(String(db.prepare('SELECT body FROM journal WHERE id=1').get()!.body));
    delete snapshot.annotationThreads;
    delete snapshot.reflections[0].takeaways[0].annotationId;
    snapshot.reading.annotations = [
      {
        id: 'old-note',
        documentId: 'after-the-show',
        paragraphId: 'street',
        quote: '',
        text: 'Whole paragraph note.',
      },
    ];
    const oldActivity = {
      id: 'historic',
      at: '2026-10-01T00:00:00Z',
      text: 'Annotated 散场以后',
      source: '散场以后',
      reference: {
        kind: 'reading',
        id: 'after-the-show/street/old-note',
        label: '散场以后',
        quote: 'Whole paragraph note.',
      },
    };
    snapshot.activity.push(oldActivity);
    db.prepare('UPDATE journal SET body=?').run(JSON.stringify(snapshot));
    db.close();

    journal = openJournal(path, demo);
    const loaded = journal.get();
    assert.deepEqual(journal.get().annotationThreads, loaded.annotationThreads);
    assert.deepEqual(
      loaded.annotationThreads.find((t) => t.id === original.id),
      original,
    );
    assert.equal(
      loaded.annotationThreads.find((t) => t.id === 'old-note')?.anchor.quote,
      loaded.reading.documents[1].paragraphs[1].text,
    );
    assert.deepEqual(loaded.activity.at(-1), oldActivity);
    assert.equal(loaded.activity.length, reflected.activity.length + 1);
    for (const thread of loaded.annotationThreads) {
      await journal.act({
        id: randomUUID(),
        type: 'annotationPost',
        annotationId: thread.id,
        message: 'Following up.',
        askTutor: false,
      });
    }
    journal.close();
    journal = openJournal(path, demo);
    const after = journal.get();
    assert.equal(after.reflections[0].takeaways[0].annotationId, original.id);
    assert.deepEqual(
      after.annotationThreads.map((t) => t.messages.length),
      [2, 2],
    );
    assert.equal(after.reading.annotations.length, 1);
    assert.equal(after.tutor.length, reflected.tutor.length);
    assert.deepEqual(
      (await journal.act({ id: randomUUID(), type: 'reflect', source: '' })).annotationThreads,
      after.annotationThreads,
    );
  } finally {
    journal.close();
    rmSync(folder, { recursive: true });
  }
});

test('a reflection with an invalid takeaway leaves the previous stretch available for a clean retry', async () => {
  let invalid = true;
  const journal = openJournal(':memory:', {
    ...demo,
    tutor: async (ctx) => {
      const [learner, friend] = ctx.reflectionTurns!;
      const takeaways = [{ messageId: learner.id, quote: learner.text, text: 'First observation.' }];
      if (invalid)
        takeaways.push({ messageId: friend.id, quote: friend.text, text: 'Misattributed observation.' });
      return { reply: 'Summary.', action: null, reflection: { overview: 'Summary.', takeaways } };
    },
  });
  try {
    await journal.act({ id: randomUUID(), type: 'chat', source: '', message: '图书馆' });
    const request = { id: randomUUID(), type: 'reflect' as const, source: '' };
    await assert.rejects(journal.act(request), /anchored/);
    const initial = journal.get();
    assert.deepEqual(
      [initial.annotationThreads, initial.reflections, initial.activity, initial.tutor],
      [[], [], [], []],
    );
    invalid = false;
    await journal.act(request);
    const result = await journal.act(request);
    assert.equal(result.annotationThreads.length, 1);
    assert.equal(result.annotationThreads[0].id, result.reflections[0].takeaways[0].annotationId);
  } finally {
    journal.close();
  }
});

test('a tutor’s practice rationale stays with its card and never returns as learner evidence', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'journal-rationale-'));
  const path = join(folder, 'journal.db');
  const rationale = 'The learner probably confuses scope words.';
  const inputs: TurnContext[] = [];
  let generated = 0;
  const backend = {
    ...demo,
    tutor: async (ctx: TurnContext) => {
      inputs.push(ctx);
      if (ctx.trigger === 'answer') return { reply: 'Clear.', action: null };
      return {
        reply: 'Ready.',
        action: {
          kind: 'practice' as const,
          title: 'Only while waiting',
          detail: rationale,
          exercise: {
            kind: 'open' as const,
            prompt: 'Say you are just waiting ' + ++generated,
            choices: [],
            answer: '我只是在等。',
            explanation: 'Limit the activity.',
          },
        },
      };
    },
  };
  const { DatabaseSync } = await import('node:sqlite');
  const body = () => {
    const db = new DatabaseSync(path);
    const parsed = JSON.parse(String(db.prepare('SELECT body FROM journal').get()!.body));
    db.close();
    return parsed;
  };
  let j = openJournal(path, backend);
  try {
    await j.act({ id: randomUUID(), type: 'chat', source: '', message: '我只在等。' });
    await j.act({ id: randomUUID(), type: 'tutor', surface: 'home', source: '只是', message: 'Queue practice on 只是.' });
    j.close();
    // An existing journal may still hold rationales copied by earlier versions.
    const legacy = body();
    legacy.learning = [{ text: 'Legacy rationale — an earlier guess.', source: '只是' }];
    const raw = new DatabaseSync(path);
    raw.prepare('UPDATE journal SET body=?').run(JSON.stringify(legacy));
    raw.close();
    j = openJournal(path, backend);
    const start = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    const cardId = start.practice.card!.id;
    await j.act({ id: randomUUID(), type: 'answer', cardId, answer: '我只是在等。' });
    await j.act({ id: randomUUID(), type: 'next', cardId });
    const continued = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix', continue: true });
    assert.ok(continued.practice.card);
    assert.ok(inputs.some((ctx) => ctx.trigger === 'practice'));
    for (const ctx of inputs) assert.doesNotMatch(JSON.stringify(ctx), /probably confuses|Legacy rationale/);
    assert.equal('learning' in j.get(), false);
    j.close();
    const stored = body();
    assert.deepEqual(stored.learning, legacy.learning);
    assert.equal(stored.attempts[0].card.rationale, rationale);
    j = openJournal(path, backend);
  } finally {
    j.close();
    rmSync(folder, { recursive: true });
  }
});

test('a generated exercise matching a card from the replaced session is served, not reported as a failure', async () => {
  const catalogueCard = catalogue[0]!;
  const j = openJournal(':memory:', {
    ...demo,
    tutor: async (ctx) => {
      if (ctx.trigger !== 'practice') return demoTutor(ctx);
      const { kind, prompt, choices, answer, explanation } = catalogueCard;
      return {
        reply: '修复 restores what was damaged.',
        action: {
          kind: 'practice',
          title: 'Restoring data',
          detail: 'Collocation.',
          exercise: { kind, prompt, choices, answer, explanation },
        },
      };
    },
  });
  try {
    // A fresh journal serves the starter catalogue.
    const starter = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    assert.equal(starter.practice.card?.id, catalogueCard.id);
    await j.act({ id: randomUUID(), type: 'chat', source: '', message: '数据坏了，要修复。' });
    const next = await j.act({ id: randomUUID(), type: 'practice', mode: 'Build vocabulary' });
    assert.equal(next.notice, '');
    assert.equal(next.practice.card?.prompt, catalogueCard.prompt);
    assert.notEqual(next.practice.card?.id, catalogueCard.id);
  } finally {
    j.close();
  }
});
