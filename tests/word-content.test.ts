import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  materializeExercise, materializeStimulus, materializeTeachingPackage,
  parseContentExercise, parseTeachingPackage, parseWordContent, resolveContentExerciseResponse,
  type ContentExercise, type TeachingPackage, type WordContentDocument,
} from '../src/domain/word-content/index.ts';

function content(): WordContentDocument {
  return {
    schemaVersion: 1, id: 'baobei-content-a',
    word: { wordId: 'baobei', hanzi: '报备', traditional: '報備', pinyin: 'bàobèi' },
    uses: [{ id: 'notify', label: 'keep someone informed', notes: ['A heads-up or an expectation.'], exampleIds: ['visit'] }],
    examples: [{ id: 'visit', text: '📍报备以后还要报备。', translation: 'After checking in, check in again.', pronunciation: null }],
  };
}

function rehearsal(): ContentExercise {
  return {
    id: 'repeat-word', responseMode: 'hanzi_entry',
    contract: { kind: 'target_rehearsal', wordId: 'baobei' },
    instruction: 'Use the expression just taught.',
    stimulus: {
      kind: 'example_cloze', example: { contentId: 'baobei-content-a', exampleId: 'visit' },
      blanks: [{ start: 7, end: 9, expectedText: '报备' }], frame: null,
    },
    acceptedAnswers: [{ wordId: 'baobei', hanzi: '报备', traditional: '報備' }],
  };
}

function teaching(): TeachingPackage {
  return {
    schemaVersion: 1, id: 'baobei-package-a', wordContentId: 'baobei-content-a',
    beats: [
      { id: 'scene', parts: [{ kind: 'text', text: 'You are arranging a visit.' }] },
      { id: 'sentence', parts: [{ kind: 'example', exampleId: 'visit', field: 'sentence' }] },
      { id: 'translation', parts: [{ kind: 'example', exampleId: 'visit', field: 'translation' }] },
      { id: 'note', parts: [{ kind: 'use_note', useId: 'notify', noteIndex: 0 }] },
      { id: 'ponder', parts: [{ kind: 'text', text: 'Who needs to know?' }] },
    ],
    rehearsals: [rehearsal()],
  };
}

test('cloze spans use Unicode code points and select exactly the authored occurrence', () => {
  const source = content();
  const exercise = rehearsal();
  const snapshot = materializeExercise(exercise, [source]);
  assert.equal(snapshot.stimulus.text, '📍报备以后还要____。');
  assert.equal(source.examples[0].text, '📍报备以后还要报备。');
  assert.equal(snapshot.contract.kind, 'target_rehearsal');
  assert.equal(resolveContentExerciseResponse(snapshot, ' 報 備 ').outcome, 'accepted');
  assert.equal(resolveContentExerciseResponse(snapshot, '通知').outcome, 'rejected');
  assert.equal(resolveContentExerciseResponse(snapshot, null).outcome, 'rejected');
  assert.deepEqual(Object.keys(resolveContentExerciseResponse(snapshot, '报备')).sort(), ['outcome', 'submittedWordId']);
});

test('a whole example, a constrained rehearsal, and a pure review keep distinct contracts', () => {
  const source = content();
  const introduction = materializeTeachingPackage(teaching(), [source]);
  assert.equal(introduction.beats[1].parts[0].text, source.examples[0].text);
  assert.equal(introduction.beats[4].parts[0].text, 'Who needs to know?');
  const broad: ContentExercise = {
    ...rehearsal(), id: 'shared-axis', contract: { kind: 'pure_review', axisNote: 'Notify someone of plans.' },
    instruction: '',
    acceptedAnswers: [...rehearsal().acceptedAnswers, { wordId: 'notify', hanzi: '通知', traditional: null }],
  };
  const pure = materializeExercise(broad, [source]);
  assert.equal(resolveContentExerciseResponse(pure, '通知').outcome, 'accepted');
  assert.equal(resolveContentExerciseResponse(introduction.rehearsals[0], '通知').outcome, 'rejected');
  assert.deepEqual(pure.stimulus, introduction.rehearsals[0].stimulus);
  assert.throws(() => parseTeachingPackage({ ...teaching(), rehearsals: [broad] }), /only target_rehearsal/);
});

test('framing and multiple explicit blanks are deterministic, not substring replacement', () => {
  const input = rehearsal();
  assert.equal(input.stimulus.kind, 'example_cloze');
  if (input.stimulus.kind !== 'example_cloze') throw new Error('fixture');
  const result = materializeStimulus({
    ...input.stimulus, frame: 'Repeat the taught expression in both positions.',
    blanks: [{ start: 1, end: 3, expectedText: '报备' }, ...input.stimulus.blanks],
  }, [content()]);
  assert.equal(result.text, 'Repeat the taught expression in both positions.\n📍____以后还要____。');
  const exercise = materializeExercise({
    ...input,
    instruction: 'Use the taught expression in every blank.',
    stimulus: result.source,
  }, [content()]);
  assert.equal(resolveContentExerciseResponse(exercise, '报备').outcome, 'accepted');
  assert.throws(() => parseContentExercise({
    ...input,
    contract: { kind: 'pure_review', axisNote: 'Reporting words' },
    acceptedAnswers: [...input.acceptedAnswers, { wordId: 'tell', hanzi: '告诉', traditional: null }],
    stimulus: {
      ...input.stimulus,
      blanks: [{ start: 1, end: 3, expectedText: '报备' }, { start: 7, end: 9, expectedText: '告诉' }],
    },
  }), /same word/);
});

