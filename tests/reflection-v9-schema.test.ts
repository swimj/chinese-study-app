import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ReflectionItemV6,
  type ReconcileProductionCuesOperationV1,
  type SessionReflectionBundleV6,
  type SessionReflectionResultV9,
  validateReflectionOperation,
  validateSessionReflectionResultV8,
  validateSessionReflectionResultV9,
  stampReconcileProductionCuesOperation,
} from '../src/domain/reflection.ts';
import { parseSessionReflectionBundleV6 } from '../src/domain/reflection-evidence.ts';

const at = '2026-09-26T00:00:00.000Z';
const word = (wordId: string) => ({ wordId, hanzi: wordId, pinyin: '', meanings: ['odd'] });
function evidence(): SessionReflectionBundleV6 {
  const item: ReflectionItemV6 = {
    itemId: 'item', source: 'production_mistake', sourceActionKind: 'production',
    sessionActionId: 'action', occurredAt: at, targetWord: word('a'), sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] }, sourceAttemptId: 'attempt',
    servedCue: { cueId: 'cue-a', cueType: 'definition_gloss', text: 'odd', acceptedWordIds: ['a'], supplement: null },
    rawResponse: 'b', submittedWord: word('b'), responseKind: 'matched_known_word',
    promotionEvidence: {
      diagnosisTags: ['production_cue_overloaded'],
      words: ['a', 'b'].map((wordId) => ({ wordId, activeProductionCues: [{ cueId: `cue-${wordId}`, taskId: `production-task:${wordId}:default_production`, cueType: 'definition_gloss', text: 'odd', acceptedWordIds: [wordId] }] })),
      intersectingPureCues: [{ id: 'pure', stimulus: '他这个人真有点____。', axisNote: 'An odd manner.', teachingNote: 'a and c differ in register.', acceptedWordIds: ['a', 'c'], acceptedMembers: [{ wordId: 'a', hanzi: '古怪' }, { wordId: 'c', hanzi: '怪异' }] }],
    },
  };
  return { schemaVersion: 'session_reflection_bundle.v6', generatedAt: at, session: { sessionId: 'session', startedAt: null, endedAt: at, studyProfile: 'mandarin' }, items: [item] };
}
function operation(): ReconcileProductionCuesOperationV1 {
  return { kind: 'reconcile_production_cues', version: 1, sourceAttemptId: 'attempt', targetWordId: 'a', responseWordId: 'b', destination: null, sourceAttemptFairness: 'misleading_or_overloaded_cue', wordPlans: [
    { wordId: 'a', deactivateCueIds: ['cue-a'], distinctiveCueDrafts: [{ cueType: 'minimal_context', text: 'A distinctive cue.' }] },
    { wordId: 'b', deactivateCueIds: [], distinctiveCueDrafts: [] },
  ] };
}
function result(op = operation()): SessionReflectionResultV9 {
  return { schemaVersion: 'session_reflection_result.v9', itemResults: [{ itemId: 'item', diagnosisTags: ['production_cue_overloaded'], learnerExplanation: 'Separate useful exercises repair the ambiguity.', promotionOutcome: 'reconciled', proposals: [{ proposalGroupKey: null, rationale: 'Repair the original misleading cue.', operation: op }], questions: [] }] };
}

test('word-specific cleanup can compensate without a shared destination', () => {
  assert.deepEqual(validateSessionReflectionResultV9(result(), evidence()), []);
  assert.deepEqual(parseSessionReflectionBundleV6(evidence()), evidence());
  const fair = operation(); fair.sourceAttemptFairness = 'fair';
  assert.deepEqual(validateSessionReflectionResultV9(result(fair), evidence()), []);
});
test('source unfairness remains valid when only unrelated word content changes', () => {
  const op = operation();
  op.wordPlans[0]!.deactivateCueIds = [];
  op.wordPlans[0]!.distinctiveCueDrafts = [];
  op.wordPlans[1]!.distinctiveCueDrafts = [{ cueType: 'minimal_context', text: 'An improved response-word cue.' }];
  assert.deepEqual(validateSessionReflectionResultV9(result(op), evidence()), []);
});
test('empty content plans require explanation-only and routed outcomes remain exclusive', () => {
  const op = operation(); op.wordPlans.forEach((plan) => { plan.deactivateCueIds = []; plan.distinctiveCueDrafts = []; });
  assert.match(validateReflectionOperation(op).join('\n'), /explanation_only/);
  const output = result(); output.itemResults[0]!.promotionOutcome = 'explanation_only'; output.itemResults[0]!.proposals = [];
  assert.deepEqual(validateSessionReflectionResultV9(output, evidence()), []);
  output.itemResults[0]!.proposals = result().itemResults[0]!.proposals;
  assert.notDeepEqual(validateSessionReflectionResultV9(output, evidence()), []);
});
test('extension stamps accumulated state and requires all member identities', () => {
  const item = evidence().items[0]!;
  const { kind: _kind, version: _version, sourceAttemptId: _attempt, targetWordId: _target, responseWordId: _response, ...wire } = operation();
  const op = stampReconcileProductionCuesOperation({ ...wire, destination: { kind: 'existing', pureCueId: 'pure', teachingNote: 'All three words fit; their uses differ.' } }, { ...item, responseWord: item.submittedWord!, promotionEvidence: item.promotionEvidence! });
  assert.deepEqual(validateSessionReflectionResultV9(result(op), evidence()), []);
  assert.equal(op.destination?.kind, 'existing');
  if (op.destination?.kind !== 'existing') throw new Error('Expected existing destination');
  assert.deepEqual(op.destination.expectedAcceptedWordIds, ['a', 'c']);
  op.destination.expectedTeachingNote = 'forged';
  assert.match(validateSessionReflectionResultV9(result(op), evidence()).join('\n'), /expected state/);
  const incomplete = evidence(); incomplete.items[0]!.promotionEvidence!.intersectingPureCues[0]!.acceptedMembers.pop();
  assert.throws(() => parseSessionReflectionBundleV6(incomplete), /every accepted member/);
});
test('historical V8 contract rejects the newly registered cleanup operation', () => {
  const current = evidence();
  const oldEvidence = { ...current, schemaVersion: 'session_reflection_bundle.v5' as const };
  const oldResult = { ...result(), schemaVersion: 'session_reflection_result.v8', itemResults: result().itemResults.map((item) => ({ ...item, promotionOutcome: 'promoted' })) };
  assert.match(validateSessionReflectionResultV8(oldResult, oldEvidence).join('\n'), /reserved for V9/);
});

test('unchanged destinations are rejected while unfair retirement-only cleanup remains valid', () => {
  const bundle = evidence();
  const item = bundle.items[0]!;
  const cue = item.promotionEvidence!.intersectingPureCues[0]!;
  cue.acceptedWordIds.push('b'); cue.acceptedMembers.push({ wordId: 'b', hanzi: '怪' });
  const op = operation();
  op.sourceAttemptFairness = 'fair';
  op.wordPlans.forEach((plan) => { plan.deactivateCueIds = []; plan.distinctiveCueDrafts = []; });
  op.destination = { kind: 'existing', pureCueId: cue.id, teachingNote: cue.teachingNote, expectedAcceptedWordIds: [...cue.acceptedWordIds], expectedTeachingNote: cue.teachingNote };
  assert.match(validateSessionReflectionResultV9(result(op), bundle).join('\n'), /explanation_only/);
  const deletion = operation(); deletion.wordPlans[0]!.distinctiveCueDrafts = [];
  assert.deepEqual(validateSessionReflectionResultV9(result(deletion), evidence()), []);
});
