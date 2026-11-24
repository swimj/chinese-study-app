import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import { situationFor, validateTurn } from './situations/index.ts';
import type { TurnContext, TutorResult } from './tutor.ts';

const base: TurnContext = {
  trigger: 'ask',
  message: '只是 and 只 — what is the difference?',
  surface: 'home',
  source: '',
  tutorHistory: [],
  chatHistory: [],
  saved: [],
  practiceStatus: { pending: [], active: [] },
};
const open = {
  kind: 'open' as const,
  prompt: 'Tell a friend you are just waiting.',
  accepted: [], choices: [],
  answer: '我只是在等。',
  explanation: '只是 frames waiting as all you are doing.',
};
const practice = { kind: 'practice' as const, title: 'Just waiting', detail: 'Scope of 只.', exercise: open };

test('ask requires a reply and a complete action, and owns no other effect', () => {
  const ask = { ...base };
  assert.deepEqual(validateTurn('ask', { reply: 'Here.', action: practice }, ask), { reply: 'Here.', action: practice });
  assert.throws(() => validateTurn('ask', { reply: ' ', action: null }, ask), /no reply/);
  assert.throws(() => validateTurn('ask', { reply: 'Saved.', action: { ...practice, kind: 'stash' } }, ask), /Only practice/);
  assert.throws(() => validateTurn('ask', { reply: 'Saved.', action: { ...practice, title: ' ' } }, ask), /incomplete action/);
  assert.throws(
    () => validateTurn('ask', { reply: 'Ready.', action: { ...practice, exercise: { ...open, choices: ['等'] } } }, ask),
    /cannot include choices/,
  );
  const choice = { ...open, kind: 'choice' as const, accepted: [], choices: ['只', '只是', '只'], answer: '只是' };
  assert.throws(
    () => validateTurn('ask', { reply: 'Ready.', action: { ...practice, exercise: choice } }, ask),
    /invalid contrast/,
  );
  assert.throws(() => validateTurn('ask', { reply: 'Hi.', action: null, observation: 'x' }, ask), /Only exercise feedback/);
  assert.throws(
    () => validateTurn('ask', { reply: 'Hi.', action: null, reflection: { overview: 'x', takeaways: [] } }, ask),
    /Only reflection/,
  );
  assert.throws(
    () => validateTurn('ask', { reply: 'Hi.', wordDecision: { kind: 'clarify', question: '?', suggestions: [] } }, ask),
    /Unexpected word intake/,
  );
  assert.throws(() => validateTurn('feedback', { reply: 'Hi.' }, ask), /does not belong/);
});

test('feedback may be silent, may carry one nonempty observation, and cannot change the journal', () => {
  const miss = { ...base, trigger: 'miss' as const };
  assert.deepEqual(validateTurn('feedback', { reply: '', action: null }, miss), { reply: '', observation: null });
  const answer = { ...base, trigger: 'answer' as const };
  assert.equal(validateTurn('feedback', { reply: 'Clear.', observation: 'Scope.' }, answer).observation, 'Scope.');
  assert.throws(() => validateTurn('feedback', { reply: 'Clear.', observation: ' ' }, answer), /empty observation/);
  assert.throws(() => validateTurn('feedback', { reply: 'Clear.', action: practice }, answer), /cannot change the journal/);
});

test('practice generation returns at most one complete practice action', () => {
  const ctx = { ...base, trigger: 'practice' as const };
  assert.deepEqual(validateTurn('practiceGen', { reply: '', action: null }, ctx), { reply: '', action: null });
  assert.equal(validateTurn('practiceGen', { reply: '', action: practice }, ctx).action, practice);
  assert.throws(
    () => validateTurn('practiceGen', { reply: '', action: { ...practice, kind: 'stash', exercise: null } }, ctx),
    /no practice/,
  );
  assert.throws(
    () => validateTurn('practiceGen', { reply: '', action: { ...practice, exercise: { ...open, explanation: '' } } }, ctx),
    /incomplete exercise/,
  );
});

