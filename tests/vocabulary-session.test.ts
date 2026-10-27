import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectVocabularySession, recommendVocabularyMode, VOCABULARY_SESSION_POLICY,
  getPendingVocabularySkills, isVocabularyWordReadyToCover, isVocabularyTeachingComplete, isCleanSolidifySession,
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

test('Solidify requires accepted recognition and production while rejected-only work stays uncovered', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one', 'rejected'), present('two'), respond('two'), present('recognition','a',snapshot('recognition','recognition')), respond('recognition')));
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
  const result = projectVocabularySession(context, log(present('one'), respond('one'), present('two','a',snapshot('two','recognition')), respond('two'), wrap()));
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

test('Undo reverses the latest contribution without deleting raw response or reactions', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one'), present('two'), respond('two', 'rejected'),
    { kind: 'feedback', payload: { encounterId: 'two', feedback: 'comment', comment: 'This accepts another answer.' } },
    { kind: 'undo', payload: { undoesActionId: 'action-4' } }));
  assert.equal(result.words.a.productionResponses, 1);
  assert.equal(result.words.a.hasRejectedResponse, false);
  assert.equal(result.words.a.covered, false);
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

const teachingAttempts = (skill: 'recognition' | 'production', count = 3, outcome: 'accepted' | 'rejected' = 'accepted', start = 0): Input[] =>
  Array.from({length:count}, (_,i) => { const id = `${skill}-${start+i}`; return [present(id,'new',snapshot(skill === 'recognition' ? 'recognize' : 'produce',skill,'teaching')),respond(id,outcome)]; }).flat();
const intro = (): Input => present('intro','new',snapshot('intro','introduction','teaching'));

test('teaching requires its introduction and three consecutive accepted responses per skill', () => {
  const teaching = [intro(),...teachingAttempts('recognition'),...teachingAttempts('production')];
  const ready = projectVocabularySession(context,log(...teaching));
  assert.equal(isVocabularyTeachingComplete(ready.words.new),true);
  const result = projectVocabularySession(context, log(...teaching, { kind: 'teaching_complete', payload: { wordId: 'new' } }));
  assert.equal(result.words.new.teachingCompleted, true);
  assert.equal(result.words.new.mode, 'solidify');
  assert.equal(result.words.new.covered, true);
  assert.throws(() => projectVocabularySession(context, log(...teaching.slice(0, -1), { kind: 'teaching_complete', payload: { wordId: 'new' } })), /requirement unmet/);
  assert.throws(() => projectVocabularySession(context, log(teaching[0], wrap('new', 'enough'))), /incomplete teaching/);
  const incomplete = projectVocabularySession(context, log(...teaching.slice(0, -1), { kind: 'finish_for_now', payload: {} }, { kind: 'finish_immediately', payload: {} }));
  assert.equal(incomplete.words.new.teachingCompleted, false);
  assert.equal(incomplete.words.new.mode, 'unstudied');
});

