import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialReflectionGenerationService } from '../server/reflection/generation.ts';
import { ReflectionEvidenceError } from '../server/reflection/evidence.ts';
import { createLunaReflectionProvider, LunaReflectionProviderError, type LunaReflectionProvider, type LunaReflectionRunMetadata } from '../server/reflection/luna-provider.ts';
import { PURE_CUE_REFLECTION_PROMPT_VERSION, STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION } from '../src/domain/reflection-contracts.ts';
import type { PureCueReflectionBundleV1, PureCueReflectionResultV1Wire } from '../src/domain/pure-cue-reflection.ts';
import { normalizePureCueReflectionResult } from '../src/domain/pure-cue-reflection.ts';
import type { SessionReflectionBundleV4 } from '../src/domain/reflection.ts';
import type { MaterializeReflectionArtifactInput, RecordReflectionGenerationRunInput, StartReflectionGenerationRunInput } from '../server/db/reflections.ts';
import { createTestReflectionContinuationBoundaries } from './helpers/reflection-continuation.ts';

const time = '2026-09-30T00:00:00.000Z';
const word = (wordId: string) => ({ wordId, hanzi: wordId, pinyin: wordId, meanings: [wordId] });
const bundle: PureCueReflectionBundleV1 = {
  schemaVersion: 'pure_cue_reflection_bundle.v1', generatedAt: time,
  session: { sessionId: 'session', startedAt: time, endedAt: time, studyProfile: 'mandarin' },
  items: [{ source: 'pure_cue_mistake', sourceActionKind: 'pure_cue', itemId: 'pure-item', sourceAttemptId: 'assessment', firstEventId: 'first', sessionActionId: 'action', occurredAt: time, rawResponse: 'C', submittedWord: word('C'), targetWord: null, sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    servedSnapshot: { snapshotId: 'snapshot', pureCueId: 'cue', servedAt: time, stimulus: 'shared situation', axisNote: '', teachingNote: 'A or B', acceptedAnswers: [] },
    currentCue: { id: 'cue', stimulus: 'shared situation', axisNote: '', teachingNote: 'A or B', acceptedWordIds: ['A', 'B'], acceptedWords: [word('A'), word('B')] }, activeProductionCues: [],
  }],
};
const wire: PureCueReflectionResultV1Wire = {
  schemaVersion: 'pure_cue_reflection_result.v1', itemResults: [{ itemId: 'pure-item', decision: 'extend', reason: null, learnerExplanation: 'C fits this situation.', rationale: 'C is valid.', extension: { teachingNote: 'A, B or C', responseWordPlan: { deactivateCueIds: [], distinctiveCueDrafts: [] } } }],
};
const metadata = (promptVersion = PURE_CUE_REFLECTION_PROMPT_VERSION): LunaReflectionRunMetadata => ({
  provider: 'openai', modelConfig: 'gpt-5.6-luna-high', providerModel: 'gpt-5.6-luna', promptVersion, responseId: 'response', finishReason: 'stop',
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningTokens: null },
});
const ordinary: SessionReflectionBundleV4 = {
  schemaVersion: 'session_reflection_bundle.v4', generatedAt: time, session: bundle.session,
  items: [{ itemId: 'ordinary-item', source: 'production_mistake', sourceActionKind: 'production', sourceAttemptId: 'ordinary-attempt', sessionActionId: 'ordinary-action', occurredAt: time, targetWord: word('D'), submittedWord: word('D'), rawResponse: 'D', responseKind: 'matched_known_word', sessionNote: null, existingContent: { contrastClusters: [], knownAcceptedAlternates: [] }, servedCue: { cueId: 'word-cue', cueType: 'definition_gloss', text: 'D', acceptedWordIds: ['D'], supplement: null } }],
};
function harness(options: { ordinary?: boolean; pureFails?: boolean; ordinaryFails?: boolean } = {}) {
  const starts: StartReflectionGenerationRunInput[] = [];
  const runs: RecordReflectionGenerationRunInput[] = [];
  const artifacts: MaterializeReflectionArtifactInput[] = [];
  const suppliedBundles: PureCueReflectionBundleV1[] = [];
  let pureFails = options.pureFails ?? false;
  const provider: LunaReflectionProvider = {
    async generate() { throw new Error('Legacy provider called'); },
    async generatePureCueReflection(input) { suppliedBundles.push(input); if (pureFails) throw new Error('Pure provider unavailable'); return { result: wire, metadata: metadata() }; },
    async generateDiagnosis() {
      if (options.ordinaryFails) throw new Error('Ordinary provider unavailable');
      return { result: { schemaVersion: 'staged_reflection_diagnosis_result.v3', itemResults: [{ kind: 'ordinary', itemId: 'ordinary-item', diagnosisTags: [], learnerExplanation: 'No change.', proposals: [], questions: [] }] }, metadata: metadata(STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION) };
    },
  };
  const boundaries = createTestReflectionContinuationBoundaries();
  const service = createInitialReflectionGenerationService({
    ...boundaries, provider, now: () => time, buildPureCueBundle: () => bundle,
    buildBundle: () => { if (!options.ordinary) throw new ReflectionEvidenceError('no_qualifying_evidence', 'No ordinary evidence'); return ordinary; },
    getPureCueRetrySource: (id) => { const run = runs.find((entry) => entry.runId === id); return run ? { bundle: run.evidenceBundle as PureCueReflectionBundleV1, model: 'gpt-5.6-luna-high' } : null; },
    startRun: (input) => { starts.push(input); }, recordRun: (input) => { runs.push(input); },
    materializeArtifact: (input) => { artifacts.push(input); return { created: true, artifact: { artifactId: `artifact-${artifacts.length}`, proposals: [] } } as ReturnType<NonNullable<import('../server/reflection/generation.ts').InitialReflectionGenerationDependencies['materializeArtifact']>>; },
  });
  return { service, starts, runs, artifacts, suppliedBundles, recover: () => { pureFails = false; } };
}

