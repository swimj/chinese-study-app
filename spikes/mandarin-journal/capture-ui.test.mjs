import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapture, replyTarget } from './public/capture.js';

test('the composer submits one capture action and clears only the accepted draft', () => {
  const ui = { wordDraft: '值得', wordContext: 'a podcast' };
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {});
    return nodes.get(id);
  };
  const actions = [];
  const capture = createCapture({ get, ui, persist() {}, canSubmit: () => true, submit: action => actions.push(action) });
  const form = get('word-form');
  const input = get('word-text');
  const context = get('word-context');
  const send = () => form.onsubmit({ preventDefault() {} });

  send();
  const first = actions[0];
  assert.deepEqual(first, { type: 'capture', text: '值得', context: 'a podcast' });
  assert.equal(input.value, '值得');
  assert.equal(ui.wordContext, 'a podcast');
  send();
  assert.deepEqual(actions[1], first);
  input.value = 'https://example.org/article';
  context.value = '';
  form.oninput();
  capture.accepted(first);
  assert.equal(ui.wordDraft, input.value);
  send();
  assert.deepEqual(actions[2], { type: 'capture', text: 'https://example.org/article' });
  capture.accepted(actions[2]);
  assert.equal(input.value, '');
  assert.equal(ui.wordDraft, undefined);
});

test('each open tutor question carries its own reply target and resolved questions have none', () => {
  const capture = { role: 'assistant', text: 'Which part?', captureQuestionId: 'capture-id' };
  const word = { role: 'assistant', wordIntakeId: 'word-id', wordRequestId: 'word-request' };
  const state = {
    tutor: [{ role: 'user', id: 'capture-id', text: '我刚刚才到。' }, capture, word],
    wordIntakes: [{ id: 'word-id', text: '行', requestId: 'word-request', status: 'clarify' }],
  };
  assert.deepEqual(replyTarget(state, capture), { captureQuestionId: 'capture-id', label: '我刚刚才到。' });
  assert.deepEqual(replyTarget(state, word), { wordReplyTo: { intakeId: 'word-id', requestId: 'word-request' }, label: '行' });
  state.wordIntakes[0].requestId = 'retried';
  assert.equal(replyTarget(state, word), undefined);
  capture.captureResolved = true;
  assert.equal(replyTarget(state, capture), undefined);
});
