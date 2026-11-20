import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog } from '../server/db/vocabulary-content.ts';
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { getDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { listModelInvocations } from '../server/db/model-invocations.ts';
import { installModelInvocationLedger } from '../server/llm/invocation-ledger.ts';
import { createSessionDebriefProvider } from '../server/session-debrief/provider.ts';
import { createWordIntroductionProvider } from '../server/word-content/provider.ts';
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
const debrief: SessionDebriefInput = { schemaVersion: 'session_debrief_input.v1', sessionDate: '2026-10-06T00:00:00.000Z', interests: [],
  items: [{ ref: 'w1', word: '学问', pinyin: 'xué wèn' }] };

test('debrief retains spend for JSON, schema, domain and truncation failures', async () => {
  for (const [content, finish] of [
    ['not JSON', 'stop'], ['{}', 'stop'],
    [JSON.stringify({ notes: [{ text: 'Example.', refs: ['missing'], followUp: null }] }), 'stop'],
    ['{"notes":[]}', 'length'],
  ]) await rejectedInvocation(() => createSessionDebriefProvider(providerOptions(content, finish)).generate(debrief, 'debrief-attempt'));
});

const content = wordContentFixtures[0]!.content;
const validReview = { exercises: [{ id: 'context', cueType: 'circumstance', stimulus: { kind: 'direct_text',
  text: 'Before a visitor arrives, formally notify the office so it has a record of the visit.' }, supplement: null }] };
test('word schema rejection and shared bootstrap domain rejection invalidate their invocation', async () => {
  await rejectedInvocation(() => createWordIntroductionProvider(providerOptions('{}')).generateReview(content));
  const word = content.word;
  getDb().prepare(`INSERT INTO lexical_words (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
    VALUES (?, ?, ?, ?, 'meaning', '["meaning"]', '[]', 10, '2026-10-06')`).run('validation-bootstrap', word.hanzi, word.traditional, word.pinyin);
  const actor={kind:'service' as const,id:'validation-fixture'};
  createVocabularySense({senseId:'validation-use',wordId:'validation-bootstrap',description:{label:'label',notes:[]}},actor);
  establishVocabularySenseCatalog('validation-bootstrap',getVocabularySenseCatalog('validation-bootstrap').version,actor);
  writeVocabularyDefaultUsefulSenses('validation-bootstrap',0,['validation-use'],actor);
  // Valid schema, invalid reference: the use names an example that was never generated.
  const output = { uses: [{ id: 'validation-use', exampleIds: ['missing'] }],
    examples: [{ id: 'example', text: 'Example.', translation: 'Example.', pronunciation: null }] };
  const shared = createSharedWordPreparation(createWordIntroductionProvider(providerOptions(JSON.stringify(output))));
  await rejectedInvocation(() => shared.generate('validation-bootstrap', 'bootstrap', 'unclaimed-token'));
});

test('shared teaching and review domain validation invalidate calls after schema validation succeeds', async () => {
  const bootstrap = createSharedWordPreparation(createWordIntroductionProvider(providerOptions(JSON.stringify({
    uses: [{id:'validation-use',exampleIds:content.examples.map(example=>example.id)}], examples: content.examples,
  }))));
  const now = new Date();
  assert.equal(bootstrap.claim('validation-bootstrap', 'bootstrap', 'bootstrap-token', now.toISOString(),
    new Date(now.getTime() + 60_000).toISOString()), 'claimed');
  await owner(() => bootstrap.generate('validation-bootstrap', 'bootstrap', 'bootstrap-token'));
  const invalidTeaching = { beats: [{ id: 'beat', parts: [{ kind: 'example', exampleId: 'missing', field: 'sentence' }] }] };
  const practice = { rehearsals: [{ id: 'r', stimulus: { kind: 'direct_text', text: 'Report in advance.' } }] };
  const options = providerOptions('');
  const shared = createSharedWordPreparation(createWordIntroductionProvider({ ...options,
    fetchImplementation: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const payload = request.response_format.json_schema.name.includes('practice') ? practice : invalidTeaching;
      return providerOptions(JSON.stringify(payload)).fetchImplementation();
    },
  }));
  const existing = new Set(listModelInvocations().rows.map(row => row.id));
  assert.equal(shared.claim('validation-bootstrap', 'teaching', 'teaching-token', new Date().toISOString(),
    new Date(Date.now() + 60_000).toISOString()), 'claimed');
  await assert.rejects(() => owner(() => shared.generate('validation-bootstrap', 'teaching', 'teaching-token')));
  shared.release('validation-bootstrap', 'teaching', 'teaching-token');
  const added = listModelInvocations().rows.filter(row => !existing.has(row.id));
  assert.equal(added.length, 1, 'invalid introduction prevents an incoherent speculative practice call');
  assert.equal(added.find(row => row.invocationType === 'intro_lab_teaching_v2')?.status, 'invalid_response');
  assert.equal(added.some(row => row.invocationType === 'intro_lab_practice_v1'), false);
  assert.ok(added.every(row => row.spendUsd! > 0));
  const invalidReview = { exercises: [{ ...validReview.exercises[0], cueType: 'minimal_context', stimulus: {
    kind: 'example_cloze', exampleId: 'missing', occurrenceIndexes: [0], frame: null,
  } }] };
  const review = createSharedWordPreparation(createWordIntroductionProvider(providerOptions(JSON.stringify(invalidReview))));
  await rejectedInvocation(() => review.generate('validation-bootstrap', 'review', 'unclaimed-token'));
});

test('local lab domain validation also invalidates its own bootstrap and teaching calls', async () => {
  const lexical = { hanzi: content.word.hanzi, traditional: content.word.traditional, pinyin: content.word.pinyin, guidance: '' };
  const invalidBootstrap = { uses: [{ id: 'use', label: 'label', notes: [], exampleIds: ['missing'] }], examples: content.examples };
  const invalidLab = createIntroductionLabService({ dataDir: directory,
    provider: createWordIntroductionProvider(providerOptions(JSON.stringify(invalidBootstrap))) });
  await rejectedInvocation(() => invalidLab.bootstrap(lexical));
  const lab = createIntroductionLabService({ dataDir: directory,
    provider: createWordIntroductionProvider(providerOptions(JSON.stringify({ beats: [{ id: 'beat', parts: [{ kind: 'example', exampleId: 'missing', field: 'sentence' }] }] }))) });
  const draft = await lab.importDraft({ content, origin: 'sample' });
  await rejectedInvocation(() => lab.generateTeaching(draft.id));
});
