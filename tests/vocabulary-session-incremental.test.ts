import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceVocabularySession, projectVocabularySession, type VocabularySessionAction,
  type VocabularySessionInitialContext, type VocabularyEncounterSnapshot } from '../src/domain/vocabulary-session.ts';
const context: VocabularySessionInitialContext = { sessionId: 'incremental', words: [
  { wordId: 'a', mode: 'solidify', cleanCoveredSessions: 2 }, { wordId: 'b', mode: 'practice' },
] };
type Input = VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A, 'kind' | 'payload'> : never : never;
const present = (id: string, wordId: string | null = 'a', kind: VocabularyEncounterSnapshot['kind'] = 'production'): Input => ({
  kind: 'presentation', payload: { encounterId: id, wordId, snapshot: { contentId: wordId === null ? 'cue' : id,
    contentVersion: 1, kind, role: 'general', body: { prompt: id }, assessment: { acceptedAnswers: ['字'] },
    ...(wordId === null ? { schedulingScope: 'pure_cue' as const } : {}) } },
});
const response = (id: string, outcome: 'accepted' | 'rejected' = 'accepted'): Input => ({ kind: 'response',
  payload: { encounterId: id, response: outcome === 'accepted' ? '字' : null, outcome } });
const reaction = (id: string, feedback: 'positive' | 'negative' | 'comment' | 'withdrawn'): Input => ({ kind: 'feedback', payload: { encounterId: id, feedback } });
function actions(inputs: Input[]): VocabularySessionAction[] {
  return inputs.map((input, index) => ({ ...input, protocolVersion: 1, sequence: index + 1,
    actionId: `a${index + 1}`, clientActionId: `c${index + 1}`, occurredAt: '2026-10-28T00:00:00.000Z' }));
}
function parity(log: VocabularySessionAction[]): void {
  for (const batchSize of [1, 2, log.length]) {
    let prior = projectVocabularySession(context, []);
    for (let offset = 0; offset < log.length; offset += batchSize) {
      const before = structuredClone(prior);
      const incoming = log.slice(offset, offset + batchSize);
      const next = advanceVocabularySession(context, log.slice(0, offset), prior, incoming);
      assert.deepEqual(prior, before, 'prior projection remains immutable');
      assert.deepEqual(next, projectVocabularySession(context, log.slice(0, offset + incoming.length)), `prefix ${offset + incoming.length}`);
      prior = next;
    }
  }
}
test('incremental projection matches coverage, promotion, More, modes, reactions and finishing', () => {
  parity(actions([present('one'), response('one'), present('recognition', 'a', 'recognition'), response('recognition'),
    reaction('one', 'negative'), reaction('one', 'comment'), reaction('one', 'positive'), reaction('one', 'withdrawn'),
    { kind: 'word_wrap', payload: { wordId: 'a', reason: 'policy' } },
    { kind: 'word_more', payload: { wordId: 'a' } }, present('two'), response('two', 'rejected'),
    { kind: 'mode_change', payload: { wordId: 'a', mode: 'maintain' } },
    { kind: 'finish_for_now', payload: {} }, { kind: 'word_skip', payload: { wordId: 'a' } },
    { kind: 'resume', payload: {} }, { kind: 'finish_for_now', payload: {} }]));
});
test('incremental projection preserves Undo evidence and effective continuation state', () => {
  parity(actions([present('one'), response('one'), reaction('one', 'comment'),
    { kind: 'undo', payload: { undoesActionId: 'a2' } }, response('one', 'rejected'),
    { kind: 'word_wrap', payload: { wordId: 'a', reason: 'enough' } },
    { kind: 'word_more', payload: { wordId: 'a' } }, present('two'),
    { kind: 'undo', payload: { undoesActionId: 'a7' } },
    { kind: 'word_more', payload: { wordId: 'a' } }, present('three'), response('three')]));
});
test('incremental pure-cue outcomes preserve ordering, misses, Undo and finishing', () => {
  parity(actions([present('cue1', null), response('cue1', 'rejected'), present('cue2', null), response('cue2'),
    { kind: 'undo', payload: { undoesActionId: 'a4' } }, response('cue2'),
    present('cue3', null), response('cue3'), present('cue4', null), response('cue4'),
    { kind: 'finish_for_now', payload: {} }]));
});
test('incremental projection rehydrates safely after Undo and rejects invalid appended identities', () => {
  const log = actions([present('one'), response('one'), { kind: 'undo', payload: { undoesActionId: 'a2' } }, response('one')]);
  const prior = structuredClone(projectVocabularySession(context, log.slice(0, 3)));
  assert.deepEqual(advanceVocabularySession(context, log.slice(0, 3), prior, log.slice(3)), projectVocabularySession(context, log));
  const first = projectVocabularySession(context, log.slice(0, 1));
  assert.throws(() => advanceVocabularySession(context, log.slice(0, 1), first, [{ ...log[1], actionId: 'a1' }]), /duplicate or empty action ID/);
  assert.throws(() => advanceVocabularySession(context, log.slice(0, 1), first, [{ ...log[1], clientActionId: 'c1' }]), /duplicate or empty client action ID/);
  assert.throws(() => advanceVocabularySession(context, [], first, []), /acknowledged boundary/);
});
test('ordinary append does not read or execute historical action payloads', () => {
  const log = actions([present('one'), response('one')]);
  const prior = projectVocabularySession(context, log.slice(0, 1));
  const oldAction = new Proxy(log[0], { get(target, property, receiver) {
    if (property === 'payload' || property === 'kind') throw new Error('old action was replayed');
    return Reflect.get(target, property, receiver);
  } });
  assert.deepEqual(advanceVocabularySession(context, [oldAction], prior, log.slice(1)), projectVocabularySession(context, log));
});
test('grouped Undo retains original presentation observations during later appends', () => {
  const log = actions([present('one'),
    { kind: 'exercise_skip', payload: { encounterId: 'one' } },
    { kind: 'exercise_exclude', payload: { encounterId: 'one' } }, present('two'), reaction('two', 'comment'),
    { kind: 'undo', payload: { undoesActionId: 'a3' } }, present('three'), response('three')]);
  for (const index of [1, 2, 3]) log[index].transitionId = 'another';
  parity(log);
});
test('teaching completion and fresh work advance identically to the replay oracle', () => {
  const teachingContext: VocabularySessionInitialContext = { sessionId: 'teaching', words: [{ wordId: 'new', mode: 'unstudied',
    teachingRequirements: { introductionContentId: 'intro', requiredExerciseContentIds: ['recognition', 'production'],
      minimumRecognitionResponses: 3, minimumProductionResponses: 3 } }] };
  const inputs: Input[] = [{ kind: 'presentation', payload: { encounterId: 'intro', wordId: 'new', snapshot: {
    contentId: 'intro', contentVersion: 1, kind: 'introduction', role: 'teaching', body: { prompt: 'Intro' }, assessment: null } } }];
  for (const skill of ['recognition', 'production'] as const) {
    for (let index = 0; index < 3; index++) {
      const id = `${skill}/${index}`;
      const entry = present(id, 'new', skill);
      if (entry.kind !== 'presentation') throw new Error('expected presentation');
      entry.payload.snapshot.role = 'teaching';
      inputs.push(entry, response(id));
    }
  }
  inputs.push({ kind: 'teaching_complete', payload: { wordId: 'new' } },
    { kind: 'word_more', payload: { wordId: 'new' } }, present('fresh', 'new'), response('fresh'));
  const log = actions(inputs);
  let prior = projectVocabularySession(teachingContext, []);
  for (let index = 0; index < log.length; index++) {
    prior = advanceVocabularySession(teachingContext, log.slice(0, index), prior, [log[index]]);
    assert.deepEqual(prior, projectVocabularySession(teachingContext, log.slice(0, index + 1)));
  }
});
