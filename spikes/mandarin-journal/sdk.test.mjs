import assert from 'node:assert/strict';
import test from 'node:test';
test('real SDK runs each situation with its own schema and instructions, uses recall and isolates casual chat', async () => {
  process.env.OPENAI_API_KEY = 'placeholder';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.OPENAI_AGENTS_DISABLE_TRACING = '1';
  const requests = [];
  let replies = [];
  const plain = (text) => ({
    type: 'message',
    role: 'assistant',
    status: 'completed',
    id: 'msg_1',
    content: [{ type: 'output_text', annotations: [], text }],
  });
  const structured = (output) => plain(JSON.stringify(output));
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:1\/v1\/responses$/);
    const req = JSON.parse(options.body);
    requests.push(req);
    assert.equal(req.store, false);
    const out = replies.shift();
    assert(out, 'unexpected model turn');
    return new Response(
      JSON.stringify({
        id: 'resp_' + requests.length,
        object: 'response',
        status: 'completed',
        output: [out],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const { tutorTurn, friendTurn } = await import('./tutor.ts');
  const { validateTurn, voice } = await import('./situations/index.ts');
  const input = {
    trigger: 'ask',
    message: 'fixture',
    surface: 'read',
    source: 'example',
    tutorHistory: [],
    chatHistory: [{ role: 'user', text: 'chat-only context' }],
    topic: 'Watching birds',
    practiceStatus: { pending: [{ title: 'An exercise', prompt: 'queued example' }], active: [] },
    previousPrompts: ['previous exercise'],
    readingContext: 'selected paragraph',
    saved: [{ kind: 'Note', title: 'sample observation', detail: 'from a page' }],
    annotations: [{ role: 'user', text: 'my margin question', source: 'The river', quote: '河边' }],
  };
  const required = (req) => req.text.format.schema.required.toSorted();
  const userPayload = (req) => JSON.parse(req.input.find((item) => item.role === 'user').content);
  replies = [
    {
      type: 'function_call',
      call_id: 'call_1',
      id: 'fc_1',
      name: 'recall',
      arguments: JSON.stringify({ query: 'sample', from: 'saved' }),
      status: 'completed',
    },
    structured({ reply: 'One reply.', action: null }),
  ];
  assert.deepEqual(await tutorTurn(input), { reply: 'One reply.', action: null });
  assert.equal(requests[0].text.format.type, 'json_schema');
  assert.deepEqual(required(requests[0]), ['action', 'reply']);
  // Every situation speaks as the same tutor and carries only its own instructions.
  assert.ok(requests[0].instructions.startsWith(voice));
  assert.match(requests[0].instructions, /On ask, first answer/);
  assert.doesNotMatch(requests[0].instructions, /On reflect|On wordIntake|On miss|On practice,/);
  assert.match(JSON.stringify(requests[1].input), /sample observation/);
  const ask = userPayload(requests[0]);
  assert.deepEqual(ask.practiceStatus, input.practiceStatus);
  assert.equal(ask.readingContext, input.readingContext);
  assert.equal(ask.recentChatTurns, undefined);
  assert.equal(ask.previousPrompts, undefined);
  const captureInput = {
    ...input, trigger: 'capture', surface: 'home', message: '这本书值得再读一遍。', source: 'Book club',
  };
  const captureResult = { kind: 'clarify', question: 'Which part would you like to explore?' };
  replies = [structured({ capture: captureResult })];
  assert.deepEqual(validateTurn('capture', await tutorTurn(captureInput), captureInput), captureResult);
  const captureRequest = requests.at(-1);
  assert.deepEqual(required(captureRequest), ['capture']);
  assert.deepEqual(captureRequest.tools ?? [], []);
  assert.equal(userPayload(captureRequest).message, captureInput.message);
  assert.equal(userPayload(captureRequest).source, captureInput.source);
  replies = [
    {
      type: 'function_call',
      call_id: 'call_annotation',
      id: 'fc_annotation',
      name: 'recall',
      arguments: JSON.stringify({ query: '河边', from: 'annotations' }),
      status: 'completed',
    },
    structured({ reply: 'You asked about the river.', action: null }),
  ];
  await tutorTurn(input);
  assert.match(JSON.stringify(requests.at(-1).input), /my margin question/);
  replies = [structured({ reply: 'Inline feedback.', observation: 'Specific insight.' })];
  const answer = { ...input, trigger: 'answer' };
  assert.equal(validateTurn('feedback', await tutorTurn(answer), answer).observation, 'Specific insight.');
  assert.deepEqual(required(requests.at(-1)), ['observation', 'reply']);
  assert.match(requests.at(-1).instructions, /On miss the learner is still practicing/);
  assert.equal(userPayload(requests.at(-1)).practiceStatus, undefined);
  const reflectionTurns = Array.from({ length: 15 }, (_, i) => ({
    id: 'anchor-' + i,
    text: 'Learner message ' + i,
    role: 'user',
  }));
  const reflection = {
    overview: 'Overview.',
    takeaways: [{ messageId: 'anchor-0', quote: 'Learner message 0', text: 'An observation.' }],
  };
  replies = [structured({ reflection })];
  const reflectInput = { ...input, trigger: 'reflect', reflectionTurns };
  assert.deepEqual(validateTurn('reflect', await tutorTurn(reflectInput), reflectInput).reflection, reflection);
  assert.deepEqual(required(requests.at(-1)), ['reflection']);
  assert.deepEqual(userPayload(requests.at(-1)).reflectionTurns, reflectionTurns);
  replies = [structured({ reply: '', observation: null })];
  assert.deepEqual(await tutorTurn({ ...input, trigger: 'miss' }), { reply: '', observation: null });
  replies = [
    structured({
      reply: 'Try this.',
      action: {
        kind: 'practice',
        title: 'Distinction',
        detail: 'Example.',
        exercise: {
          kind: 'choice',
          choices: ['词一', '词二'],
          accepted: [],
          prompt: '测试',
          answer: '词三',
          explanation: 'Example.',
        },
      },
    }),
  ];
  const practice = { ...input, trigger: 'practice' };
  const invalid = await tutorTurn(practice);
  assert.throws(() => validateTurn('practiceGen', invalid, practice), /invalid contrast/);
  assert.deepEqual(required(requests.at(-1)), ['action', 'reply']);
  assert.match(JSON.stringify(requests.at(-1).text.format.schema), /"const":"practice"|"enum":\["practice"\]/);
  assert.deepEqual(userPayload(requests.at(-1)).previousPrompts, input.previousPrompts);
  const silentCard = {
    kind: 'practice',
    title: 'Another scene',
    detail: 'Use it in context.',
    exercise: {
      kind: 'open',
      prompt: 'Describe the scene.',
      choices: [],
      accepted: [],
      answer: '在窗边等。',
      explanation: 'Give the location.',
    },
  };
  replies = [structured({ reply: '', action: silentCard })];
  assert.deepEqual(validateTurn('practiceGen', await tutorTurn(practice), practice).action, silentCard);
  const wordIntake = { text: '蜘', context: '蜘蛛', history: [], localWords: [] };
  const wordDecision = { kind: 'clarify', question: 'Study the whole word 蜘蛛?', suggestions: ['蜘蛛'] };
  replies = [structured({ wordDecision })];
  const intake = { ...input, trigger: 'wordIntake', wordIntake };
  assert.deepEqual(validateTurn('wordIntake', await tutorTurn(intake), intake).wordDecision, wordDecision);
  assert.deepEqual(required(requests.at(-1)), ['wordDecision']);
  assert.deepEqual(userPayload(requests.at(-1)).wordIntake, wordIntake);
  assert.equal(userPayload(requests.at(-1)).recentTutorTurns, undefined);
  assert.doesNotMatch(JSON.stringify(requests.at(-1).text.format.schema), /"oneOf"/);
  replies = [plain('嗯。')];
  assert.equal(await friendTurn(input), '嗯。');
  assert(!JSON.stringify(requests.at(-1)).includes('sample observation'));
  assert(!JSON.stringify(requests.at(-1)).includes('my margin question'));
  assert(!requests.at(-1).tools?.length);
  const chat = userPayload(requests.at(-1));
  assert.equal(chat.topic, input.topic);
  assert.deepEqual(chat.recentChatTurns, input.chatHistory);
  assert.equal(chat.practiceStatus, undefined);
  assert.equal(chat.recentTutorTurns, undefined);
});

test('offline reflection anchors scoped learner lines and practice respects the requested target', async () => {
  const { demoTutor, demoFriend } = await import('./practice.ts');
  const input = {
    surface: 'Chat',
    source: '',
    message: '你好',
    topic: 'Watching birds',
    chatHistory: [],
    tutorHistory: [],
    saved: [],
  };
  const first = demoFriend(input);
  assert.match(first, /麻雀/);
  assert.notEqual(demoFriend({ ...input, chatHistory: [{ role: 'assistant', text: first }] }), first);
  const reflectionTurns = [
    { id: 'one', role: 'user', text: '我在等着鸟来喂。' },
    { id: 'two', role: 'assistant', text: '在家容易分心吗？' },
    { id: 'three', role: 'user', text: '只在等，好像有点儿不对？' },
  ];
  const reflected = demoTutor({ ...input, trigger: 'reflect', reflectionTurns });
  assert.equal(reflected.action, null);
  assert.match(reflected.reflection.overview, /birds/);
  assert.deepEqual(
    reflected.reflection.takeaways.map((item) => item.messageId),
    ['one', 'three'],
  );
  for (const item of reflected.reflection.takeaways)
    assert(
      reflectionTurns
        .find((turn) => turn.id === item.messageId && turn.role === 'user')
        .text.includes(item.quote),
    );
  const previousPrompts = [];
  for (let i = 0; i < 6; i++) {
    const { action } = demoTutor({ ...input, source: '等着鸟来喂', trigger: 'practice', previousPrompts });
    assert.equal(action.kind, 'practice');
    assert(!previousPrompts.includes(action.exercise.prompt));
    previousPrompts.push(action.exercise.prompt);
  }
  assert.equal(demoTutor({ ...input, trigger: 'practice' }).action, null);
  const feedback = demoTutor({ ...input, source: 'Expressing only', message: '我只在等', trigger: 'answer' });
  assert.match(feedback.observation, /只在这儿等/);
  const queued = demoTutor({ ...input, trigger: 'ask', message: 'Can you queue an exercise about 只是?' });
  assert.equal(queued.action.kind, 'practice');
  const practiceStatus = {
    pending: [{ title: queued.action.title, prompt: queued.action.exercise.prompt }],
    active: [],
  };
  for (const message of ['Did you queue the exercise about 只是?', 'Can you queue an exercise about 只是?']) {
    const result = demoTutor({ ...input, trigger: 'ask', message, practiceStatus });
    assert.match(result.reply, /Queued for later/);
    assert.equal(result.action, null);
  }
  assert.equal(
    demoTutor({ ...input, trigger: 'ask', message: 'Please save 只是 for study.' }).action.kind,
    'stash',
  );
  assert.equal(
    demoTutor({ ...input, trigger: 'ask', message: 'Note to self: listen for 只是.' }).action.kind,
    'note',
  );
});