test('JSON boundary rejects malformed structures, unsupported fields and dangling internal references', () => {
  const original = content();
  assert.deepEqual(parseWordContent(JSON.parse(JSON.stringify(original))), original);
  assert.throws(() => parseWordContent({ ...original, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => parseWordContent({ ...original, collocations: [] }), /unknown property/);
  assert.throws(() => parseWordContent({ ...original, examples: [original.examples[0], original.examples[0]] }), /duplicate/);
  assert.throws(() => parseWordContent({ ...original, uses: [{ ...original.uses[0], exampleIds: ['missing'] }] }), /unknown example/);
  assert.throws(() => parseTeachingPackage({ ...teaching(), beats: [{ id: 'empty', parts: [] }] }), /at least 1/);
  assert.throws(() => parseTeachingPackage({ ...teaching(), rehearsals: [] }), /at least 1/);
  assert.throws(() => parseContentExercise({ ...rehearsal(), instruction: '' }), /nonempty/);
  assert.throws(() => parseContentExercise({ ...rehearsal(), acceptedAnswers: [{ wordId: 'other', hanzi: '别的', traditional: null }] }), /exactly its owner/);
});

test('resolution rejects missing pins, duplicate identities, unavailable fields, and mismatched word forms', () => {
  const pkg = teaching();
  const source = content();
  assert.throws(() => materializeTeachingPackage(pkg, []), /Missing pinned/);
  assert.throws(() => materializeTeachingPackage(pkg, [source, source]), /duplicate identity/);
  assert.throws(() => materializeTeachingPackage({ ...pkg, beats: [{ id: 'unknown', parts: [{ kind: 'example', exampleId: 'missing', field: 'sentence' }] }] }, [source]), /Unknown example/);
  assert.throws(() => materializeTeachingPackage({ ...pkg, beats: [{ id: 'pinyin', parts: [{ kind: 'example', exampleId: 'visit', field: 'pronunciation' }] }] }, [source]), /No pronunciation/);
  assert.throws(() => materializeTeachingPackage({ ...pkg, beats: [{ id: 'note', parts: [{ kind: 'use_note', useId: 'notify', noteIndex: 9 }] }] }, [source]), /Unknown use note/);
  assert.throws(() => materializeTeachingPackage(pkg, [{ ...source, word: { ...source.word, traditional: null } }]), /pinned word identity/);
  assert.throws(() => materializeExercise(rehearsal(), [{
    ...source, word: { ...source.word, wordId: 'different-word' },
  }]), /pinned word identity/);
  assert.throws(() => parseTeachingPackage({ ...pkg, wordContentId: 'another-document' }), /pinned word content/);
});

test('invalid or drifted spans fail loudly instead of serving a different exercise', () => {
  const original = rehearsal();
  if (original.stimulus.kind !== 'example_cloze') throw new Error('fixture');
  const cloze = original.stimulus;
  for (const blanks of [
    [{ start: -1, end: 2, expectedText: '报备' }],
    [{ start: 1.5, end: 3, expectedText: '报备' }],
    [{ start: 1, end: 1, expectedText: '报备' }],
    [{ start: 1, end: 3, expectedText: '报备' }, { start: 2, end: 4, expectedText: '报备' }],
    [{ start: 99, end: 101, expectedText: '报备' }],
    [{ start: 0, end: 2, expectedText: '报备' }],
    [{ start: 1, end: 3, expectedText: '通知' }],
  ]) {
    assert.throws(() => materializeExercise({ ...original, stimulus: { ...cloze, blanks } }, [content()]));
  }
});

test('parsed documents and served snapshots detach, freeze, and remain pinned across replacement', () => {
  const raw = JSON.parse(JSON.stringify(content()));
  const parsed = parseWordContent(raw);
  const snapshot = materializeTeachingPackage(teaching(), [raw]);
  raw.examples[0].text = 'Changed after materialization';
  raw.word.hanzi = '通知';
  assert.equal(parsed.word.hanzi, '报备');
  assert.equal(snapshot.beats[1].parts[0].text, '📍报备以后还要报备。');
  assert.equal(snapshot.rehearsals[0].acceptedAnswers[0].hanzi, '报备');
  assert.ok(Object.isFrozen(snapshot.rehearsals[0].acceptedAnswers[0]));
  assert.ok(Object.isFrozen(parsed.examples));
  const replacement = { ...content(), id: 'baobei-content-b', examples: [{ ...content().examples[0], text: '新的报备例句。' }] };
  const next = materializeTeachingPackage(teaching(), [content(), replacement]);
  assert.deepEqual(next, snapshot);
  assert.throws(() => materializeTeachingPackage(teaching(), [replacement]), /Missing pinned/);
});

test('review matching retains the frozen study profile without adding a new matcher', () => {
  const french: ContentExercise = {
    id: 'french-text', responseMode: 'hanzi_entry', contract: { kind: 'targeted_review', wordId: 'study' },
    instruction: '', stimulus: { kind: 'direct_text', text: 'to study' },
    acceptedAnswers: [{ wordId: 'study', hanzi: 'étudier', traditional: null }],
  };
  const snapshot = materializeExercise(french, [], 'french');
  assert.equal(resolveContentExerciseResponse(snapshot, 'ETUDIER').outcome, 'accepted');
});
