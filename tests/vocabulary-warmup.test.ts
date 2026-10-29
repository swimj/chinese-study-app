import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { vocabularyWarmupExample, nextVocabularyWarmupStage, VocabularyWarmupContent, type VocabularyWarmupStage } from '../src/features/vocabulary-study/VocabularyWarmup.tsx';
import { VocabularyIntroduction } from '../src/features/vocabulary-study/VocabularyIntroduction.tsx';
import { wordContentFixtures } from './fixtures/word-content.ts';
import type { VocabularySessionJson } from '../src/domain/vocabulary-session.ts';

const fixture = wordContentFixtures[0]!;
const source = JSON.parse(JSON.stringify(fixture.content)) as VocabularySessionJson;
const word = { ...fixture.content.word, meaning: 'A familiar meaning.' };
const example = vocabularyWarmupExample(undefined, word.wordId, source)!;
test('warmup selects one linked authored source example and rejects another word source', () => {
  const id = fixture.content.uses[0]!.exampleIds[0]!;
  const original = fixture.content.examples.find((entry) => entry.id === id)!;
  assert.equal(example.sentence, original.text);
  assert.equal(example.translation, original.translation);
  assert.equal(example.pronunciation, original.pronunciation);
  assert.throws(() => vocabularyWarmupExample(undefined, 'another-word', source), /belongs to another word/);
});

test('independent authored material uses only actual example fields with matching identities', () => {
  assert.deepEqual(vocabularyWarmupExample({ beats: [{ parts: [
    { text: 'Ordinary teaching prose.', source: { kind: 'text' } },
    { text: '这是一个例子。', source: { kind: 'example', exampleId: 'one', field: 'sentence' } },
    { text: 'Another example translation.', source: { kind: 'example', exampleId: 'two', field: 'translation' } },
    { text: 'This is an example.', source: { kind: 'example', exampleId: 'one', field: 'translation' } },
  ] }] }, word.wordId), { sentence: '这是一个例子。', translation: 'This is an example.', pronunciation: null });
  assert.equal(vocabularyWarmupExample({ beats: [{ text: 'A teaching explanation.' }] }, word.wordId), null);
});

test('an explicitly named example text beat separates its authored Chinese sentence and translation', () => {
  const text = '园艺中心出售各种适合室内种植的花卉。\nThe garden center sells various flowering plants suitable for growing indoors.';
  assert.deepEqual(vocabularyWarmupExample({ beats: [{ id: 'example', text }] }, 'flower'), {
    sentence: '园艺中心出售各种适合室内种植的花卉。', pronunciation: null,
    translation: 'The garden center sells various flowering plants suitable for growing indoors.',
  });
  assert.equal(vocabularyWarmupExample({ beats: [{ id: 'explanation', text }] }, 'flower'), null);
  assert.equal(vocabularyWarmupExample({ beats: [{ id: 'example', text: 'Some teaching prose.\nMore teaching prose.' }] }, 'flower'), null);
});

function render(stage: VocabularyWarmupStage) {
  return renderToStaticMarkup(createElement(VocabularyWarmupContent, { example, word, stage, busy: false,
    onPrimary: () => {}, characterPresentation: 'simplified', sentenceCharacterPresentation: 'simplified' }));
}
test('warmup requires Reveal before exposing pronunciation, meaning, translation, and Continue', () => {
  const initial = render(0);
  assert.match(initial, /Familiar warmup/);
  assert.doesNotMatch(initial, /Read this familiar example|Bring this familiar word to mind/);
  assert.match(initial, />Reveal/);
  assert.match(initial, /class="vocab-card-content" tabindex="0" role="region" aria-label="Warmup example and meaning"/);
  assert.match(initial, /class="vocab-response"><div class="vocab-main-actions"/);
  assert.doesNotMatch(initial, /A familiar meaning\.|Warmup meaning|>Continue|Correct|Forgot|Word reference|<details/);
  assert.ok(!initial.includes(word.pinyin));
  if (example.translation) assert.ok(!initial.includes(example.translation));
  const revealed = render(3);
  assert.match(revealed, /Warmup meaning/);
  assert.ok(revealed.includes(example.sense ?? word.meaning));
  assert.match(revealed, />Continue/);
  assert.doesNotMatch(revealed, /Correct|Forgot/);
  assert.match(revealed, /aria-keyshortcuts="Space Enter"/);
});

