import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectVocabularySession, type VocabularySessionInitialContext, type VocabularySessionAction,
  type VocabularyEncounterSnapshot } from '../src/domain/vocabulary-session.ts';
import { vocabularyRemainingItemCount } from '../src/features/vocabulary-study/remaining-items.ts';

const context: VocabularySessionInitialContext = {
  sessionId: 'remaining', words: [{ wordId: 'a', mode: 'practice' }, { wordId: 'b', mode: 'solidify' }],
  reviewOrder: [{ kind: 'word', id: 'a' }, { kind: 'pure_cue', id: 'cue' }, { kind: 'pure_cue', id: 'later-cue' }],
};
type Input = VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A, 'kind' | 'payload'> : never : never;
const snapshot = (contentId: string, pure = false): VocabularyEncounterSnapshot => ({ contentId, contentVersion: 1,
  kind: 'production', role: 'general', body: { prompt: 'Prompt' }, assessment: { acceptedAnswers: ['字'] },
  ...(pure ? { schedulingScope: 'pure_cue' as const } : {}),
});
const present = (id: string, wordId: string | null = 'a', contentId = id): Input => ({ kind: 'presentation',
  payload: { encounterId: id, wordId, snapshot: snapshot(contentId, wordId === null) } });
const respond = (id: string, outcome: 'accepted' | 'rejected' = 'accepted'): Input => ({ kind: 'response',
  payload: { encounterId: id, response: null, outcome } });
const wrap: Input = { kind: 'word_wrap', payload: { wordId: 'a', reason: 'enough' } };
function project(inputs: Input[], initial = context) {
  const actions = inputs.map((input, index): VocabularySessionAction => ({ ...input, protocolVersion: 1,
    sequence: index + 1, actionId: `a${index + 1}`, clientActionId: `c${index + 1}`, occurredAt: '2026-10-24T12:00:00.000Z' }));
  return projectVocabularySession(initial, actions);
}
function count(...inputs: Input[]) { return vocabularyRemainingItemCount(context, project(inputs)); }

test('remaining initially includes every planned word and independent cue, without double-counting review words', () => {
  assert.equal(count(), 4);
  assert.equal(count(present('first')), 4);
});

test('responses and exercise skips do not remove a still-open word; wrap and word skip do', () => {
  assert.equal(count(present('first'), respond('first', 'rejected'), present('second')), 4);
  assert.equal(count(present('first'), { kind: 'exercise_skip', payload: { encounterId: 'first' } }), 4);
  assert.equal(count(present('first'), wrap), 3);
  assert.equal(count(present('first'), { kind: 'word_skip', payload: { wordId: 'a' } }), 3);
});

test('requeued covered word adds one remaining item; Undo removes that extra work', () => {
  const more: Input = { kind: 'word_more', payload: { wordId: 'a' } };
  assert.equal(count(present('first'), wrap, more), 4);
  assert.equal(count(present('first'), wrap, more, { kind: 'undo', payload: { undoesActionId: 'a3' } }), 3);
  assert.equal(count(present('first'), wrap, more, present('again'), respond('again')), 4);
});

test('a cue remains one item through reinforcement; covered, skipped, or excluded cues leave the count', () => {
  assert.equal(count(present('cue1', null, 'cue'), respond('cue1', 'rejected'), present('cue2', null, 'cue')), 4);
  assert.equal(count(present('cue1', null, 'cue'), respond('cue1')), 3);
  assert.equal(count(present('cue1', null, 'cue'), { kind: 'exercise_skip', payload: { encounterId: 'cue1' } }), 3);
  assert.equal(count(present('cue1', null, 'cue'), { kind: 'exercise_exclude', payload: { encounterId: 'cue1' } }), 3);
  assert.equal(count(present('cue1', null, 'cue'), respond('cue1'), { kind: 'undo', payload: { undoesActionId: 'a2' } }), 4);
});

test('finishing counts only opened work; immediate completion leaves no remaining work in this session', () => {
  const finishing: Input = { kind: 'finish_for_now', payload: {} };
  assert.equal(count(present('first'), finishing), 1);
  assert.equal(count(present('first'), present('cue1', null, 'cue'), respond('cue1', 'rejected'), finishing), 2);
  assert.equal(count(present('first'), finishing, { kind: 'finish_immediately', payload: {} }), 0);
  assert.equal(count(present('first'), wrap, finishing), 0);
});

test('deferred teaching and undone cue presentations do not appear as remaining finishing work', () => {
  assert.equal(count(present('first'), { kind: 'mode_change', payload: { wordId: 'a', mode: 'unstudied' } }), 3);
  const projection = project([present('first'), { kind: 'finish_for_now', payload: {} }]);
  const observed = project([present('cue1', null, 'cue')]).encounters[0];
  projection.encounters.push({ ...observed, presentationUndone: true });
  assert.equal(vocabularyRemainingItemCount(context, projection), 1);
});

test('older logs without review order count observed independent cues only once', () => {
  const older = { ...context, reviewOrder: undefined };
  const projection = project([present('cue1', null, 'cue'), respond('cue1', 'rejected'), present('cue2', null, 'cue')], older);
  assert.equal(vocabularyRemainingItemCount(older, projection), 3);
});
