import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapture, replyTarget } from './public/capture.js';

test('sending frees the composer immediately and preserves both pending input and the next draft', () => {
  const ui = { wordDraft: '值得', wordContext: 'a podcast' };
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {});
    return nodes.get(id);
  };
  const actions = [];
  let pending = false;
  const capture = createCapture({
    get, ui, persist() {}, canSubmit: () => !pending,
    submit(action) { actions.push(action); pending = true; },
  });
  const form = get('word-form');
  const input = get('word-text');
  const context = get('word-context');
  const send = () => form.onsubmit({ preventDefault() {} });

  send();
  const first = actions[0];
  assert.deepEqual(first, { type: 'capture', text: '值得', context: 'a podcast' });
  assert.equal(input.value, '');
  assert.equal(context.value, '');
  assert.equal(get('word-context-toggle').open, false);
  input.value = 'https://example.org/article';
  form.oninput();
  send();
  assert.equal(actions.length, 1);
  assert.equal(ui.wordDraft, input.value);
  pending = false;
  send();
  assert.deepEqual(actions[1], { type: 'capture', text: 'https://example.org/article' });
  assert.equal(ui.wordDraft, '');
  capture.restore(first);
  assert.equal(input.value, '值得');
  assert.equal(context.value, 'a podcast');
  assert.equal(ui.wordContext, 'a podcast');
  assert.equal(get('word-context-toggle').open, true);
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

function openTrial(variant, ui = {}, canSubmit = () => true) {
  const nodes = new Map();
  const actions = [];
  let focused;
  function get(id) {
    if (!nodes.has(id)) nodes.set(id, {
      dataset: {}, value: '', hidden: false, append() {},
      focus() { focused = id; },
      closest: get, querySelector: get,
    });
    return nodes.get(id);
  }
  const form = get('word-form');
  form.requestSubmit = () => form.onsubmit({ preventDefault() {} });
  createCapture({ variant, get, ui, canSubmit, persist() {}, submit: action => actions.push(action) });
  function type(id, value) {
    get(id).value = value;
    form.oninput();
  }
  function key(id, key, extra = {}) {
    form.onkeydown({ target: get(id), key, preventDefault() {}, ...extra });
  }
  return { actions, get, type, key, focused: () => focused, send: form.requestSubmit };
}
test('the first step buffers Han text even while the server is unavailable; reload resumes the same draft', () => {
  const ui = {};
  const first = openTrial('stepwise', ui, () => false);
  first.type('word-text', '值得');
  first.key('word-text', 'Enter', { isComposing: true });
  first.key('word-text', 'Enter', { keyCode: 229 });
  assert.equal(ui.wordStep, undefined);
  first.key('word-text', 'Enter');
  assert.equal(first.focused(), 'word-context');
  assert.equal(first.get('word-back').hidden, false);
  first.type('word-context', 'a podcast');
  first.send();
  assert.deepEqual(first.actions, []);
  const reopened = openTrial('stepwise', ui);
  assert.equal(reopened.get('word-back').hidden, false);
  assert.equal(reopened.get('word-context').value, 'a podcast');
  reopened.get('word-back').onclick();
  assert.equal(reopened.focused(), 'word-text');
  reopened.type('word-text', '值得一看');
  reopened.send();
  reopened.key('word-context', 'Enter', { shiftKey: true });
  assert.deepEqual(reopened.actions, []);
  reopened.key('word-context', 'Enter');
  assert.deepEqual(reopened.actions, [{ type: 'capture', text: '值得一看', context: 'a podcast' }]);
  assert.equal(ui.wordStep, undefined);
  assert.equal(ui.wordDraft, '');
});
test('stepping past an optional note sends once, without the note', () => {
  const slip = openTrial('stepwise');
  slip.type('word-text', '他说“值得”');
  slip.send();
  slip.type('word-context', 'discard this');
  slip.key('word-context', 'Escape');
  assert.deepEqual(slip.actions, [{ type: 'capture', text: '他说“值得”' }]);
  assert.equal(slip.focused(), 'word-text');
});
for (const variant of ['inline', 'stepwise']) {
  test(variant + ' bypasses context for English and standalone URLs, including a Han path', () => {
    for (const text of ['https://example.org/文章', 'Can we practice?']) {
      const ui = { wordDraft: '值得', wordContext: 'a podcast' };
      const slip = openTrial(variant, ui);
      slip.type('word-text', text);
      assert.equal(slip.get('word-context-toggle').hidden, true);
      slip.key('word-text', 'Enter');
      assert.deepEqual(slip.actions, [{ type: 'capture', text }]);
    }
  });
}
test('the inline slip submits a bare word on Enter and preserves an optional note through reload', () => {
  const ui = {};
  const slip = openTrial('inline', ui);
  slip.type('word-text', '值得');
  assert.equal(slip.get('word-context-toggle').hidden, false);
  slip.key('word-text', 'Enter');
  slip.type('word-text', '鸟食');
  slip.get('summary').onclick({ preventDefault() {} });
  assert.equal(slip.focused(), 'word-context');
  slip.type('word-context', 'at the park');
  const reopened = openTrial('inline', ui);
  assert.equal(reopened.get('word-context-toggle').open, true);
  reopened.key('word-context', 'Escape');
  assert.equal(reopened.focused(), 'word-text');
  reopened.send();
  assert.deepEqual([...slip.actions, ...reopened.actions], [
    { type: 'capture', text: '值得' },
    { type: 'capture', text: '鸟食', context: 'at the park' },
  ]);
});