test('warmup branch does not require a teaching walkthrough or expose lexical fallback before Reveal', () => {
  const html = renderToStaticMarkup(createElement(VocabularyIntroduction, { material: { beats: [] }, teachingSource: source,
    word, onContinue: () => {}, busy: false, warmup: true, characterPresentation: 'simplified', sentenceCharacterPresentation: 'simplified' }));
  assert.match(html, />Reveal/); assert.doesNotMatch(html, /Word introduction|Word reference|A familiar meaning\./);
  const fallback = renderToStaticMarkup(createElement(VocabularyWarmupContent, { example: null, word, stage: 0, busy: true,
    onPrimary: () => {}, characterPresentation: 'simplified', sentenceCharacterPresentation: 'simplified' }));
  assert.doesNotMatch(fallback, /Bring this familiar word to mind|Read this familiar example|A familiar meaning\./);
  assert.match(fallback, /disabled=""/);
});


test('revealed warmup annotates exact targets and orders translation, optional pinyin, then the linked sense', () => {
  const sample = { sentence: '忙了一整天，我已经疲惫不堪了。', translation: 'I am utterly exhausted.', pronunciation: 'Máng le yì zhěng tiān.', sense: 'Intensifies an unbearable state' };
  const targetWord = { wordId: 'bukan', hanzi: '不堪', traditional: '不堪', pinyin: 'bùkān', meaning: 'Other meanings' };
  const html = renderToStaticMarkup(createElement(VocabularyWarmupContent, { example: sample, word: targetWord, stage: 3 as const, busy: false,
    onPrimary: () => {}, characterPresentation: 'simplified', sentenceCharacterPresentation: 'simplified' }));
  assert.match(html, /不<rp>\(<\/rp><rt lang="zh-Latn">bù<\/rt>/);
  assert.match(html, /堪<rp>\(<\/rp><rt lang="zh-Latn">kān<\/rt>/);
  assert.match(html, /不堪：Intensifies an unbearable state/);
  assert.ok(html.indexOf(sample.translation) < html.indexOf('<summary>Pinyin</summary>'));
  assert.ok(html.indexOf(sample.pronunciation) < html.indexOf(sample.sense));
  assert.doesNotMatch(html, /Other meanings|<details[^>]*open/);
  const hidden = renderToStaticMarkup(createElement(VocabularyWarmupContent, { example: sample, word: targetWord, stage: 0, busy: false,
    onPrimary: () => {}, characterPresentation: 'simplified', sentenceCharacterPresentation: 'simplified' }));
  assert.doesNotMatch(hidden, /<ruby|<strong|bùkān|I am utterly exhausted|Intensifies an unbearable state/);
});

test('ruby uses the sentence script and safely falls back when the target is absent', () => {
  const targetWord = { wordId: 'plan', hanzi: '计划', traditional: '計劃', pinyin: 'jìhuà', meaning: 'plan' };
  const props = { word: targetWord, stage: 3 as const, busy: false, onPrimary: () => {}, characterPresentation: 'simplified' as const, sentenceCharacterPresentation: 'traditional' as const };
  const html = renderToStaticMarkup(createElement(VocabularyWarmupContent, { ...props, example: { sentence: '计划改变了，计划很好。', pronunciation: null, translation: null } }));
  assert.equal((html.match(/<ruby class="vocab-character-ruby">/g) ?? []).length, 4);
  assert.match(html, /計<rp>\(<\/rp><rt lang="zh-Latn">jì/);
  assert.match(html, /劃<rp>\(<\/rp><rt lang="zh-Latn">huà/);
  const missing = renderToStaticMarkup(createElement(VocabularyWarmupContent, { ...props, example: { sentence: '今天很好。', pronunciation: null, translation: null } }));
  assert.doesNotMatch(missing, /<ruby|is-revealed/);
  assert.match(missing, /jìhuà/);
});


test('warmup reveals contrast, translation, and sense cumulatively before Continue', () => {
  let stage: VocabularyWarmupStage = 0;
  stage = nextVocabularyWarmupStage(stage, example);
  assert.equal(stage, 1);
  const contrast = render(stage);
  assert.match(contrast, /is-revealed/);
  assert.match(contrast, /<ruby/);
  assert.ok(!contrast.includes(example.translation!));
  assert.ok(!contrast.includes(example.sense ?? word.meaning));
  assert.match(contrast, />Reveal/);
  stage = nextVocabularyWarmupStage(stage, example);
  assert.equal(stage, 2);
  const translation = render(stage);
  assert.ok(translation.includes(example.translation!));
  assert.ok(!translation.includes(example.sense ?? word.meaning));
  assert.match(translation, />Reveal/);
  stage = nextVocabularyWarmupStage(stage, example);
  assert.equal(stage, 3);
  assert.match(render(stage), />Continue/);
  assert.ok(render(stage).includes(example.sense ?? word.meaning));
});

test('missing translation skips its beat, including a word-only reminder', () => {
  for (const sparse of [null, { ...example, translation: null }, { ...example, translation: '  ' }]) {
    assert.equal(nextVocabularyWarmupStage(0, sparse), 1);
    assert.equal(nextVocabularyWarmupStage(1, sparse), 3);
  }
});