test('a reflection must anchor each takeaway to an exact quote from a learner line', () => {
  const ctx = {
    ...base,
    trigger: 'reflect' as const,
    reflectionTurns: [
      { id: 'a', role: 'user' as const, text: '我在等着鸟来喂。' },
      { id: 'b', role: 'assistant' as const, text: '鸟来吃鸟食吗？' },
    ],
  };
  const anchored = { overview: 'Birds.', takeaways: [{ messageId: 'a', quote: '鸟来喂', text: 'Who feeds whom?' }] };
  assert.deepEqual(validateTurn('reflect', { reply: 'Birds.', action: null, reflection: anchored }, ctx), {
    reflection: anchored,
  });
  for (const takeaway of [
    { messageId: 'b', quote: '鸟食', text: 'Partner line.' },
    { messageId: 'a', quote: '鸟来吃', text: 'Not a quote.' },
    { messageId: 'a', quote: '鸟来喂', text: ' ' },
  ])
    assert.throws(
      () => validateTurn('reflect', { reflection: { overview: 'Birds.', takeaways: [takeaway] } }, ctx),
      /anchored/,
    );
  assert.throws(() => validateTurn('reflect', { reflection: { overview: ' ', takeaways: [] } }, ctx), /overview/);
  assert.throws(() => validateTurn('reflect', { reply: 'Birds.' }, ctx), /overview/);
});

test('word intake returns exactly one decision for the domain validator', () => {
  const ctx = { ...base, trigger: 'wordIntake' as const };
  const wordDecision = { kind: 'clarify' as const, question: 'Study 蜘蛛?', suggestions: ['蜘蛛'] };
  assert.deepEqual(validateTurn('wordIntake', { reply: '', action: null, wordDecision }, ctx), { wordDecision });
  assert.throws(() => validateTurn('wordIntake', { reply: '' }, ctx), /one word intake decision/);
  assert.throws(() => validateTurn('wordIntake', { wordDecision, action: practice }, ctx), /cannot change the journal/);
});

test('the offline demo tutor satisfies each situation it answers', () => {
  const reflectionTurns = [
    { id: 'one', role: 'user' as const, text: '我在等着鸟来喂。' },
    { id: 'two', role: 'assistant' as const, text: '在家容易分心吗？' },
    { id: 'three', role: 'user' as const, text: '只在等，好像有点儿不对？' },
  ];
  const inputs: TurnContext[] = [
    { ...base },
    { ...base, message: 'Please save 只是 for study.' },
    { ...base, message: 'Note to self: listen for 只是.' },
    { ...base, message: 'Can you queue an exercise about 只是?' },
    { ...base, message: 'Did you queue the exercise about 只是?' },
    { ...base, message: 'Something without an offline example' },
    { ...base, trigger: 'reflect', reflectionTurns },
    { ...base, trigger: 'practice', source: '等着鸟来喂', surface: 'Daily mix' },
    { ...base, trigger: 'practice', surface: 'Daily mix' },
    { ...base, trigger: 'answer', source: 'Expressing only', message: '我只在等' },
    { ...base, trigger: 'miss', source: '修复', message: '修理' },
    { ...base, trigger: 'miss', message: 'nothing to add' },
  ];
  for (const input of inputs) validateTurn(situationFor(input.trigger), demoTutor(input), input);
});

test('demo and live results pass the same validation before the journal applies anything', async () => {
  let reply: TutorResult = { reply: '', action: null };
  const j = openJournal(':memory:', {
    mode: 'demo',
    tutor: async (ctx) => (ctx.trigger === 'ask' || ctx.trigger === 'answer' ? reply : demoTutor(ctx)),
    friend: async (ctx) => demoFriend(ctx),
  });
  try {
    const ask = { type: 'tutor' as const, surface: 'home', source: '', message: 'What does 只是 mean?' };
    // An empty reply no longer leaves an unanswered learner message.
    await assert.rejects(j.act({ ...ask, id: randomUUID() }), /no reply/);
    assert.equal(j.get().tutor.length, 0);
    reply = { reply: 'It frames the activity.', action: { ...practice, exercise: { ...open, prompt: ' ' } } };
    await assert.rejects(j.act({ ...ask, id: randomUUID() }), /incomplete exercise/);
    assert.deepEqual([j.get().tutor.length, j.get().activity.length], [0, 0]);
    reply = { reply: 'It frames the activity.', action: practice };
    await j.act({ ...ask, id: randomUUID() });
    assert.equal(j.get().tutor.length, 2);
    // A feedback turn that tries to queue practice is refused; the attempt still records.
    reply = { reply: 'Nice.', action: { ...practice, exercise: { ...open, prompt: 'Another prompt' } } };
    const started = await j.act({ id: randomUUID(), type: 'practice', mode: 'Daily mix' });
    const cardId = started.practice.card!.id;
    const answered = await j.act({ id: randomUUID(), type: 'answer', cardId, answer: '我只是在等。' });
    assert.match(answered.notice, /feedback is unavailable/);
    assert.equal(answered.attempts.length, 1);
    assert.equal(answered.activity.filter((row) => row.text.startsWith('Queued')).length, 1);
  } finally {
    j.close();
  }
});

