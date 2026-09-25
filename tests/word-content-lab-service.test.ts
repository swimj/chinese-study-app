import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import type { IntroductionLexicalInput } from '../src/domain/word-content/lab.ts';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';
import {
  createIntroductionLabService, IntroductionLabError,
} from '../server/word-content-lab/service.ts';
import type { IntroductionLabProvider } from '../server/word-content-lab/provider.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const lexical: IntroductionLexicalInput = {
  hanzi: '报备', traditional: '報備', pinyin: 'bàobèi', guidance: 'Include a visit.',
};

function bootstrapWire() {
  return {
    uses: [{ id: 'notify', label: 'Give notice for the record', notes: [], exampleIds: ['visit'] }],
    examples: [{
      id: 'visit', text: '他报备以后又报备。',
      translation: 'After checking in, he checked in again.', pronunciation: null,
    }],
  };
}

function teachingWire() {
  return {
    beats: [
      { id: 'scene', parts: [{ kind: 'text', text: 'He is reporting a visit.' }] },
      { id: 'sentence', parts: [{ kind: 'example', exampleId: 'visit', field: 'sentence' }] },
      { id: 'translation', parts: [{ kind: 'example', exampleId: 'visit', field: 'translation' }] },
    ],
    rehearsals: [{
      id: 'repeat',
      stimulus: { kind: 'example_cloze', exampleId: 'visit', occurrenceIndexes: [0, 1], frame: null },
    }],
  };
}

function provider(overrides: Partial<IntroductionLabProvider> = {}): IntroductionLabProvider {
  return {
    model: 'test-model',
    isConfigured: () => true,
    generateBootstrap: async () => bootstrapWire(),
    generateTeaching: async () => teachingWire(),
    generateReview: async () => { throw new Error('The introduction lab does not generate review cues.'); },
    ...overrides,
  };
}

async function service(using: IntroductionLabProvider = provider()) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'intro-lab-service-'));
  dirs.push(dataDir);
  return { dataDir, lab: createIntroductionLabService({ dataDir, provider: using }) };
}

test('bootstrap and teaching save separate immutable drafts with exact occurrence selection', async () => {
  const { dataDir, lab } = await service();
  assert.deepEqual(lab.status(), { generationAvailable: true, model: 'test-model' });
  const first = await lab.bootstrap(lexical);
  assert.equal(first.origin, 'generated');
  assert.equal(first.teaching, null);
  assert.equal(first.content.word.hanzi, '报备');
  const second = await lab.generateTeaching(first.id);
  assert.notEqual(second.id, first.id);
  assert.equal(second.content.id, first.content.id);
  assert.equal(second.teaching?.wordContentId, first.content.id);
  assert.match(second.teaching!.rehearsals[0]!.instruction, /Enter only that expression/);
  assert.deepEqual(second.teaching?.rehearsals[0]?.stimulus, {
    kind: 'example_cloze', example: { contentId: first.content.id, exampleId: 'visit' },
    blanks: [{ start: 1, end: 3, expectedText: '报备' }, { start: 6, end: 8, expectedText: '报备' }], frame: null,
  });
  const archived = await lab.listDrafts();
  assert.equal(archived.length, 2);
  assert.equal(archived.find((draft) => draft.id === first.id)?.teaching, null);
  assert.deepEqual(archived.find((draft) => draft.id === second.id), second);
  const files = await readdir(path.join(dataDir, 'word-content-workbench'));
  assert.equal(files.length, 2);
  assert.ok(files.every((file) => file.endsWith('.json')));
});

test('invalid provider output or references never archive a partial generation', async () => {
  const { lab } = await service(provider({ generateBootstrap: async () => ({ uses: [], examples: [] }) }));
  await assert.rejects(lab.bootstrap(lexical), (error) => (
    error instanceof IntroductionLabError && error.status === 502
  ));
  assert.deepEqual(await lab.listDrafts(), []);

  const { lab: teachingLab } = await service(provider({
    generateTeaching: async () => ({
      ...teachingWire(),
      rehearsals: [{ id: 'bad',
        stimulus: { kind: 'example_cloze', exampleId: 'visit', occurrenceIndexes: [2], frame: null } }],
    }),
  }));
  const first = await teachingLab.bootstrap(lexical);
  await assert.rejects(teachingLab.generateTeaching(first.id), (error) => (
    error instanceof IntroductionLabError && error.status === 502
  ));
  assert.deepEqual((await teachingLab.listDrafts()).map((draft) => draft.id), [first.id]);
});

test('import validates pins and rejects conflicting immutable document identities', async () => {
  const { lab } = await service();
  const sample = wordContentFixtures[0]!;
  const first = await lab.importDraft({ content: sample.content, teaching: sample.teaching, origin: 'sample' });
  assert.equal(first.origin, 'sample');
  const exactCopy = await lab.importDraft({ content: sample.content, teaching: sample.teaching });
  assert.notEqual(exactCopy.id, first.id);
  const changedContent: WordContentDocument = {
    ...sample.content,
    examples: [{ ...sample.content.examples[0]!, translation: 'A changed translation.' }, ...sample.content.examples.slice(1)],
  };
  await assert.rejects(lab.importDraft({ content: changedContent }), (error) => (
    error instanceof IntroductionLabError && error.status === 409
  ));
  await assert.rejects(lab.importDraft({
    content: sample.content,
    teaching: { ...sample.teaching, beats: sample.teaching.beats.slice(1) },
  }), (error) => error instanceof IntroductionLabError && error.status === 409);
  await assert.rejects(lab.importDraft({
    content: sample.content,
    teaching: { ...sample.teaching, wordContentId: 'missing' },
  }), (error) => error instanceof IntroductionLabError && error.status === 400);
  assert.equal((await lab.listDrafts()).length, 2);
});

test('generation requests reject concurrency and malformed lexical input', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const { lab } = await service(provider({ generateBootstrap: async () => {
    await pending;
    return bootstrapWire();
  } }));
  await assert.rejects(lab.bootstrap({ ...lexical, extra: true }), (error) => (
    error instanceof IntroductionLabError && error.status === 400
  ));
  const first = lab.bootstrap(lexical);
  await assert.rejects(lab.bootstrap(lexical), (error) => (
    error instanceof IntroductionLabError && error.status === 409
  ));
  release();
  await first;
});

test('generated rehearsal cannot reveal its answer in instructions or unhidden occurrences', async () => {
  for (const stimulus of [
    { kind: 'direct_text', text: 'Type 報備.' },
    { kind: 'example_cloze', exampleId: 'visit', occurrenceIndexes: [1], frame: null },
  ]) {
    const { lab } = await service(provider({ generateTeaching: async () => ({
      ...teachingWire(), rehearsals: [{ id: 'leak', stimulus }],
    }) }));
    const content = await lab.bootstrap(lexical);
    await assert.rejects(lab.generateTeaching(content.id), (error) => (
      error instanceof IntroductionLabError && error.status === 502
    ));
    assert.equal((await lab.listDrafts()).length, 1);
  }
  const { lab } = await service(provider({ generateTeaching: async () => ({
    ...teachingWire(), rehearsals: [{ ...teachingWire().rehearsals[0], instruction: 'Recall 报备.' }],
  }) }));
  const content = await lab.bootstrap(lexical);
  await assert.rejects(lab.generateTeaching(content.id), (error) => (
    error instanceof IntroductionLabError && error.status === 502
  ));
});
