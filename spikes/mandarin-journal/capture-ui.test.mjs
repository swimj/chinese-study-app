import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapture, replyTarget } from './public/capture.js';

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

function openComposer(ui = {}, canSubmit = () => true) {
  const nodes = new Map();
  const actions = [];
  let focused;
  function get(id) {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', hidden: false,
      focus() { focused = id; },
      matches: () => Boolean(focused),
    });
    return nodes.get(id);
  }
  const form = get('word-form');
  form.requestSubmit = () => form.onsubmit({ preventDefault() {} });
  const capture = createCapture({ get, ui, canSubmit, persist() {}, submit: action => actions.push(action) });
  function type(id, value) {
    get(id).value = value;
    form.oninput();
  }
  function key(id, key, extra = {}) {
    form.onkeydown({ target: get(id), key, preventDefault() {}, ...extra });
  }
  return { actions, get, type, key, focused: () => focused, send: form.requestSubmit, restore: capture.restore };
}
test('the first step buffers Han text even while the server is unavailable; reload resumes the same draft', () => {
  const ui = {};
  const first = openComposer(ui, () => false);
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
  const reopened = openComposer(ui);
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
test('blank Enter sends just the word once, including after reloading a blank context step', () => {
  const ui = {};
  const slip = openComposer(ui);
  slip.type('word-text', '试点');
  slip.key('word-text', 'Enter');
  assert.deepEqual(slip.actions, []);
  const resumed = openComposer(ui);
  resumed.key('word-context', 'Enter', { repeat: true });
  assert.deepEqual(resumed.actions, []);
  resumed.key('word-context', 'Enter');
  assert.deepEqual(resumed.actions, [{ type: 'capture', text: '试点' }]);
  assert.equal(resumed.focused(), 'word-text');
});

test('Escape returns to the original draft and keeps the optional note', () => {
  const slip = openComposer();
  slip.type('word-text', '他说“值得”');
  slip.send();
  slip.type('word-context', 'in a podcast');
  slip.key('word-context', 'Escape');
  assert.deepEqual(slip.actions, []);
  assert.equal(slip.focused(), 'word-text');
  slip.send();
  assert.equal(slip.get('word-context').value, 'in a podcast');
  slip.send();
  assert.deepEqual(slip.actions, [{ type: 'capture', text: '他说“值得”', context: 'in a podcast' }]);
});

test('English and standalone URLs bypass context, including URLs with a Han path', () => {
  for (const text of ['https://example.org/文章', 'Can we practice?']) {
    const slip = openComposer({ wordDraft: '值得', wordContext: 'a podcast' });
    slip.type('word-text', text);
    assert.equal(slip.get('word-context').hidden, true);
    slip.key('word-text', 'Enter');
    assert.deepEqual(slip.actions, [{ type: 'capture', text }]);
  }
});

test('sending frees the composer immediately and preserves both pending input and the next draft', () => {
  const ui = { wordDraft: '值得', wordContext: 'a podcast' };
  let pending = false;
  const slip = openComposer(ui, () => !pending);
  slip.send();
  slip.send();
  const [first] = slip.actions;
  assert.deepEqual(first, { type: 'capture', text: '值得', context: 'a podcast' });
  assert.equal(slip.get('word-text').value, '');
  assert.equal(slip.get('word-context').value, '');
  pending = true;
  slip.type('word-text', 'https://example.org/article');
  slip.send();
  assert.deepEqual(slip.actions, [first]);
  assert.equal(ui.wordDraft, 'https://example.org/article');
  pending = false;
  slip.send();
  assert.deepEqual(slip.actions[1], { type: 'capture', text: 'https://example.org/article' });
  slip.restore(first);
  assert.equal(slip.get('word-text').value, '值得');
  assert.equal(ui.wordContext, 'a podcast');
  assert.equal(slip.get('word-context').hidden, false);
  assert.equal(slip.focused(), 'word-context');
});
