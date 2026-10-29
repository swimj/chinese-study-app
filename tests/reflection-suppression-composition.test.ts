import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleStagedReflectionResult } from '../server/reflection/generation.ts';
import { validateSessionReflectionResultV10, type SessionReflectionBundleV6, type StagedReflectionDiagnosisResultV3, type PureCuePromotionResultV2Wire } from '../src/domain/reflection.ts';

const reason = '式 is a bound form whose isolated production is not useful.';
const word = (wordId: string) => ({ wordId, hanzi: wordId, pinyin: 'shi4', meanings: ['form'] });
const evidence: SessionReflectionBundleV6 = {
  schemaVersion: 'session_reflection_bundle.v6', generatedAt: '2026-09-30T00:00:00.000Z',
  session: { sessionId: 'session', startedAt: null, endedAt: '2026-09-30T00:00:00.000Z', studyProfile: 'mandarin' },
  items: [{ itemId: 'item', source: 'production_mistake', sourceActionKind: 'production', sessionActionId: 'action', occurredAt: '2026-09-30T00:00:00.000Z', sourceAttemptId: 'attempt', targetWord: word('target'), submittedWord: word('response'), rawResponse: 'response', responseKind: 'matched_known_word', sessionNote: null,
    servedCue: { cueId: null, cueType: 'definition_gloss', text: 'form', acceptedWordIds: ['target'], supplement: null }, existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    promotionEvidence: { diagnosisTags: ['production_cue_overloaded'], words: ['target', 'response'].map(wordId => ({ wordId, activeProductionCues: [] })), intersectingPureCues: [] },
  }],
};
function diagnosis(suppress = true): StagedReflectionDiagnosisResultV3 {
  return { schemaVersion: 'staged_reflection_diagnosis_result.v3', itemResults: [{ kind: 'ambiguous_pair', itemId: 'item', diagnosisTags: ['production_cue_overloaded'], handoff: { ambiguityReason: 'The response fits.', targetSuppression: suppress ? { reason } : null } }] };
}
function promotion(targetChanges: boolean, responseChanges: boolean, shared = false): PureCuePromotionResultV2Wire {
  return { schemaVersion: 'pure_cue_promotion_result.v2', itemResults: [{ itemId: 'item', decision: { kind: 'reconcile', learnerExplanation: 'Practice both words.', rationale: 'More specific cues.', operation: { sourceAttemptFairness: 'misleading_or_overloaded_cue', destination: shared ? { kind: 'create', stimulus: 'form', axisNote: 'form', teachingNote: 'Compare the forms.' } : null, wordPlans: [['target', targetChanges], ['response', responseChanges]].map(([wordId, change]) => ({ wordId: String(wordId), deactivateCueIds: [], distinctiveCueDrafts: change ? [{ cueType: 'minimal_context' as const, text: `A distinct use of ${wordId}.` }] : [] })) } } }] };
}

test('suppression and response fixes compose without changing the response plan', () => {
  const result = assembleStagedReflectionResult(diagnosis(), evidence, promotion(false, true));
  assert.deepEqual(validateSessionReflectionResultV10(result, evidence), []);
  const item = result.itemResults[0]!;
  assert.equal(item.withheldTargetChanges, undefined);
  assert.deepEqual(item.proposals.map(p => p.operation.kind), ['suppress_definition_production', 'reconcile_production_cues']);
  assert.equal(item.proposals[0]!.rationale, reason);
  const operation = item.proposals[1]!.operation;
  assert.equal(operation.kind, 'reconcile_production_cues');
  if (operation.kind !== 'reconcile_production_cues') return;
  assert.deepEqual(operation.wordPlans[0], { wordId: 'target', deactivateCueIds: [], distinctiveCueDrafts: [] });
  assert.equal(operation.wordPlans[1]!.distinctiveCueDrafts[0]!.text, 'A distinct use of response.');
  for (const change of ['target', 'shared', 'reason', 'group'] as const) {
    const invalid = structuredClone(result);
    const first = invalid.itemResults[0]!;
    const op = first.proposals[1]!.operation;
    if (op.kind !== 'reconcile_production_cues') throw new Error('Expected reconcile');
    if (change === 'target') op.wordPlans[0]!.distinctiveCueDrafts.push({ cueType: 'minimal_context', text: 'target cue' });
    if (change === 'shared') op.destination = { kind: 'create', stimulus: 'shared', axisNote: 'shared', teachingNote: 'Shared.' };
    if (change === 'reason') first.proposals[0]!.rationale = 'A different reason';
    if (change === 'group') first.proposals[0]!.proposalGroupKey = 'group';
    assert.notDeepEqual(validateSessionReflectionResultV10(invalid, evidence), [], change);
  }
});

