import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectVocabularySession, recommendVocabularyMode, VOCABULARY_SESSION_POLICY,
  type VocabularySessionAction, type VocabularySessionInitialContext, type VocabularyEncounterSnapshot } from '../src/domain/vocabulary-session.ts';

const context: VocabularySessionInitialContext = { sessionId: 'session', words: [
  { wordId: 'a', mode: 'solidify', cleanCoveredSessions: 2 }, { wordId: 'b', mode: 'practice' },
  { wordId: 'new', mode: 'unstudied', teachingRequirements: { introductionContentId: 'intro',
    requiredExerciseContentIds: ['recognize', 'produce'], minimumRecognitionResponses: 1, minimumProductionResponses: 1 } },
] };
const snapshot = (contentId: string, kind: VocabularyEncounterSnapshot['kind'] = 'production', role: VocabularyEncounterSnapshot['role'] = 'general'): VocabularyEncounterSnapshot => ({
  contentId, contentVersion: 1, kind, role, body: { prompt: `Prompt ${contentId}` },
  assessment: kind === 'introduction' ? null : { acceptedAnswers: ['字'] },
});
type Input = VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A, 'kind' | 'payload'> : never : never;
function log(...inputs: Input[]): VocabularySessionAction[] {
  return inputs.map((input, index) => ({ ...input, protocolVersion: 1, sequence: index + 1,
    actionId: `action-${index + 1}`, clientActionId: `client-${index + 1}`, occurredAt: '2026-10-17T10:00:00.000Z' }));
}
const present = (encounterId: string, wordId = 'a', content = snapshot(encounterId)): Input => ({ kind: 'presentation', payload: { encounterId, wordId, snapshot: content } });
const respond = (encounterId: string, outcome: 'accepted' | 'rejected' = 'accepted'): Input => ({ kind: 'response', payload: { encounterId, response: outcome === 'accepted' ? '字' : null, outcome } });
const wrap = (wordId = 'a', reason: 'enough' | 'policy' = 'policy'): Input => ({ kind: 'word_wrap', payload: { wordId, reason } });

test('one accepted production response covers work while rejected-only work stays uncovered', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one', 'rejected'), present('two'), respond('two')));
  assert.equal(result.words.a.covered, true);
  assert.equal(result.words.a.successfulRecall, true);
  assert.equal(projectVocabularySession(context,log(present('miss'),respond('miss','rejected'))).words.a.covered,false);
  assert.equal(result.words.a.hasRejectedResponse, true);
  assert.equal(result.words.a.recommendedMode, null);
  assert.deepEqual(result.coveredWordIds, ['a']);
  assert.equal(result.encounters[0].responses[0].payload.response, null);
  assert.equal(result.words.a.mode, 'solidify');
});

test('clean coverage recommends promotion but does not apply a durable mode change', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one'), present('two'), respond('two'), wrap()));
  assert.equal(result.words.a.recommendedMode, 'practice');
  assert.equal(result.words.a.mode, 'solidify');
  assert.equal(recommendVocabularyMode('practice', 1000000), null);
  assert.equal(VOCABULARY_SESSION_POLICY.practiceCleanCoveredSessionsToRecommendMaintain, Infinity);
});

test('enough and skip retain incomplete evidence with different coverage outcomes', () => {
  const result = projectVocabularySession(context, log(present('one'), { kind: 'feedback', payload: { encounterId: 'one', feedback: 'negative' } },
    { kind: 'exercise_skip', payload: { encounterId: 'one' } }, wrap('a', 'enough'), present('two', 'b'),
    { kind: 'word_skip', payload: { wordId: 'b' } }));
  assert.equal(result.words.a.covered, true);
  assert.equal(result.words.a.successfulRecall, false);
  assert.equal(result.words.b.covered, false);
  assert.deepEqual(result.uncoveredWordIds, ['b']);
  assert.equal(result.encounters[0].responses.length, 0);
  assert.equal(result.encounters[0].feedback.length, 1);
  assert.equal(result.encounters[0].skipped, true);
});

test('Undo reverses the latest contribution without deleting raw response or feedback', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one'), present('two'), respond('two', 'rejected'),
    { kind: 'feedback', payload: { encounterId: 'two', feedback: 'comment', comment: 'This accepts another answer.' } },
    { kind: 'undo', payload: { undoesActionId: 'action-4' } }));
  assert.equal(result.words.a.productionResponses, 1);
  assert.equal(result.words.a.hasRejectedResponse, false);
  assert.equal(result.words.a.covered, true);
  assert.equal(result.encounters[1].responses.length, 1);
  assert.equal(result.encounters[1].feedback.length, 1);
  assert.deepEqual(result.undoneActionIds, ['action-4']);
  assert.equal(result.latestUndoableActionId, null);
  assert.throws(() => projectVocabularySession(context, log(present('one'), respond('one'), present('two'), respond('two'),
    { kind: 'undo', payload: { undoesActionId: 'action-2' } })), /latest undoable/);
});

