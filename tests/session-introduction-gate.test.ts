import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  introductionGateCandidate, introductionGateStatus,
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
  assert.throws(() => introductionGateStatus(response), /no prepared introduction/);
  const prepared = { ...response, selectedPackageId: 'package-1' };
  assert.equal(introductionGateStatus(prepared), 'introduction');
  assert.equal(introductionGateStatus({ ...prepared, completed: true }), 'introduction');
  assert.equal(introductionGateStatus({ ...prepared, generationAvailable: false }), 'introduction');
  assert.throws(() => introductionGateStatus({ ...prepared, preparationUnavailable: true }), /no prepared introduction/);
});

test('skip and completion are navigation only; another word or session remains gated', () => {
  const { key } = introductionGateCandidate(base)!;
  const passed = settleIntroductionGate({}, key, 'passed');
  assert.deepEqual(passed, { [key]: 'passed' });
  assert.equal(settleIntroductionGate(passed, key, 'introduction'), passed);
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