test('teaching returns 1–8 unique beats, keeps the first Chinese sentence apart from its translation, and owns no other effect', () => {
  const teach: TurnContext = { ...base, trigger: 'teach', teach: { form: '分心', pinyin: 'fēnxīn', gloss: 'Be distracted.' } };
  const sentence = { kind: 'chinese' as const, text: '手机一响，我就容易分心。', pinyin: 'Shǒujī yì xiǎng, wǒ jiù róngyì fēnxīn.' };
  const translation = { kind: 'translation' as const, text: 'I get distracted easily when my phone rings.', pinyin: null };
  const beats = [
    { id: 'a', parts: [{ kind: 'note' as const, text: '分心 is attention pulled away.', pinyin: 'fēnxīn' }] },
    { id: 'b', parts: [sentence] },
    { id: 'c', parts: [translation, { kind: 'chinese' as const, text: '我又分心了。', pinyin: ' ' }, { ...translation, text: 'I got distracted again.' }] },
  ];
  assert.deepEqual(validateTurn('teach', { beats }, teach).beats, [
    { id: 'a', parts: [{ kind: 'note', text: '分心 is attention pulled away.' }] },
    { id: 'b', parts: [sentence] },
    { id: 'c', parts: [{ kind: 'translation', text: translation.text }, { kind: 'chinese', text: '我又分心了。' }, { kind: 'translation', text: 'I got distracted again.' }] },
  ]);
  assert.throws(() => validateTurn('teach', { beats: [] }, teach), /1–8 beats/);
  const many = Array.from({ length: 9 }, (_, i) => ({ id: 'b' + i, parts: [{ kind: 'text' as const, text: 'More.' }] }));
  assert.throws(() => validateTurn('teach', { beats: many }, teach), /1–8 beats/);
  assert.throws(() => validateTurn('teach', { beats: [beats[0], { ...beats[1], id: 'a' }] }, teach), /unique/);
  assert.throws(() => validateTurn('teach', { beats: [{ id: 'a', parts: [] }] }, teach), /no parts/);
  assert.throws(() => validateTurn('teach', { beats: [{ id: 'a', parts: [{ kind: 'text', text: ' ' }] }] }, teach), /empty/);
  assert.throws(() => validateTurn('teach', { beats: [{ id: 'a', parts: [sentence, translation] }] }, teach), /separate beats/);
  assert.throws(() => validateTurn('teach', { beats: [{ id: 'a', parts: [translation] }] }, teach), /Chinese sentence before/);
  assert.throws(() => validateTurn('teach', { beats, reply: 'Here is the word.' }, teach), /only through its beats/);
  assert.throws(() => validateTurn('teach', { beats, action: practice }, teach), /cannot change/);
  assert.throws(() => validateTurn('feedback', { reply: 'Ok.', beats }, { ...base, trigger: 'answer' }), /Only teaching/);
  assert.equal(situationFor('teach'), 'teach');
});

test('offline teaching validates for the fixture words and falls back to a generic introduction', () => {
  const forms: [string, string | null, string | null][] = [
    ['透透气', 'tòu tou qì', 'Get some air.'],
    ['报备', 'bàobèi', 'Notify someone for the record.'],
    ['分心', 'fēnxīn', 'Be distracted.'],
    ['鸟食', 'niǎoshí', 'Bird food.'],
    ['蜘蛛', null, null],
  ];
  for (const [form, pinyin, gloss] of forms) {
    const ctx: TurnContext = { ...base, trigger: 'teach', teach: { form, pinyin, gloss } };
    const { beats } = validateTurn('teach', demoTutor(ctx), ctx);
    assert.ok(beats.some((b) => b.parts.some((p) => p.text.includes(form))), form + ' is named');
  }
  const ctx: TurnContext = {
    ...base,
    trigger: 'teach',
    teach: { form: '散场', pinyin: 'sànchǎng', gloss: 'An event ends.', example: '电影散场了。', translation: 'The movie let out.' },
  };
  assert.deepEqual(validateTurn('teach', demoTutor(ctx), ctx).beats.map((b) => b.parts[0].kind), ['note', 'chinese', 'translation']);
});
