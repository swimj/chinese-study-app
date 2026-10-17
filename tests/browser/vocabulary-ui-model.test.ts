import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceLabWord, bringBackLabWord, checkLabAnswer, initialLabState } from './vocabulary-ui-model.ts';

test('lab wrong and blank answers are rejected and do not cover a word', () => {
  for (const value of ['', '不想', 'xyz']) {
    const result = checkLabAnswer({ ...initialLabState(), value });
    assert.equal(result.assessment, 'rejected');
    assert.equal(result.marks.reluctant, 'open');
    assert.ok(result.seen.includes('reluctant'));
  }
});
test('one correct lab exercise covers its word and advances to a different word', () => {
  const checked = checkLabAnswer({ ...initialLabState(), value: ' 舍不得。 ' });
  assert.equal(checked.assessment, 'accepted');
  assert.equal(checked.marks.reluctant, 'covered');
  const next = advanceLabWord(checked, 'covered');
  assert.equal(next.activeWordId, 'maybe');
  assert.equal(next.phase, 'active');
});
test('lab session reaches a summary after the finite default queue', () => {
  const first = advanceLabWord(checkLabAnswer({ ...initialLabState(), value: '舍不得' }), 'covered');
  const finished = advanceLabWord(checkLabAnswer({ ...first, value: '说不定' }), 'covered');
  assert.equal(finished.phase, 'summary');
});
test('bringing a covered word back keeps its coverage and returns to interrupted work', () => {
  const broughtBack = bringBackLabWord(initialLabState(), 'unexpected');
  assert.equal(broughtBack.extra, true);
  assert.equal(broughtBack.marks.unexpected, 'covered');
  const satisfied = advanceLabWord(broughtBack, 'covered');
  assert.equal(satisfied.activeWordId, 'reluctant');
  assert.equal(satisfied.marks.unexpected, 'covered');
  assert.equal(satisfied.extra, false);
});
test('explicit coverage and leaving for today have distinct lab results', () => {
  assert.equal(advanceLabWord(initialLabState(), 'covered').marks.reluctant, 'covered');
  const left = advanceLabWord(initialLabState(), 'left');
  assert.equal(left.marks.reluctant, 'left');
  assert.equal(left.activeWordId, 'maybe');
});

test('revisiting an old lab word moves it to the recent end without duplicating or dropping history', () => {
  const session = initialLabState();
  const revisited = bringBackLabWord(session, 'unexpected');
  assert.deepEqual(revisited.seen, ['overall', 'unexpected']);
  assert.equal(new Set(revisited.seen).size, session.seen.length);
});
