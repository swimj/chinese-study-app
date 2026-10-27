import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectVocabularySession, type VocabularySessionAction, type VocabularySessionActionPayload,
  type VocabularySessionInitialContext, type VocabularyEncounterSnapshot } from '../src/domain/vocabulary-session.ts';
import type { VocabularyStudy } from '../src/domain/vocabulary-study-api.ts';
import { getVocabularyCardOutcome, getVocabularyRecallProgress } from '../src/features/vocabulary-study/session-presentation.tsx';

function fixture(context: VocabularySessionInitialContext) {
  const actions: VocabularySessionAction[] = [];
  const append = (input: VocabularySessionActionPayload) => {
    const sequence = actions.length + 1;
    actions.push({ ...input, protocolVersion: 1, sequence, actionId: `action-${sequence}`, clientActionId: `client-${sequence}`, occurredAt: '2026-10-24T00:00:00.000Z' });
    return actions.at(-1)!;
  };
  const present = (kind: VocabularyEncounterSnapshot['kind'], role: VocabularyEncounterSnapshot['role'], wordId: string | null = 'word') => {
    const encounterId = `encounter-${actions.length}`;
    append({ kind: 'presentation', payload: { wordId, encounterId, snapshot: { kind, role,
      contentId: wordId === null ? 'pure' : kind === 'introduction' ? 'intro' : kind, contentVersion: 1,
      ...(wordId === null ? { schedulingScope: 'pure_cue' as const } : {}), body: { prompt: 'Prompt' },
      assessment: kind === 'introduction' ? null : { acceptedAnswers: ['字'] } } } });
    return encounterId;
  };
  const respond = (kind: VocabularyEncounterSnapshot['kind'], role: VocabularyEncounterSnapshot['role'], outcome: 'accepted' | 'rejected', wordId: string | null = 'word') => {
    const encounterId = present(kind, role, wordId);
    return append({ kind: 'response', payload: { encounterId, response: outcome === 'accepted' ? '字' : '错', outcome } });
  };
  const view = (): VocabularyStudy => {
    const projection = projectVocabularySession(context, actions);
    const currentEncounter = projection.encounters.filter((entry) => !entry.presentationUndone).at(-1) ?? null;
    return { session: { sessionId: context.sessionId, status: 'active', context, actions, projection, completion: null },
      words: [], currentEncounter, currentWordId: currentEncounter?.wordId ?? null, notice: null,
      controls: { canNext: true, canSkip: true, canEnough: true, canMore: true, canUndo: true, canFinishForNow: true, canFinishImmediately: false, canChangeMode: true } };
  };
  return { append, present, respond, view };
}

test('teaching retains both final three-recall trackers after promotion and Undo removes the earned recall', () => {
  const f = fixture({ sessionId: 'teaching', words: [{ wordId: 'word', mode: 'unstudied', teachingRequirements: {
    introductionContentId: 'intro', requiredExerciseContentIds: [], minimumRecognitionResponses: 3, minimumProductionResponses: 3,
  } }] });
  f.present('introduction', 'teaching');
  for (let index = 0; index < 3; index++) f.respond('recognition', 'teaching', 'accepted');
  for (let index = 0; index < 2; index++) f.respond('production', 'teaching', 'accepted');
  const lastResponse = f.respond('production', 'teaching', 'accepted');
  lastResponse.transitionId = 'final-teaching-answer';
  const completion = f.append({ kind: 'teaching_complete', payload: { wordId: 'word' } });
  completion.transitionId = lastResponse.transitionId;
  assert.deepEqual(getVocabularyRecallProgress(f.view()).map(({ count, total }) => [count, total]), [[3, 3], [3, 3]]);
  f.append({ kind: 'undo', payload: { undoesActionId: completion.actionId } });
  assert.deepEqual(getVocabularyRecallProgress(f.view()).map(({ count, total }) => [count, total]), [[3, 3], [2, 3]]);
});

test('Solidify shows one success per enabled skill and does not turn a miss into reinforcement', () => {
  const f = fixture({ sessionId: 'solidify', words: [{ wordId: 'word', mode: 'solidify', solidifySkills: ['recognition'] }] });
  f.respond('recognition', 'general', 'rejected');
  assert.deepEqual(getVocabularyRecallProgress(f.view()), [{ key: 'recognition', label: 'Recognition', count: 0, total: 1 }]);
  f.respond('recognition', 'general', 'accepted');
  assert.equal(getVocabularyRecallProgress(f.view())[0]!.count, 1);
});

test('Practice reinforcement resets on a miss and final success remains three of three until Next', () => {
  const f = fixture({ sessionId: 'practice', words: [{ wordId: 'word', mode: 'practice', selectedSkill: 'production' }] });
  f.respond('production', 'general', 'rejected');
  f.respond('production', 'general', 'accepted');
  f.respond('production', 'general', 'rejected');
  assert.equal(getVocabularyRecallProgress(f.view())[0]!.count, 0);
  for (let index = 0; index < 3; index++) f.respond('production', 'general', 'accepted');
  f.append({ kind: 'word_wrap', payload: { wordId: 'word', reason: 'policy' } });
  assert.deepEqual(getVocabularyRecallProgress(f.view()), [{ key: 'production', label: 'Production reinforcement', count: 3, total: 3 }]);
  assert.equal(getVocabularyCardOutcome(f.view()), 'done');
});

test('independent pure-cue reinforcement follows its own effective log and Undo', () => {
  const f = fixture({ sessionId: 'pure', words: [] });
  f.respond('production', 'general', 'rejected', null);
  for (let index = 0; index < 2; index++) f.respond('production', 'general', 'accepted', null);
  const final = f.respond('production', 'general', 'accepted', null);
  assert.deepEqual(getVocabularyRecallProgress(f.view()), [{ key: 'pure-cue', label: 'Reinforcement', count: 3, total: 3 }]);
  assert.equal(getVocabularyCardOutcome(f.view()), 'done');
  f.append({ kind: 'undo', payload: { undoesActionId: final.actionId } });
  assert.equal(getVocabularyRecallProgress(f.view())[0]!.count, 2);
});


test('recognition departure uses the acknowledged teaching recall and coverage state', () => {
  const teaching = fixture({ sessionId: 'recognition-motion', words: [{ wordId: 'word', mode: 'unstudied', teachingRequirements: {
    introductionContentId: 'intro', requiredExerciseContentIds: [], minimumRecognitionResponses: 3, minimumProductionResponses: 3,
  } }] });
  teaching.present('introduction', 'teaching');
  teaching.respond('recognition', 'teaching', 'accepted');
  assert.equal(getVocabularyCardOutcome(teaching.view()), 'ongoing');
  assert.equal(getVocabularyRecallProgress(teaching.view())[0]!.count, 1);
  teaching.respond('recognition', 'teaching', 'rejected');
  assert.equal(getVocabularyCardOutcome(teaching.view()), 'wrong');

  const practice = fixture({ sessionId: 'recognition-covered', words: [{ wordId: 'word', mode: 'practice', selectedSkill: 'recognition' }] });
  practice.respond('recognition', 'general', 'accepted');
  practice.append({ kind: 'word_wrap', payload: { wordId: 'word', reason: 'policy' } });
  assert.equal(getVocabularyCardOutcome(practice.view()), 'done');
});
