import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { getDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { listModelInvocations } from '../server/db/model-invocations.ts';
import { installModelInvocationLedger } from '../server/llm/invocation-ledger.ts';
import { createDietIntakePlacementProvider } from '../server/diet/intake-placement-provider.ts';
import { createSessionDebriefProvider } from '../server/session-debrief/provider.ts';
import { createLunaReflectionProvider } from '../server/reflection/luna-provider.ts';
import { createWordIntroductionProvider } from '../server/word-content/provider.ts';
import { createWordReviewPreparationService, type WordReviewStore } from '../server/word-content/review-service.ts';
import { createIntroductionLabService } from '../server/word-content-lab/service.ts';
import { createSharedWordPreparation } from '../server/word-content/shared-preparation.ts';
import type { SessionDebriefInput } from '../src/domain/session-debrief.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

let directory: string;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'invocation-validation-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = directory;
  const db = await import('../server/db.ts');
  db.bootstrapLearner({ learnerId: 'validation-a' }); db.bootstrapLearner({ learnerId: 'validation-b' });
  installModelInvocationLedger();
});
after(() => { getDb().close(); fs.rmSync(directory, { recursive: true, force: true }); });
const owner = <T>(work: () => T) => runWithLearnerId('validation-a', work);
function providerOptions(content: string, finishReason = 'stop') {
  return { environment: { OPENAI_API_KEY: 'fake' }, fetchImplementation: async () => new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1000, completion_tokens: 100 },
  }), { status: 200 }) };
}
async function rejectedInvocation(work: () => Promise<unknown>) {
  const existing = new Set(listModelInvocations().rows.map((row) => row.id));
  await assert.rejects(() => owner(work));
  const added = listModelInvocations().rows.filter((row) => !existing.has(row.id));
  assert.equal(added.length, 1);
  assert.equal(added[0].status, 'invalid_response');
  assert.ok(added[0].spendUsd! > 0, 'validation failure retains incurred spend');
  assert.ok(added[0].latencyMs! >= 0, 'validation failure retains transport latency');
}
const intake = { schemaVersion: 'diet_intake_placement_request.v1', answers: [{ prompt: 'Background?', answer: 'Beginner.' }] } as const;
const debrief: SessionDebriefInput = { schemaVersion: 'session_debrief_input.v1', sessionDate: '2026-10-06T00:00:00.000Z', interests: [],
  items: [{ ref: 'w1', word: '学问', pinyin: 'xué wèn' }] };
const session = { sessionId: 's1', startedAt: null, endedAt: null, studyProfile: 'mandarin' } as const;

test('intake and debrief retain spend for JSON, schema, domain and truncation failures', async () => {
  for (const [content, finish] of [
    ['not JSON', 'stop'], ['{}', 'stop'],
    [JSON.stringify({ schemaVersion: 'diet_intake_placement_result.v1', nextLearningLevel: 2, rationale: ' ' }), 'stop'],
    [JSON.stringify({ schemaVersion: 'diet_intake_placement_result.v1', nextLearningLevel: 2, rationale: 'Ready.' }), 'length'],
  ]) await rejectedInvocation(() => createDietIntakePlacementProvider(providerOptions(content, finish)).assess(intake));
  for (const [content, finish] of [
    ['not JSON', 'stop'], ['{}', 'stop'],
    [JSON.stringify({ notes: [{ text: 'Example.', refs: ['missing'], followUp: null }] }), 'stop'],
    ['{"notes":[]}', 'length'],
  ]) await rejectedInvocation(() => createSessionDebriefProvider(providerOptions(content, finish)).generate(debrief, 'debrief-attempt'));
});

test('every reflection stage invalidates rejected output after the transport completed', async () => {
  for (const content of ['not JSON', '{}']) {
    const provider = createLunaReflectionProvider({ ...providerOptions(content), systemPrompt: 'test', diagnosisSystemPrompt: 'test', promotionSystemPrompt: 'test' });
    await rejectedInvocation(() => provider.generate({ schemaVersion: 'session_reflection_bundle.v2', generatedAt: 'now', session, items: [] }));
    await rejectedInvocation(() => provider.generateDiagnosis({ schemaVersion: 'session_reflection_bundle.v4', generatedAt: 'now', session, items: [] }));
    await rejectedInvocation(() => provider.generatePromotion!({ schemaVersion: 'pure_cue_promotion_bundle.v3', generatedAt: 'now', sourceSessionId: 's1', studyProfile: 'mandarin', items: [] }));
    await rejectedInvocation(() => provider.generatePureCueReflection!({ schemaVersion: 'pure_cue_reflection_bundle.v1', generatedAt: 'now', session, items: [] }));
  }
});

const content = wordContentFixtures[0]!.content;
const validReview = { exercises: [{ id: 'context', cueType: 'circumstance', stimulus: { kind: 'direct_text',
  text: 'Before a visitor arrives, formally notify the office so it has a record of the visit.' }, supplement: null }] };
