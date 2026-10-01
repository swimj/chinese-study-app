import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { materializeTeachingPackage } from '../src/domain/word-content/materialize.js';
import {
  initialIntroductionPlayerState,
  introductionPlayerKeyAction,
  reduceIntroductionPlayer,
  shouldConcealIntroductionAnswers,
} from '../src/features/introduction-lab/player.js';
import { wordContentFixtures } from './fixtures/word-content.js';

const { content, teaching } = wordContentFixtures[0]!;
const pkg = materializeTeachingPackage(teaching, [content]);

describe('local introduction player', () => {
  test('only active rehearsal conceals surrounding answer-bearing chrome', () => {
    assert.equal(shouldConcealIntroductionAnswers('introduction'), false);
    assert.equal(shouldConcealIntroductionAnswers('rehearsal'), true);
    assert.equal(shouldConcealIntroductionAnswers('result'), false);
    assert.equal(shouldConcealIntroductionAnswers('finished'), false);
  });

  test('Space respects typing, IME composition, held keys, and command modifiers', () => {
    const base = { key: ' ', repeat: false, composing: false, editable: false, modified: false };
    assert.deepEqual(introductionPlayerKeyAction(base, 'introduction'), { type: 'advance' });
    assert.deepEqual(introductionPlayerKeyAction(base, 'result'), { type: 'next' });
    assert.equal(introductionPlayerKeyAction(base, 'rehearsal'), null);
    assert.deepEqual(introductionPlayerKeyAction({ ...base, key: 'ArrowLeft' }, 'rehearsal'), { type: 'back' });
    for (const flag of ['repeat', 'composing', 'editable', 'modified'] as const) {
      assert.equal(introductionPlayerKeyAction({ ...base, [flag]: true }, 'introduction'), null);
    }
  });

  test('advances whole beats, keeps prior beats addressable, and bounds back navigation', () => {
    let state = initialIntroductionPlayerState();
    assert.deepEqual(reduceIntroductionPlayer(state, { type: 'back' }, pkg), state);
    assert.equal(pkg.beats[1]!.parts.length, 2);
    state = reduceIntroductionPlayer(state, { type: 'advance' }, pkg);
    assert.equal(state.beatIndex, 1);
    assert.equal(state.phase, 'introduction');
    state = reduceIntroductionPlayer(state, { type: 'back' }, pkg);
    assert.equal(state.beatIndex, 0);
    for (let index = 1; index < pkg.beats.length; index += 1) {
      state = reduceIntroductionPlayer(state, { type: 'advance' }, pkg);
    }
    assert.equal(state.beatIndex, pkg.beats.length - 1);
    assert.equal(state.phase, 'introduction');
    state = reduceIntroductionPlayer(state, { type: 'advance' }, pkg);
    assert.equal(state.phase, 'rehearsal');
    state = reduceIntroductionPlayer(state, { type: 'back' }, pkg);
    assert.equal(state.phase, 'introduction');
    assert.equal(state.beatIndex, pkg.beats.length - 1);
  });

  test('uses frozen target matching, then supports retry, reveal, and finish without evidence effects', () => {
    let state = initialIntroductionPlayerState();
    for (let index = 0; index < pkg.beats.length; index += 1) {
      state = reduceIntroductionPlayer(state, { type: 'advance' }, pkg);
    }
    assert.equal(state.phase, 'rehearsal');
    assert.deepEqual(reduceIntroductionPlayer(state, { type: 'submit' }, pkg), state);
    state = reduceIntroductionPlayer(state, { type: 'edit', response: '通知' }, pkg);
    state = reduceIntroductionPlayer(state, { type: 'submit' }, pkg);
    assert.equal(state.result, 'rejected');
    assert.equal(state.phase, 'result');
    state = reduceIntroductionPlayer(state, { type: 'retry' }, pkg);
    assert.equal(state.response, '');
    state = reduceIntroductionPlayer(state, { type: 'edit', response: ' 報 備 ' }, pkg);
    state = reduceIntroductionPlayer(state, { type: 'submit' }, pkg);
    assert.equal(state.result, 'accepted');
    state = reduceIntroductionPlayer(state, { type: 'next' }, pkg);
    assert.equal(state.phase, 'finished');
    assert.deepEqual(Object.keys(state).sort(), ['beatIndex', 'exerciseIndex', 'phase', 'response', 'result']);

    state = reduceIntroductionPlayer(initialIntroductionPlayerState(), { type: 'advance' }, pkg);
    for (let index = 1; index < pkg.beats.length; index += 1) state = reduceIntroductionPlayer(state, { type: 'advance' }, pkg);
    state = reduceIntroductionPlayer(state, { type: 'reveal' }, pkg);
    assert.equal(state.result, 'revealed');
  });

  test('each sample package can reach a deterministic finish', () => {
    for (const fixture of wordContentFixtures) {
      const snapshot = materializeTeachingPackage(fixture.teaching, [fixture.content]);
      let state = initialIntroductionPlayerState();
      for (let index = 0; index < snapshot.beats.length; index += 1) state = reduceIntroductionPlayer(state, { type: 'advance' }, snapshot);
      assert.equal(state.phase, 'rehearsal');
      for (let index = 0; index < snapshot.rehearsals.length; index += 1) {
        state = reduceIntroductionPlayer(state, { type: 'reveal' }, snapshot);
        state = reduceIntroductionPlayer(state, { type: 'next' }, snapshot);
      }
      assert.equal(state.phase, 'finished');
    }
  });
});
