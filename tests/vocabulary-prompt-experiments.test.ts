import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { executeExperiment, prepareExperiment, readExperiment, recordExperimentResponse, recordExperimentReview } from '../server/word-content-lab/vocabulary-experiments/archive.ts';
import { projectExperimentInput, validateExperimentOutput, type ExperimentInput } from '../server/word-content-lab/vocabulary-experiments/contracts.ts';
import { renderExperimentComparison } from '../server/word-content-lab/vocabulary-experiments/preview.ts';

const fixture = wordContentFixtures[0]!;
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function archive() { const dir = await mkdtemp(path.join(os.tmpdir(), 'vocabulary-prompts-')); dirs.push(dir); return dir; }
function options(input: ExperimentInput = { role: 'general_exercises', content: fixture.content }) {
  return { variant: 'test-v1', input, prompt: { name: input.role, version: '1', text: 'A retained test prompt.' },
    settings: { provider: 'test', model: 'test-model', reasoningEffort: null, maxOutputTokens: 1000, temperature: null } };
}
function output(count = 1): { exercises: Array<{ id: string; sourceUseId: string | null; stimulus: { kind: 'direct_text'; text: string }; teachingNote: string | null }> } { return { exercises: Array.from({ length: count }, (_, index) => ({
  id: `exercise-${index}`, sourceUseId: fixture.content.uses[0]!.id,
  stimulus: { kind: 'direct_text', text: 'Notify the responsible people so information is on record.' }, teachingNote: null,
})) }; }
const observation = (value: unknown) => ({ origin: 'fixture' as const, rawText: JSON.stringify(value),
  resolvedModel: null, providerRequestId: null, finishReason: null, usage: null, cost: null });

test('teaching captures exact displayed introduction; general practice contains no priming', () => {
  const teaching: ExperimentInput = { role: 'teaching_exercises', content: fixture.content, introduction: fixture.teaching };
  const projection = projectExperimentInput(teaching) as { deliveredIntroduction: { beats: Array<{ parts: Array<{ text: string }> }> } };
  assert.ok(projection.deliveredIntroduction.beats.some((beat) => beat.parts.some((part) => part.text.includes('你得先向物业报备'))));
  assert.equal(Object.hasOwn(projectExperimentInput({ role: 'general_exercises', content: fixture.content }) as object, 'deliveredIntroduction'), false);
  assert.throws(() => projectExperimentInput({ ...teaching, introduction: { ...fixture.teaching, wordContentId: 'other' } }));
});

test('broad pools and near duplicates remain valid; bad IDs and answer leaks do not', () => {
  const input = options().input;
  assert.deepEqual(validateExperimentOutput(input, output(8)).structuralErrors, []);
  const unresolved = output(); unresolved.exercises[0]!.sourceUseId = null;
  assert.deepEqual(validateExperimentOutput(input, unresolved).structuralErrors, []);
  const unknown = output(); unknown.exercises[0]!.sourceUseId = 'nonexistent';
  assert.ok(validateExperimentOutput(input, unknown).structuralErrors.length);
  const leaked = output(); leaked.exercises[0]!.stimulus.text = 'Write 报备.';
  assert.ok(validateExperimentOutput(input, leaked).structuralErrors.length);
  const duplicate = output(2); duplicate.exercises[1]!.id = duplicate.exercises[0]!.id;
  assert.ok(validateExperimentOutput(input, duplicate).structuralErrors.length);
});

test('request is retained before transport and later caller mutation cannot change it', async () => {
  const root = await archive();
  const config = options();
  const { request, result } = await executeExperiment(root, config, async (saved) => {
    assert.deepEqual(await readExperiment(root, saved.id), saved);
    config.prompt.text = 'Changed after dispatch';
    return { ...observation(output()), resolvedModel: 'resolved-test' };
  });
  assert.equal(result.status, 'completed');
  assert.equal((await readExperiment(root, request.id)).prompt.text, 'A retained test prompt.');
  await assert.rejects(recordExperimentResponse(root, request.id, observation(output())), { code: 'EEXIST' });
});

test('invalid and failed attempts are retained separately without erasing prior success', async () => {
  const root = await archive();
  const success = await executeExperiment(root, options(), async () => observation(output()));
  const invalid = await prepareExperiment(root, options());
  const invalidResult = await recordExperimentResponse(root, invalid.id, { ...observation(null), rawText: '{' });
  assert.equal(invalidResult.failureCode, 'invalid_json');
  const failed = await executeExperiment(root, options(), async () => { throw new Error('Bearer secret-do-not-save'); });
  assert.equal(failed.result.status, 'provider_failed');
  assert.equal((await readdir(root)).length, 3);
  assert.equal((await readFile(path.join(root, failed.request.id, 'result.json'), 'utf8')).includes('secret-do-not-save'), false);
  assert.equal(JSON.parse(await readFile(path.join(root, success.request.id, 'result.json'), 'utf8')).status, 'completed');
});

test('truncation never becomes valid content even when the returned prefix parses', async () => {
  const root = await archive(); const request = await prepareExperiment(root, options());
  const result = await recordExperimentResponse(root, request.id, { ...observation(output()), finishReason: 'length' });
  assert.equal(result.status, 'incomplete');
});

test('reviews stay separate from generation and static previews escape model-authored markup', async () => {
  const root = await archive(); const request = await prepareExperiment(root, options());
  const malicious = output(); malicious.exercises[0]!.stimulus.text = '<script>alert(1)</script>';
  await recordExperimentResponse(root, request.id, observation(malicious));
  await recordExperimentReview(root, request.id, { author: 'Justin', scope: 'exercise', exerciseId: 'exercise-0', note: 'Needs a real cue.', decision: 'revise' });
  await assert.rejects(recordExperimentReview(root, request.id, { author: 'Justin', scope: 'exercise', exerciseId: 'unknown', note: 'No.', decision: 'reject' }));
  assert.equal((await readdir(path.join(root, request.id, 'reviews'))).length, 1);
  const html = await renderExperimentComparison(root, [request.id]);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('fixture'));
  await assert.rejects(readExperiment(root, '../bad'));
});

test('bootstrap and introduction validate source references through existing authoring guards', () => {
  const { wordId, hanzi, traditional, pinyin } = fixture.content.word;
  const bootstrap: ExperimentInput = { role: 'bootstrap', word: { wordId, hanzi, traditional, pinyin, guidance: '' } };
  assert.deepEqual(validateExperimentOutput(bootstrap, { uses: fixture.content.uses, examples: fixture.content.examples }).structuralErrors, []);
  const introduction: ExperimentInput = { role: 'introduction', content: fixture.content };
  assert.deepEqual(validateExperimentOutput(introduction, { beats: fixture.teaching.beats }).structuralErrors, []);
  assert.ok(validateExperimentOutput(introduction, { beats: [{ id: 'bad', parts: [{ kind: 'example', exampleId: 'missing', field: 'sentence' }] }] }).structuralErrors.length);
});