function reviewService(output: unknown, failPublication = false) {
  const store: WordReviewStore = {
    library: () => ({ wordId: content.word.wordId, contents: [{ content, createdAt: '2026-10-06T00:00:00.000Z' }], packages: [], selectedPackageId: null, completed: false }),
    preparation: () => ({ contentId: content.id, packageId: null, activeStage: null }),
    claim: () => 'claimed', release: () => undefined,
    finish: () => { if (failPublication) throw new Error('Persistence unavailable'); return { cueIds: [], supplementIds: [] }; },
  };
  return createWordReviewPreparationService({ store, provider: createWordIntroductionProvider(providerOptions(JSON.stringify(output))), providerWork: async (work) => work() });
}

test('word schema rejection and shared bootstrap domain rejection invalidate their invocation', async () => {
  await rejectedInvocation(() => createWordIntroductionProvider(providerOptions('{}')).generateReview(content));
  const word = content.word;
  getDb().prepare(`INSERT INTO lexical_words (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
    VALUES (?, ?, ?, ?, 'meaning', '["meaning"]', '[]', 10, '2026-10-06')`).run('validation-bootstrap', word.hanzi, word.traditional, word.pinyin);
  // Valid schema, invalid reference: the use names an example that was never generated.
  const output = { uses: [{ id: 'use', label: 'label', notes: [], exampleIds: ['missing'] }],
    examples: [{ id: 'example', text: 'Example.', translation: 'Example.', pronunciation: null }] };
  const shared = createSharedWordPreparation(createWordIntroductionProvider(providerOptions(JSON.stringify(output))));
  await rejectedInvocation(() => shared.generate('validation-bootstrap', 'bootstrap', 'unclaimed-token'));
});

test('concurrent word domain rejection targets its own row; publication failure keeps valid output completed', async () => {
  const existing = new Set(listModelInvocations().rows.map((row) => row.id));
  const invalidReview = { exercises: [{ ...validReview.exercises[0], stimulus: {
    kind: 'example_cloze', exampleId: 'missing', occurrenceIndexes: [0], frame: null,
  } }] };
  await Promise.all([
    assert.rejects(() => owner(() => reviewService(invalidReview).prepare(content.word.wordId)), /unknown|example/i),
    assert.rejects(() => runWithLearnerId('validation-b', () => reviewService(validReview, true).prepare(content.word.wordId)), /Persistence unavailable/),
  ]);
  const rows = listModelInvocations().rows.filter((row) => !existing.has(row.id));
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.learnerId === 'validation-a')!.status, 'invalid_response');
  assert.equal(rows.find((row) => row.learnerId === 'validation-b')!.status, 'completed');
  assert.ok(rows.every((row) => row.spendUsd! > 0 && row.latencyMs! >= 0));
});


test('shared teaching and review domain validation invalidate calls after schema validation succeeds', async () => {
  const bootstrap = createSharedWordPreparation(createWordIntroductionProvider(providerOptions(JSON.stringify({
    uses: content.uses, examples: content.examples,
  }))));
  const now = new Date();
  assert.equal(bootstrap.claim('validation-bootstrap', 'bootstrap', 'bootstrap-token', now.toISOString(),
    new Date(now.getTime() + 60_000).toISOString()), 'claimed');
  await owner(() => bootstrap.generate('validation-bootstrap', 'bootstrap', 'bootstrap-token'));
  const outputs = {
    teaching: { beats: [{ id: 'beat', parts: [{ kind: 'text', text: 'Read the example.' }] }], rehearsals: [{
      id: 'rehearsal', stimulus: { kind: 'example_cloze', exampleId: 'missing', occurrenceIndexes: [0], frame: null },
    }] },
    review: { exercises: [{ ...validReview.exercises[0], cueType: 'minimal_context', stimulus: {
      kind: 'example_cloze', exampleId: 'missing', occurrenceIndexes: [0], frame: null,
    } }] },
  };
  for (const stage of ['teaching', 'review'] as const) {
    const shared = createSharedWordPreparation(createWordIntroductionProvider(providerOptions(JSON.stringify(outputs[stage]))));
    await rejectedInvocation(() => shared.generate('validation-bootstrap', stage, 'unclaimed-token'));
  }
});

test('local lab domain validation also invalidates its own bootstrap and teaching calls', async () => {
  const lexical = { hanzi: content.word.hanzi, traditional: content.word.traditional, pinyin: content.word.pinyin, guidance: '' };
  const invalidBootstrap = { uses: [{ id: 'use', label: 'label', notes: [], exampleIds: ['missing'] }], examples: content.examples };
  const invalidLab = createIntroductionLabService({ dataDir: directory,
    provider: createWordIntroductionProvider(providerOptions(JSON.stringify(invalidBootstrap))) });
  await rejectedInvocation(() => invalidLab.bootstrap(lexical));
  const lab = createIntroductionLabService({ dataDir: directory,
    provider: createWordIntroductionProvider(providerOptions(JSON.stringify({ beats: [{ id: 'beat', parts: [{ kind: 'example', exampleId: 'missing', field: 'sentence' }] }],
      rehearsals: [{ id: 'rehearsal', stimulus: { kind: 'direct_text', text: 'Recall the expression.' } }] }))) });
  const draft = await lab.importDraft({ content, origin: 'sample' });
  await rejectedInvocation(() => lab.generateTeaching(draft.id));
});
