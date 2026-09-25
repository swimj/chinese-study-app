import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeReviewExercises } from '../server/word-content/review-authoring.ts';
import { createWordIntroductionProvider } from '../server/word-content/provider.ts';
import { materializeExercise } from '../src/domain/word-content/materialize.ts';
import { adaptTargetedReviewExercise, toProductionExerciseSnapshot } from '../src/domain/word-content/review-compat.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const content = wordContentFixtures[0]!.content;
const idFor = (localId: string) => `review:${localId}`;
const circumstance = () => ({
  id: 'notification', cueType: 'circumstance',
  stimulus: { kind: 'direct_text', text: 'Notify the responsible office in advance so your changed travel plans are formally on record.' },
  supplement: null,
});
const cloze = () => ({
  id: 'property', cueType: 'minimal_context',
  stimulus: { kind: 'example_cloze', exampleId: 'property', occurrenceIndexes: [0], frame: 'Notify the management office for the record.' },
  supplement: null,
});
const definition = () => ({
  id: 'definition', cueType: 'definition_gloss',
  stimulus: { kind: 'direct_text', text: 'To notify the responsible authority in advance so the information is on record.' },
  supplement: { exampleId: 'property', englishFrame: 'Notifying property management about a visitor.' },
});

test('authors standalone review with exact target identity and contextual source references', () => {
  const [item] = normalizeReviewExercises({ exercises: [cloze()] }, content, idFor);
  assert.ok(item);
  assert.equal(item.exercise.instruction, '');
  assert.deepEqual(item.exercise.contract, { kind: 'targeted_review', wordId: content.word.wordId });
  assert.deepEqual(item.exercise.acceptedAnswers, [{ wordId: content.word.wordId, hanzi: content.word.hanzi, traditional: content.word.traditional }]);
  assert.equal(item.exercise.stimulus.kind, 'example_cloze');
  const snapshot = materializeExercise(item.exercise, [content]);
  assert.match(snapshot.stimulus.text, /____/);
  assert.ok(!snapshot.stimulus.text.includes(content.word.hanzi));
  assert.ok(Object.isFrozen(item.exercise));
});

test('definition reinforcement is post-reveal and coexists with an independently contextual exercise', () => {
  const items = normalizeReviewExercises({ exercises: [circumstance(), definition()] }, content, idFor);
  const item = items[1]!;
  const adapted = adaptTargetedReviewExercise(item.exercise, [content], {
    taskId: 'task:owner', cueId: item.exercise.id, cueType: item.cueType, supplement: item.supplement,
  });
  const served = toProductionExerciseSnapshot(adapted);
  assert.equal(served.supplement?.exampleSentence, content.examples[0]!.text);
  assert.equal(served.supplement?.exampleTranslation, content.examples[0]!.translation);
  assert.ok(!served.text.includes(content.word.hanzi));
  assert.equal(item.supplement?.kind, 'example');
});

test('validates output bounds, local/durable uniqueness, and contextual requirement', () => {
  for (const exercises of [[], [definition()], Array.from({ length: 4 }, (_, index) => ({ ...circumstance(), id: String(index) })), [circumstance(), circumstance()]]) {
    assert.throws(() => normalizeReviewExercises({ exercises }, content, idFor));
  }
  assert.throws(() => normalizeReviewExercises({ exercises: [circumstance(), definition()] }, content, () => 'same'));
  assert.throws(() => normalizeReviewExercises({ exercises: [circumstance()], rehearsals: [] }, content, idFor));
});

test('does not accept rehearsal contracts, generated answer policy, or invalid cue/supplement combinations', () => {
  for (const exercise of [
    { ...circumstance(), contract: { kind: 'target_rehearsal', wordId: content.word.wordId } },
    { ...circumstance(), acceptedAnswers: [] },
    { ...circumstance(), supplement: definition().supplement },
    { ...cloze(), cueType: 'definition_gloss' },
    { ...circumstance(), cueType: 'pure_review' },
    { ...definition(), supplement: { exampleId: 'missing', englishFrame: 'A note' } },
  ]) assert.throws(() => normalizeReviewExercises({ exercises: [exercise, circumstance()] }, content, idFor));
});

test('rejects source mistakes and answer leakage before publishing', () => {
  for (const change of [
    { exampleId: 'missing' }, { occurrenceIndexes: [-1] }, { occurrenceIndexes: [1] },
    { occurrenceIndexes: [0, 0] }, { frame: 'Recall 报备' },
  ]) {
    const candidate = cloze();
    assert.throws(() => normalizeReviewExercises({ exercises: [{ ...candidate, stimulus: { ...candidate.stimulus, ...change } }] }, content, idFor));
  }
  assert.throws(() => normalizeReviewExercises({ exercises: [{ ...circumstance(), stimulus: { kind: 'direct_text', text: 'Use 報備' } }] }, content, idFor));
});

test('cloze offsets use code points and can hide repeated target occurrences', () => {
  const repeated = structuredClone(content);
  repeated.examples[0]!.text = '🙂报备后，再报备。';
  const output = normalizeReviewExercises({ exercises: [{ ...cloze(), stimulus: {
    kind: 'example_cloze', exampleId: 'property', occurrenceIndexes: [0, 1], frame: null,
  } }] }, repeated, idFor)[0]!;
  assert.equal(materializeExercise(output.exercise, [repeated]).stimulus.text, '🙂____后，再____。');
});

test('review provider receives lexical content only and a bounded review schema', async () => {
  let body: Record<string, unknown> | null = null;
  const expected = { exercises: [circumstance()] };
  const provider = createWordIntroductionProvider({
    environment: { OPENAI_API_KEY: 'test-key' },
    fetchImplementation: (async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'test', model: 'model', choices: [{ message: { content: JSON.stringify(expected) }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof globalThis.fetch,
  });
  assert.deepEqual(await provider.generateReview(content), expected);
  assert.ok(body);
  const serialized = JSON.stringify(body);
  assert.match(serialized, /intro_lab_review_v1/);
  assert.match(serialized, /maxItems/);
  const messages = (body as Record<string, unknown>).messages as Array<{ role: string; content: string }>;
  assert.deepEqual(JSON.parse(messages.find((message) => message.role === 'user')!.content), content);
  assert.match(messages[0]!.content, /not automatically a fair cloze/);
});