test('target and shared conflicts are retained as information while response changes survive', () => {
  const item = assembleStagedReflectionResult(diagnosis(), evidence, promotion(true, true, true)).itemResults[0]!;
  assert.equal(item.proposals.length, 2);
  assert.equal(item.withheldTargetChanges?.wordPlan.distinctiveCueDrafts.length, 1);
  assert.equal(item.withheldTargetChanges?.destination?.kind, 'create');
  assert.equal(item.withheldTargetChanges?.learnerExplanation, 'Practice both words.');
  assert.notEqual(item.learnerExplanation, 'Practice both words.');
  const op = item.proposals[1]!.operation;
  if (op.kind !== 'reconcile_production_cues') throw new Error('Expected reconcile');
  assert.equal(op.destination, null);
  assert.equal(op.wordPlans[0]!.distinctiveCueDrafts.length, 0);
  assert.equal(op.wordPlans[1]!.distinctiveCueDrafts.length, 1);
});

test('target-only conflict and explanation-only output both preserve suppression as the only action', () => {
  const explanation: PureCuePromotionResultV2Wire = { schemaVersion: 'pure_cue_promotion_result.v2', itemResults: [{ itemId: 'item', decision: { kind: 'explanation_only', learnerExplanation: 'The response was reasonable.' } }] };
  for (const output of [promotion(true, false), explanation]) {
    const result = assembleStagedReflectionResult(diagnosis(), evidence, output);
    assert.deepEqual(validateSessionReflectionResultV10(result, evidence), []);
    assert.equal(result.itemResults[0]!.promotionOutcome, 'explanation_only');
    assert.deepEqual(result.itemResults[0]!.proposals.map(p => p.operation.kind), ['suppress_definition_production']);
  }
});

test('without suppression both word plans and shared destination retain existing behavior', () => {
  const item = assembleStagedReflectionResult(diagnosis(false), evidence, promotion(true, true, true)).itemResults[0]!;
  assert.equal(item.targetSuppression, undefined);
  assert.equal(item.withheldTargetChanges, undefined);
  assert.equal(item.proposals.length, 1);
  const op = item.proposals[0]!.operation;
  if (op.kind !== 'reconcile_production_cues') throw new Error('Expected reconcile');
  assert.equal(op.destination?.kind, 'create');
  assert.equal(op.wordPlans[0]!.distinctiveCueDrafts.length, 1);
});

test('a response plan dependent on a withheld shared destination is wholly informational', () => {
  const input = structuredClone(evidence);
  input.items[0]!.promotionEvidence!.words[1]!.activeProductionCues.push({
    cueId: 'response-cue', taskId: 'production-task:response:default_production', cueType: 'definition_gloss', text: 'form', acceptedWordIds: ['response'],
  });
  const output = promotion(true, true, true);
  const decision = output.itemResults[0]!.decision;
  if (decision.kind !== 'reconcile') throw new Error('Expected reconciliation');
  decision.operation.wordPlans[1]!.deactivateCueIds.push('response-cue');
  const result = assembleStagedReflectionResult(diagnosis(), input, output);
  assert.deepEqual(validateSessionReflectionResultV10(result, input), []);
  const item = result.itemResults[0]!;
  assert.equal(item.promotionOutcome, 'explanation_only');
  assert.deepEqual(item.proposals.map(p => p.operation.kind), ['suppress_definition_production']);
  assert.deepEqual(item.withheldTargetChanges?.dependentResponsePlan, decision.operation.wordPlans[1]);
  assert.equal(item.withheldTargetChanges?.dependentResponsePlan?.distinctiveCueDrafts.length, 1);
});

test('response retirements without a shared destination remain actionable beside suppression', () => {
  const input = structuredClone(evidence);
  input.items[0]!.promotionEvidence!.words[1]!.activeProductionCues.push({
    cueId: 'response-cue', taskId: 'production-task:response:default_production', cueType: 'definition_gloss', text: 'form', acceptedWordIds: ['response'],
  });
  const output = promotion(false, true);
  const decision = output.itemResults[0]!.decision;
  if (decision.kind !== 'reconcile') throw new Error('Expected reconciliation');
  decision.operation.wordPlans[1]!.deactivateCueIds.push('response-cue');
  const result = assembleStagedReflectionResult(diagnosis(), input, output);
  const item = result.itemResults[0]!;
  assert.equal(item.withheldTargetChanges, undefined);
  assert.equal(item.proposals.length, 2);
  const op = item.proposals[1]!.operation;
  if (op.kind !== 'reconcile_production_cues') throw new Error('Expected reconcile');
  assert.deepEqual(op.wordPlans[1]!.deactivateCueIds, ['response-cue']);
});
