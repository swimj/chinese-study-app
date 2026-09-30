import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePureCueReflectionResult, parsePureCueReflectionBundle, validatePureCueReflectionResultV1Wire, validatePureCueReflectionResult, type PureCueReflectionBundleV1, type PureCueReflectionResultV1Wire } from '../src/domain/pure-cue-reflection';
import { reflectionOperationWordReferences, validateReflectionOperation } from '../src/domain/reflection';
import { parseStoredSessionReflectionBundle } from '../src/domain/reflection-evidence';
const word = (wordId: string) => ({ wordId, hanzi: wordId, pinyin: '', meanings: [wordId] });
const bundle: PureCueReflectionBundleV1 = {
  schemaVersion: 'pure_cue_reflection_bundle.v1', generatedAt: '2026-09-30T00:00:00.000Z',
  session: {sessionId:'session', startedAt:null, endedAt:null, studyProfile:'mandarin'},
  items: [{ source:'pure_cue_mistake', sourceActionKind:'pure_cue', itemId:'item', sourceAttemptId:'assessment', firstEventId:'first', sessionActionId:'action', occurredAt:'2026-09-30T00:00:00.000Z', rawResponse:'C', submittedWord:word('C'), targetWord:null,sessionNote:null,existingContent:{contrastClusters:[],knownAcceptedAlternates:[]}, activeProductionCues:[{cueId:'C-cue',cueType:'definition_gloss',text:'a C cue',acceptedWordIds:['C']}], currentCue:{id:'pure',stimulus:'shared stimulus',axisNote:'axis',teachingNote:'old note',acceptedWordIds:['A','B'],acceptedWords:[word('A'),word('B')]}, servedSnapshot:{snapshotId:'snapshot',pureCueId:'pure',servedAt:'2026-09-30T00:00:00.000Z',stimulus:'shared stimulus',axisNote:'axis',teachingNote:'old note',acceptedAnswers:[{wordId:'A',hanzi:'A',traditional:null},{wordId:'B',hanzi:'B',traditional:null}]} }],
};
const wire = (): PureCueReflectionResultV1Wire => ({schemaVersion:'pure_cue_reflection_result.v1', itemResults:[{itemId:'item',decision:'extend',reason:null,learnerExplanation:'C fits this cue.',rationale:'The response expresses this situation.',extension:{teachingNote:'A, B, and C fit with differences.',responseWordPlan:{deactivateCueIds:[],distinctiveCueDrafts:[]}}}]});
test('pure cue evidence remains distinct and normalization stamps only the response identity', () => {
  assert.deepEqual(parseStoredSessionReflectionBundle(bundle), bundle);
  const result = normalizePureCueReflectionResult(wire(), bundle);
  assert.deepEqual(validatePureCueReflectionResult(result,bundle),[]);
  const operation = result.itemResults[0]!.proposals[0]!.operation;
  assert.equal(operation.kind,'reconcile_pure_cue_response');
  assert.deepEqual(reflectionOperationWordReferences(operation),['C']);
  assert.deepEqual(validateReflectionOperation(operation),[]);
  assert.equal('targetWordId' in operation,false);
});
test('provider cannot supply durable identity or alter A/B owned cues', () => {
  const value = wire();
  Object.assign(value.itemResults[0]!.extension!.responseWordPlan, {wordId:'A'});
  assert.ok(validatePureCueReflectionResultV1Wire(value,bundle).some(e => e.includes('unexpected')));
  const badCue = wire(); badCue.itemResults[0]!.extension!.responseWordPlan.deactivateCueIds = ['A-cue'];
  assert.ok(validatePureCueReflectionResultV1Wire(badCue,bundle).some(e => e.includes('active C')));
  const normalized = normalizePureCueReflectionResult(wire(),bundle);
  const op = normalized.itemResults[0]!.proposals[0]!.operation;
  if (op.kind !== 'reconcile_pure_cue_response') throw new Error('wrong kind');
  op.responseWordPlan.wordId = 'A';
  assert.ok(validatePureCueReflectionResult(normalized,bundle).some(e => e.includes('only response word')));
});
test('explanation only cannot carry cleanup and each source gets one result', () => {
  const value = wire(); value.itemResults[0]!.decision = 'explanation_only'; value.itemResults[0]!.reason = 'uncertain';
  assert.ok(validatePureCueReflectionResultV1Wire(value,bundle).length);
  value.itemResults[0]!.extension = null;
  assert.equal(normalizePureCueReflectionResult(value,bundle).itemResults[0]!.proposals.length,0);
  value.itemResults.push(value.itemResults[0]!);
  assert.ok(validatePureCueReflectionResultV1Wire(value,bundle).some(e => e.includes('duplicate')));
});
test('reject already accepted response, changed stimulus, and stale expected content', () => {
  const accepted = structuredClone(bundle); accepted.items[0]!.submittedWord = word('A');
  assert.throws(() => parsePureCueReflectionBundle(accepted));
  const changed = structuredClone(bundle); changed.items[0]!.currentCue.stimulus = 'new meaning';
  assert.throws(() => parsePureCueReflectionBundle(changed));
  const result = normalizePureCueReflectionResult(wire(),bundle);
  const operation = result.itemResults[0]!.proposals[0]!.operation;
  if (operation.kind !== 'reconcile_pure_cue_response') throw new Error('wrong kind');
  operation.expectedTeachingNote = 'stale';
  assert.ok(validatePureCueReflectionResult(result,bundle).some(e => e.includes('expected content')));
});
test('bundle parser validates nested shapes while permitting an empty axis note', () => {
  const emptyAxis = structuredClone(bundle);
  emptyAxis.items[0]!.currentCue.axisNote = '';
  emptyAxis.items[0]!.servedSnapshot.axisNote = '';
  assert.doesNotThrow(() => parsePureCueReflectionBundle(emptyAxis));
  for (const corrupt of [
    (b: PureCueReflectionBundleV1) => Object.assign(b.items[0]!.currentCue.acceptedWords[0]!, {meanings:42}),
    (b: PureCueReflectionBundleV1) => Object.assign(b.items[0]!.servedSnapshot.acceptedAnswers[0]!, {unexpected:true}),
    (b: PureCueReflectionBundleV1) => Object.assign(b.session, {startedAt:'not a timestamp'}),
    (b: PureCueReflectionBundleV1) => Object.assign(b.items[0]!.activeProductionCues[0]!, {acceptedWordIds:['A']}),
  ]) {
    const bad = structuredClone(bundle); corrupt(bad);
    assert.throws(() => parsePureCueReflectionBundle(bad));
  }
});
test('malformed wire and durable nested data yield validation errors', () => {
  const badWire = wire(); Object.assign(badWire.itemResults[0]!.extension!, {responseWordPlan:null});
  assert.ok(validatePureCueReflectionResultV1Wire(badWire,bundle).length);
  const result = normalizePureCueReflectionResult(wire(),bundle);
  Object.assign(result.itemResults[0]!, {questions:[{question:'Unexpected',reason:'Unsupported'}]});
  Object.assign(result.itemResults[0]!.proposals[0]!, {proposalGroupKey:'external-group',rationale:null});
  assert.ok(validatePureCueReflectionResult(result,bundle).length >= 3);
});