test('explicit mode choices suppress automatic promotion and remain independent from coverage', () => {
  const result = projectVocabularySession(context, log(present('one'), respond('one'), present('two','a',snapshot('two','recognition')), respond('two'),
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
  assert.deepEqual(result.pureCueOutcomes, [{ contentId: 'pure-cue', contentVersion: 1, encounterIds: ['cue'], acceptedResponses: 1, rejectedResponses: 0, consecutiveAccepted: 1, covered: true }]);
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
  const result = projectVocabularySession(context, log(present('one'), respond('one'), present('two','a',snapshot('two','recognition')), respond('two'), wrap(),
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

test('frozen durable Solidify choice blocks later clean-session graduation while old contexts keep automatic defaults', () => {
  const clean = log(present('one'), respond('one'), present('recognition','a',snapshot('recognition','recognition')), respond('recognition'), wrap());
  const held = {...context,words:context.words.map((word)=>({...word,automaticPromotionPaused:word.wordId==='a'}))};
  assert.equal(projectVocabularySession(held,clean).words.a.recommendedMode,null);
  assert.equal(projectVocabularySession(context,clean).words.a.recommendedMode,'practice');
  for(const count of [0,1]) {
    const early={...context,words:context.words.map((word)=>({...word,cleanCoveredSessions:count}))};
    assert.equal(projectVocabularySession(early,clean).words.a.recommendedMode,null);
  }
});

test('teaching never recommends graduation even with a retained old clean-session count',()=>{
  const retained={...context,words:context.words.map((word)=>({...word,cleanCoveredSessions:99}))};
  const teaching=log(intro(),...teachingAttempts('recognition'),...teachingAttempts('production'),
    {kind:'teaching_complete',payload:{wordId:'new'}});
  assert.equal(projectVocabularySession(retained,teaching).words.new.recommendedMode,null);
});

test('teaching misses reset only their own skill streak and do not require every bound exercise', () => {
  const extraBound = {...context,words:context.words.map(word=>word.wordId==='new'
    ? {...word,teachingRequirements:{...word.teachingRequirements!,requiredExerciseContentIds:['recognize','produce','extra']}} : word)};
  const prefix = [intro(),...teachingAttempts('recognition'),...teachingAttempts('production',2),
    ...teachingAttempts('production',1,'rejected',2),...teachingAttempts('production',2,'accepted',3)];
  const incomplete = projectVocabularySession(extraBound,log(...prefix));
  assert.deepEqual(getPendingVocabularySkills(incomplete.words.new),['production']);
  assert.equal(incomplete.words.new.skillProgress.recognition.consecutiveAccepted,3);
  assert.equal(isVocabularyTeachingComplete(incomplete.words.new),false);
  const ready = projectVocabularySession(extraBound,log(...prefix,...teachingAttempts('production',1,'accepted',5)));
  assert.equal(isVocabularyTeachingComplete(ready.words.new),true);
  const undone = projectVocabularySession(extraBound,log(...prefix,...teachingAttempts('production',1,'accepted',5),
    {kind:'undo',payload:{undoesActionId:`action-${prefix.length+2}`}}));
  assert.equal(undone.words.new.skillProgress.production.consecutiveAccepted,2);
  assert.equal(isVocabularyTeachingComplete(undone.words.new),false);
  assert.equal(isVocabularyTeachingComplete(projectVocabularySession(context,log(...teachingAttempts('recognition'),...teachingAttempts('production'))).words.new),false);
});

test('Solidify priming supplies no recall credit; Enough and wrong responses cannot create clean graduation', () => {
  const prefix = [present('prime','a',snapshot('prime','recognition','priming')),respond('prime'),present('production'),respond('production')];
  const incomplete = projectVocabularySession(context,log(...prefix));
  assert.deepEqual(getPendingVocabularySkills(incomplete.words.a),['recognition']);
  assert.equal(isVocabularyWordReadyToCover(incomplete.words.a),false);
  assert.throws(()=>projectVocabularySession(context,log(...prefix,wrap())),/default covering/);
  assert.equal(isCleanSolidifySession(projectVocabularySession(context,log(...prefix,wrap('a','enough'))).words.a),false);
  const wrong = projectVocabularySession(context,log(...prefix,present('r1','a',snapshot('r','recognition')),respond('r1','rejected'),
    present('r2','a',snapshot('r','recognition')),respond('r2'),wrap()));
  assert.equal(wrong.words.a.covered,true);
  assert.equal(isCleanSolidifySession(wrong.words.a),false);
  assert.equal(wrong.words.a.recommendedMode,null);
});

test('Practice and Maintain freeze one selected skill, reinforce lapses with three consecutive successes, and Undo restores the requirement', () => {
  for (const mode of ['practice','maintain'] as const) for (const selectedSkill of ['recognition','production','contextual_selection'] as const) {
    const selected: VocabularySessionInitialContext = {sessionId:'selected',words:[{wordId:'b',mode,selectedSkill}]};
    const attempt = (id: string, outcome: 'accepted' | 'rejected'): Input[] => {
      const kind = selectedSkill === 'contextual_selection' ? 'contrast' : selectedSkill;
      return [present(id,'b',snapshot(id,kind)),{kind:'response',payload:{encounterId:id,response:'字',outcome,
        ...(kind === 'contrast' ? {selectedWordId:'b'} : {})}}];
    };
    const clean = projectVocabularySession(selected,log(...attempt('clean','accepted'),wrap('b')));
    assert.equal(clean.words.b.covered,true);
    assert.equal(clean.words.b.successfulProductionResponses,selectedSkill==='production'?1:0);
    const prefix = [...attempt('miss','rejected'),...attempt('one','accepted'),...attempt('two','accepted'),
      ...attempt('reset','rejected'),...attempt('three','accepted'),...attempt('four','accepted')];
    const incomplete = projectVocabularySession(selected,log(...prefix));
    assert.deepEqual(getPendingVocabularySkills(incomplete.words.b),[selectedSkill]);
    assert.equal(incomplete.words.b.covered,false);
    assert.throws(()=>projectVocabularySession(selected,log(...prefix,wrap('b'))),/default covering/);
    const enough = projectVocabularySession(selected,log(...prefix,wrap('b','enough')));
    assert.equal(enough.words.b.covered,true);assert.equal(enough.words.b.successfulRecall,false);
    const ready = projectVocabularySession(selected,log(...prefix,...attempt('five','accepted')));
    assert.equal(isVocabularyWordReadyToCover(ready.words.b),true);
    assert.equal(ready.words.b.successfulRecall,true);
    const undone = projectVocabularySession(selected,log(...prefix,...attempt('five','accepted'),
      {kind:'undo',payload:{undoesActionId:`action-${prefix.length+2}`}}));
    assert.equal(undone.words.b.covered,false);
    assert.equal(undone.words.b.skillProgress[selectedSkill].consecutiveAccepted,2);
  }
});

test('legacy selected-skill flags remain readable and a continuation requires fresh work despite prior coverage', () => {
  for (const flag of ['recognitionOnly','contextualOnly'] as const) {
    const legacy: VocabularySessionInitialContext={sessionId:'legacy',words:[{wordId:'b',mode:'practice',[flag]:true}]};
    assert.equal(projectVocabularySession(legacy,[]).words.b.selectedSkill,flag==='recognitionOnly'?'recognition':'contextual_selection');
  }
  const projection=projectVocabularySession(context,log(present('one','b'),respond('one'),wrap('b'),{kind:'word_more',payload:{wordId:'b'}},present('two','b')));
  assert.equal(projection.words.b.covered,true);
  assert.equal(isVocabularyWordReadyToCover(projection.words.b),false);
  assert.deepEqual(getPendingVocabularySkills(projection.words.b),['production']);
});


test('clean Solidify evidence survives More while subsequent mistakes still block graduation', () => {
  const prefix = [present('p'),respond('p'),present('r','a',snapshot('r','recognition')),respond('r'),wrap(),
    {kind:'word_more',payload:{wordId:'a'}} as Input,present('extra')];
  const more = projectVocabularySession(context,log(...prefix));
  assert.equal(isVocabularyWordReadyToCover(more.words.a),false);
  assert.equal(isCleanSolidifySession(more.words.a),true);
  const wrong = projectVocabularySession(context,log(...prefix,respond('extra','rejected')));
  assert.equal(isCleanSolidifySession(wrong.words.a),false);
});


test('pure cue lapses require three consecutive successes and never credit answer words', () => {
  const cue = {...snapshot('reinforced-cue'),schedulingScope:'pure_cue' as const};
  const attempt = (id: string, outcome: 'accepted' | 'rejected'): Input[] => [
    {kind:'presentation',payload:{encounterId:id,wordId:null,snapshot:cue}},respond(id,outcome)];
  const prefix = [...attempt('miss','rejected'),...attempt('one','accepted'),...attempt('reset','rejected'),
    ...attempt('two','accepted'),...attempt('three','accepted')];
  const incomplete=projectVocabularySession(context,log(...prefix));
  assert.equal(incomplete.pureCueOutcomes[0].covered,false);
  assert.equal(incomplete.pureCueOutcomes[0].consecutiveAccepted,2);
  const covered=projectVocabularySession(context,log(...prefix,...attempt('four','accepted')));
  assert.equal(covered.pureCueOutcomes[0].covered,true);
  assert.deepEqual(covered.coveredWordIds,[]);
  const undone=projectVocabularySession(context,log(...prefix,...attempt('four','accepted'),
    {kind:'undo',payload:{undoesActionId:`action-${prefix.length+2}`}}));
  assert.equal(undone.pureCueOutcomes[0].covered,false);
  assert.equal(undone.pureCueOutcomes[0].consecutiveAccepted,2);
});

test('finishing waits for pure cue reinforcement while Skip or exclusion stops it without coverage', () => {
  const cue={...snapshot('cue'),schedulingScope:'pure_cue' as const};
  const first:Input={kind:'presentation',payload:{encounterId:'first',wordId:null,snapshot:cue}};
  const prefix:Input[]=[first,respond('first','rejected'),{kind:'finish_for_now',payload:{}}];
  assert.equal(projectVocabularySession(context,log(...prefix)).phase,'finishing');
  for (const kind of ['exercise_skip','exercise_exclude'] as const) {
    const stopped=projectVocabularySession(context,log(...prefix,{kind,payload:{encounterId:'first'}}));
    assert.equal(stopped.phase,'completed');assert.equal(stopped.pureCueOutcomes[0].covered,false);
  }
  const retries:Input[]=Array.from({length:3},(_,i)=>[
    {kind:'presentation',payload:{encounterId:`retry-${i}`,wordId:null,snapshot:cue}} as Input,respond(`retry-${i}`)]).flat();
  assert.equal(projectVocabularySession(context,log(...prefix,...retries)).phase,'completed');
});


test('Solidify covers enabled directions without crediting or graduating omitted directions', () => {
  for (const enabledSkill of ['recognition','production'] as const) {
    const limited:VocabularySessionInitialContext={sessionId:'limited',words:[
      {wordId:'a',mode:'solidify',cleanCoveredSessions:3,solidifySkills:[enabledSkill]}]};
    const empty=projectVocabularySession(limited,[]);
    assert.deepEqual(getPendingVocabularySkills(empty.words.a),[enabledSkill]);
    const result=projectVocabularySession(limited,log(present('enabled','a',snapshot('enabled',enabledSkill)),respond('enabled'),wrap()));
    assert.equal(result.words.a.covered,true);
    assert.equal(result.words.a.successfulRecall,true);
    assert.equal(result.words.a.solidifyRecallCompleted,false);
    assert.equal(isCleanSolidifySession(result.words.a),false);
    assert.equal(result.words.a.recommendedMode,null);
    const omittedSkill=enabledSkill==='recognition'?'production':'recognition';
    assert.equal(result.words.a.skillProgress[omittedSkill].acceptedResponses,0);
    assert.equal(result.words.a.successfulProductionResponses,enabledSkill==='production'?1:0);
  }
  assert.deepEqual(projectVocabularySession(context,[]).words.a.solidifySkills,['recognition','production']);
});

test('Solidify requires a nonempty set of valid, distinct enabled directions', () => {
  for (const solidifySkills of [[],['recognition','recognition'],['contextual_selection']]) {
    const invalid={sessionId:'invalid',words:[{wordId:'a',mode:'solidify',solidifySkills}]} as unknown as VocabularySessionInitialContext;
    assert.throws(()=>projectVocabularySession(invalid,[]),/invalid Solidify skill configuration/);
  }
});