test('finishing prohibits new word admission and immediate finish retains uncovered words', () => {
  const start = [present('one'), respond('one', 'rejected'), { kind: 'finish_for_now', payload: {} } as Input];
  assert.throws(() => projectVocabularySession(context, log(...start, present('two', 'b'))), /cannot admit/);
  const result = projectVocabularySession(context, log(...start, { kind: 'finish_immediately', payload: {} }));
  assert.equal(result.phase, 'completed');
  assert.deepEqual(result.uncoveredWordIds, ['a']);
  assert.equal(result.encounters[0].responses.length, 1);
  assert.throws(() => projectVocabularySession(context, log({ kind: 'finish_immediately', payload: {} })), /requires finishing/);
  assert.throws(() => projectVocabularySession(context, log(...start, { kind: 'finish_immediately', payload: {} }, respond('one'))), /completed session/);
});

test('returning to a wrapped word requires fresh work and preserves earlier coverage', () => {
  assert.throws(() => projectVocabularySession(context, log(present('one'), wrap('a', 'enough'), present('two'))), /word_more/);
  const result = projectVocabularySession(context, log(present('one'), wrap('a', 'enough'),
    { kind: 'word_more', payload: { wordId: 'a' } }, present('two'), respond('two')));
  assert.equal(result.words.a.workNumber, 2);
  assert.equal(result.words.a.productionResponses, 1);
  assert.equal(result.words.a.covered, true);
  assert.deepEqual(result.encounters.map((entry) => entry.workNumber), [1, 2]);
});

test('teaching completion requires the actual introduction and accepted required exercises', () => {
  const teaching = [present('intro', 'new', snapshot('intro', 'introduction', 'teaching')),
    present('recognize', 'new', snapshot('recognize', 'recognition', 'teaching')), respond('recognize'),
    present('produce', 'new', snapshot('produce', 'production', 'teaching')), respond('produce')];
  const result = projectVocabularySession(context, log(...teaching, { kind: 'teaching_complete', payload: { wordId: 'new' } }));
  assert.equal(result.words.new.teachingCompleted, true);
  assert.equal(result.words.new.mode, 'solidify');
  assert.equal(result.words.new.covered, true);
  assert.throws(() => projectVocabularySession(context, log(...teaching.slice(0, -1), { kind: 'teaching_complete', payload: { wordId: 'new' } })), /not completed/);
  assert.throws(() => projectVocabularySession(context, log(teaching[0], wrap('new', 'enough'))), /incomplete teaching/);
  const incomplete = projectVocabularySession(context, log(...teaching.slice(0, -1), { kind: 'finish_for_now', payload: {} }, { kind: 'finish_immediately', payload: {} }));
  assert.equal(incomplete.words.new.teachingCompleted, false);
  assert.equal(incomplete.words.new.mode, 'unstudied');
});

test('explicit mode choices suppress automatic promotion and remain independent from coverage', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one'), present('two'), respond('two'),
    { kind: 'mode_change', payload: { wordId: 'a', mode: 'maintain' } }));
  assert.equal(result.words.a.mode, 'maintain');
  assert.equal(result.words.a.explicitModeChoice, 'maintain');
  assert.equal(result.words.a.recommendedMode, null);
  assert.equal(result.words.a.covered, true);
});

test('frozen prefix rejects gaps and does not consume later actions', () => {
  const actions = log(present('one'), respond('one'), present('two'), respond('two'));
  assert.equal(projectVocabularySession(context, actions, { throughSequence: 2 }).words.a.productionResponses, 1);
  assert.equal(projectVocabularySession(context, actions, { throughSequence: 2 }).throughSequence, 2);
  assert.throws(() => projectVocabularySession(context, actions, { throughSequence: 5 }), /acknowledged contiguous boundary/);
  assert.throws(() => projectVocabularySession(context, [actions[1], actions[0]]), /acknowledged contiguous boundary|ordered and contiguous/);
  assert.throws(() => projectVocabularySession(context, [actions[0], { ...actions[1], clientActionId: actions[0].clientActionId }]), /client action ID/);
});

test('independent pure-cue schedules retain answer sets without crediting answer words', () => {
  const cue = { ...snapshot('pure-cue'), schedulingScope: 'pure_cue' as const, selectedThroughWordId: null,
    assessment: { acceptedAnswers: ['甲', '乙'] } };
  const result = projectVocabularySession(context, log({ kind: 'presentation', payload: { encounterId: 'cue', wordId: null, snapshot: cue } }, respond('cue')));
  assert.deepEqual(result.coveredWordIds, []);
  assert.deepEqual(result.uncoveredWordIds, []);
  assert.deepEqual(result.pureCueOutcomes, [{ contentId: 'pure-cue', contentVersion: 1, encounterIds: ['cue'], acceptedResponses: 1, rejectedResponses: 0, covered: true }]);
  assert.deepEqual(result.encounters[0].snapshot.assessment?.acceptedAnswers, ['甲', '乙']);
  const undone = projectVocabularySession(context, log({ kind: 'presentation', payload: { encounterId: 'cue', wordId: null, snapshot: cue } }, respond('cue'), { kind: 'undo', payload: { undoesActionId: 'action-2' } }));
  assert.equal(undone.pureCueOutcomes[0].covered, false);
  assert.equal(undone.encounters[0].responses.length, 1);
});

