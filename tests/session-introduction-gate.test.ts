import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkIntroductionGate, introductionGateCandidate, introductionGateStatus,
  sameIntroductionCompletionTarget, settleIntroductionGate,
} from '../src/features/session/introduction-gate.ts';
import type { WordIntroductionResponse } from '../src/domain/word-content/application.ts';

const base = { sessionId: 'session-1', visible: true, profile: 'mandarin', word: { id: 'word-1', status: 'unstudied' }, completedSession: false };
const response: WordIntroductionResponse = {
  wordId: 'word-1', contents: [], packages: [], selectedPackageId: null,
  completed: false, generationAvailable: true, model: 'model',
};

test('only active unstudied Mandarin words gate; existing learning/review/French bypass', () => {
  assert.ok(introductionGateCandidate(base));
  for (const change of [
    { sessionId: null }, { visible: false }, { completedSession: true }, { profile: 'french' },
    { word: null }, { word: { id: 'word-1', status: 'learning' } }, { word: { id: 'word-1', status: 'review' } },
  ]) assert.equal(introductionGateCandidate({ ...base, ...change }), null);
});

test('completion marker never grants coverage; available content allows teaching; missing content fails open visibly', () => {
  assert.equal(introductionGateStatus(response), 'introduction');
  assert.equal(introductionGateStatus({ ...response, completed: true }), 'introduction');
  assert.equal(introductionGateStatus({ ...response, generationAvailable: false }), 'unavailable');
});

test('skip and completion are navigation only; late fetch cannot reopen within same session', () => {
  const { key } = introductionGateCandidate(base)!;
  const passed = settleIntroductionGate({}, key, 'passed');
  assert.deepEqual(passed, { [key]: 'passed' });
  assert.equal(settleIntroductionGate(passed, key, 'introduction'), passed);
  assert.equal(settleIntroductionGate(passed, key, 'unavailable'), passed);
  const nextWord = introductionGateCandidate({ ...base, word: { id: 'word-2', status: 'unstudied' } })!;
  const nextSession = introductionGateCandidate({ ...base, sessionId: 'session-2' })!;
  assert.equal(passed[nextWord.key], undefined);
  assert.equal(passed[nextSession.key], undefined);
  const delayed = settleIntroductionGate({}, key, 'introduction');
  assert.equal(delayed[nextWord.key], undefined);
  assert.equal(delayed[nextSession.key], undefined);
});

test('awaited teaching completion requires the exact active state, word, and gate', () => {
  const state = { sessionId: 'session-1' };
  const target = { state, wordId: 'word-1', gateKey: 'gate-1' };
  assert.equal(sameIntroductionCompletionTarget(target, target), true);
  assert.equal(sameIntroductionCompletionTarget(target, { ...target, state: { ...state } }), false);
  assert.equal(sameIntroductionCompletionTarget(target, { ...target, wordId: 'word-2' }), false);
  assert.equal(sameIntroductionCompletionTarget(target, { ...target, gateKey: 'gate-2' }), false);
  assert.equal(sameIntroductionCompletionTarget(target, { ...target, gateKey: null }), false);
});


test('leaving a word/session cancels pending load and ignores a late completion or rejection', async () => {
  for (const reject of [false, true]) {
    let resolve!: (value: WordIntroductionResponse) => void;
    let fail!: (reason: Error) => void;
    let signal: AbortSignal | undefined;
    const statuses: string[] = [];
    const cancel = checkIntroductionGate('word-1', (_id, receivedSignal) => {
      signal = receivedSignal;
      return new Promise((yes, no) => { resolve = yes; fail = no; });
    }, (status) => statuses.push(status));
    cancel();
    assert.equal(signal?.aborted, true);
    if (reject) fail(new Error('late failure')); else resolve(response);
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(statuses, []);
  }
});

test('load failure and mismatched word response expose bypass without marking completion', async () => {
  for (const load of [
    async () => { throw new Error('offline'); },
    async () => ({ ...response, wordId: 'other-word', completed: true }),
  ]) {
    const statuses: string[] = [];
    checkIntroductionGate('word-1', load, (status) => statuses.push(status));
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(statuses, ['unavailable']);
  }
});