test('pure-only session calls dedicated provider and stamps durable operation identities', async () => {
  const h = harness();
  const result = await h.service.generate('session', { items: [] });
  assert.equal(result.proposalCount, 1);
  assert.equal(h.starts.length, 1);
  assert.equal(h.runs[0].state, 'succeeded');
  const operation = h.artifacts[0].result.itemResults[0].proposals[0].operation;
  assert.deepEqual(operation, { kind: 'reconcile_pure_cue_response', version: 1, sourceAttemptId: 'assessment', responseWordId: 'C', pureCueId: 'cue', expectedAcceptedWordIds: ['A', 'B'], expectedTeachingNote: 'A or B', teachingNote: 'A, B or C', responseWordPlan: { wordId: 'C', deactivateCueIds: [], distinctiveCueDrafts: [] } });
});

test('failed dedicated call persists frozen bundle and retry reuses it', async () => {
  const h = harness({ pureFails: true });
  await assert.rejects(h.service.generate('session', { items: [] }), /Pure provider unavailable/);
  assert.equal(h.runs[0].state, 'failed');
  assert.deepEqual(h.runs[0].evidenceBundle, bundle);
  h.recover();
  const retried = await h.service.retry(h.runs[0].runId);
  assert.equal(retried.proposalCount, 1);
  assert.equal(h.suppliedBundles.length, 2);
  assert.deepEqual(h.suppliedBundles[1], h.suppliedBundles[0]);
  assert.notEqual(h.runs[0].runId, h.runs[1].runId);
});

for (const failing of ['none', 'ordinary', 'pure'] as const) {
  test(`independent calls preserve successful artifacts when ${failing} fails`, async () => {
    const h = harness({ ordinary: true, ordinaryFails: failing === 'ordinary', pureFails: failing === 'pure' });
    const result = await h.service.generate('session', {});
    assert.equal(h.starts.length, 2);
    assert.equal(h.artifacts.length, failing === 'none' ? 2 : 1);
    assert.equal(Boolean(result.partialFailure), failing !== 'none');
    assert.equal(result.additionalArtifactIds?.length ?? 0, failing === 'none' ? 1 : 0);
    assert.equal(h.runs.filter((run) => run.state === 'failed').length, failing === 'none' ? 0 : 1);
  });
}

test('dedicated provider sends its own prompt and strict wire schema, then normalized result stamps ids', async () => {
  let body: Record<string, unknown> | null = null;
  const provider = createLunaReflectionProvider({ environment: { OPENAI_API_KEY: 'test' }, fetchImplementation: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'response', model: 'gpt-5.6-luna', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(wire) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const output = await provider.generatePureCueReflection!(bundle);
  assert.equal(output.metadata.promptVersion, PURE_CUE_REFLECTION_PROMPT_VERSION);
  const request = body as unknown as { messages: Array<{ content: string }>; response_format: { json_schema: { name: string; strict: boolean } } };
  assert.equal(request.response_format.json_schema.name, 'pure_cue_reflection_result_v1');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.deepEqual(JSON.parse(request.messages[1].content), bundle);
  assert.match(request.messages[0].content, /pure cue/i);
  const operation = normalizePureCueReflectionResult(output.result, bundle).itemResults[0].proposals[0].operation;
  assert.equal(operation.kind, 'reconcile_pure_cue_response');
  assert.equal('sourceAttemptId' in operation && operation.sourceAttemptId, 'assessment');
});


test('dedicated provider rejects unknown item ids before normalization', async () => {
  const invalid = structuredClone(wire);
  invalid.itemResults[0].itemId = 'unserved-item';
  const provider = createLunaReflectionProvider({ environment: { OPENAI_API_KEY: 'test' }, fetchImplementation: async () => new Response(JSON.stringify({
    id: 'response', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(invalid) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(provider.generatePureCueReflection!(bundle), (error: unknown) =>
    error instanceof LunaReflectionProviderError && error.code === 'domain_contract_invalid');
});