test('recognition retains independently usable evidence and supplies no production coverage', () => {
  const result = projectVocabularySession(context, log(present('recognition', 'a', snapshot('recognition', 'recognition')), respond('recognition')));
  assert.equal(result.words.a.productionResponses, 0);
  assert.equal(result.words.a.covered, false);
  assert.equal(result.encounters[0].snapshot.kind, 'recognition');
});

test('Undo of a continuation preserves the exact presentation context already observed', () => {
  const result = projectVocabularySession(context, log(present('one'), wrap('a', 'enough'),
    { kind: 'word_more', payload: { wordId: 'a' } }, present('two'),
    { kind: 'undo', payload: { undoesActionId: 'action-3' } }));
  assert.equal(result.words.a.workStatus, 'wrapped');
  assert.equal(result.words.a.workNumber, 1);
  assert.equal(result.encounters[1].workNumber, 2);
});

test('Finish for now completes naturally after open work wraps, and Undo restores that work', () => {
  const prefix = [present('one'), { kind: 'finish_for_now', payload: {} } as Input, wrap('a', 'enough')];
  const result = projectVocabularySession(context, log(...prefix));
  assert.equal(result.phase, 'completed');
  assert.equal(result.finishReason, 'wrapped_up');
  const undone = projectVocabularySession(context, log(...prefix, { kind: 'undo', payload: { undoesActionId: 'action-3' } }));
  assert.equal(undone.phase, 'finishing');
  assert.equal(undone.words.a.workStatus, 'open');
  assert.equal(undone.words.a.covered, false);
});

test('immediate-finish Undo restores finishing without restoring an earlier transition', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one', 'rejected'),
    { kind: 'finish_for_now', payload: {} }, { kind: 'finish_immediately', payload: {} },
    { kind: 'undo', payload: { undoesActionId: 'action-4' } }));
  assert.equal(result.phase, 'finishing');
  assert.equal(result.finishReason, null);
  assert.equal(result.words.a.hasRejectedResponse, true);
  assert.equal(result.latestUndoableActionId, null);
});

test('pending pure cues keep finishing open until answered or skipped', () => {
  const cue = { ...snapshot('cue'), schedulingScope: 'pure_cue' as const };
  const prefix: Input[] = [{ kind: 'presentation', payload: { encounterId: 'cue', wordId: null, snapshot: cue } }, { kind: 'finish_for_now', payload: {} }];
  assert.equal(projectVocabularySession(context, log(...prefix)).phase, 'finishing');
  assert.equal(projectVocabularySession(context, log(...prefix, respond('cue'))).finishReason, 'wrapped_up');
  assert.equal(projectVocabularySession(context, log(...prefix, { kind: 'exercise_skip', payload: { encounterId: 'cue' } })).finishReason, 'wrapped_up');
});

test('resuming completed work preserves prior responses and allows a fresh word work cycle', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one'), present('two'), respond('two'), wrap(),
    {kind:'finish_for_now',payload:{}},{kind:'resume',payload:{}},{kind:'word_more',payload:{wordId:'a'}},present('three')));
  assert.equal(result.phase,'active');assert.equal(result.words.a.workNumber,2);assert.equal(result.words.a.covered,true);
  assert.equal(result.encounters[0].effectiveResponses.length,1);assert.equal(result.encounters[1].effectiveResponses.length,1);
});

test('reaction withdrawal preserves history and comments without an effective negative reaction', () => {
  const result = projectVocabularySession(context, log(present('one'),
    {kind:'feedback',payload:{encounterId:'one',feedback:'negative'}},
    {kind:'feedback',payload:{encounterId:'one',feedback:'comment',comment:'Keep this note.'}},
    {kind:'feedback',payload:{encounterId:'one',feedback:'withdrawn'}}));
  assert.equal(result.encounters[0].feedback.length,3);
  assert.deepEqual(result.encounters[0].effectiveFeedback.map((action)=>action.payload.feedback),['comment']);
});

test('mode reset defers teaching and Undo restores the previous open work', () => {
  const prefix:Input[]=[present('one'),respond('one'),{kind:'mode_change',payload:{wordId:'a',mode:'unstudied'}}];
  const result=projectVocabularySession(context,log(...prefix));
  assert.equal(result.words.a.mode,'unstudied');assert.equal(result.words.a.workStatus,'skipped');
  assert.equal(result.words.a.teachingDeferred,true);assert.equal(result.words.a.teachingCompleted,false);
  assert.equal(result.encounters[0].effectiveResponses.length,1);
  assert.throws(()=>projectVocabularySession(context,log(...prefix,{kind:'word_more',payload:{wordId:'a'}})),/fresh session/);
  const undone=projectVocabularySession(context,log(...prefix,{kind:'undo',payload:{undoesActionId:'action-3'}}));
  assert.equal(undone.words.a.mode,'solidify');assert.equal(undone.words.a.workStatus,'open');assert.equal(undone.words.a.teachingDeferred,false);
});
