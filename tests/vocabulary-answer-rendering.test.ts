import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VocabularyEncounterSnapshot } from '../src/domain/vocabulary-session.ts';
import type { VocabularyStudyWord } from '../src/domain/vocabulary-study-api.ts';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';
import { VocabularyAnswer, VocabularyContrastAnswer, VocabularyRecognitionPrompt } from '../src/features/vocabulary-study/VocabularyAnswer.tsx';
import { renderVocabularyReveal, vocabularyMaterialInstruction } from '../src/features/vocabulary-study/render-material.tsx';
import { ProductionSupplementAside } from '../src/features/session/ProductionSupplementAside.tsx';

const word: VocabularyStudyWord = { wordId: 'crave',hanzi: '馋',traditional: '饞',pinyin: 'chán',meaning: 'gluttonous' };
function snapshot(body: Partial<VocabularyEncounterSnapshot['body']> = {}): VocabularyEncounterSnapshot {
  return { contentId: 'served',contentVersion: 1,kind: 'production',role: 'general',
    body: { prompt: 'Recall a word',...body },assessment: { acceptedAnswers: ['馋'] } };
}
function answer(served: VocabularyEncounterSnapshot, fallbackWord?: VocabularyStudyWord) {
  return renderToStaticMarkup(createElement(VocabularyAnswer,{ snapshot: served,word: fallbackWord,
    characterPresentation: 'simplified',sentenceCharacterPresentation: 'simplified' }));
}
test('mapped sense is the revealed meaning, while unmapped and older encounters retain lexical fallback', () => {
  const mapped = answer(snapshot({ revealWords: [{ ...word,sense: { senseId: 'food',version: 2,
    description: { label: 'To crave tasty food',notes: ['Retained source notes'],source: { privateId: 'private-source' } } } }] }));
  assert.match(mapped,/馋/); assert.match(mapped,/chán/); assert.match(mapped,/To crave tasty food/);
  assert.doesNotMatch(mapped,/gluttonous|private-source|senseId/);
  assert.match(answer(snapshot({ revealWords: [word] })),/gluttonous/);
  assert.match(answer(snapshot(),word),/gluttonous/);
  const stringSense = answer(snapshot({ revealWords: [{ ...word,sense: { senseId: 'food',version: 1,description: 'Want tasty food' } }] }));
  assert.match(stringSense,/Want tasty food/); assert.doesNotMatch(stringSense,/gluttonous/);
});
test('every accepted answer word retains its own pronunciation and mapped meaning or dictionary fallback', () => {
  const html = answer(snapshot({ revealWords: [
    { ...word,sense: { senseId: 'food',version: 1,description: { label: 'Crave delicious food' } } },
    { wordId: 'greedy',hanzi: '贪吃',traditional: '貪吃',pinyin: 'tān chī',meaning: 'Eat greedily' },
  ] }));
  for (const text of ['馋','chán','Crave delicious food','贪吃','tān chī','Eat greedily']) assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/gluttonous/);
});
test('recognition uses the frozen bootstrap and exposes the full source through a reference disclosure', () => {
  const reference: WordContentDocument = { schemaVersion: 1,id: 'bootstrap',word: { wordId: 'crave',hanzi: '馋',traditional: '饞',pinyin: 'chán' },
    uses: [{ id: 'food',label: 'Want something delicious',notes: [],exampleIds: ['food-example'] },
      { id: 'temptation',label: 'Food tempts the appetite',notes: [],exampleIds: ['temptation-example'] }],
    examples: [{ id: 'food-example',text: '我有点馋。',translation: 'I crave something tasty.',pronunciation: null },
      { id: 'temptation-example',text: '看得我都馋了。',translation: 'It makes my mouth water.',pronunciation: null }] };
  const served = snapshot({ revealWords: [word],wordReference: reference,bootstrapReveal: {
    contentId: 'bootstrap',useId: 'food',exampleId: 'food-example',englishFrame: 'Want something delicious',
    exampleSentence: '我有点馋。',exampleTranslation: 'I crave something tasty.',
  } });
  served.kind = 'recognition';
  const html = answer(served);
  assert.doesNotMatch(html,/chán|gluttonous|vocab-answer-hanzi|vocab-answer-word/);
  assert.match(html,/production-supplement-frame/); assert.match(html,/我有点馋。/); assert.match(html,/I crave something tasty/);
  assert.match(html,/<details[^>]*><summary>Word reference<\/summary>/);
  assert.match(html,/Food tempts the appetite/); assert.match(html,/It makes my mouth water/);
  assert.doesNotMatch(html,/useId|exampleId|schemaVersion/);
});
test('contrast reveal compares the selected and expected choices with authored explanations', () => {
  const html = renderToStaticMarkup(createElement(VocabularyContrastAnswer,{
    material: { choices: [{ wordId: 'a',hanzi: '鼓舞',explanation: 'An increase in morale.' },
      { wordId: 'b',hanzi: '鼓励',explanation: 'Encouragement to act.' }],source: { note: 'Compare the object and intended effect.',privateId: 'not-a-lesson' } },
    selectedWordId: 'b',correctWordId: 'a',sentenceCharacterPresentation: 'simplified',
  }));
  assert.match(html,/is-correct-choice[^>]*><strong[^>]*>鼓舞/);
  assert.match(html,/Expected answer/); assert.match(html,/is-selected-choice[^>]*><strong[^>]*>鼓励/);
  assert.match(html,/Your choice/); assert.match(html,/An increase in morale/); assert.match(html,/Encouragement to act/);
  assert.match(html,/Compare the object and intended effect/); assert.doesNotMatch(html,/not-a-lesson/);
});
test('instruction filtering preserves authored context while removing known input mechanics', () => {
  for (const generic of ['Give the Mandarin word.','Fill the gap with the Mandarin expression.',
    'Fill it into the sentence in Chinese characters.','Fill it in with Chinese characters.','Write in Chinese characters.']) {
    assert.equal(vocabularyMaterialInstruction({ instruction: generic }), '');
    assert.equal(vocabularyMaterialInstruction({ instruction: `Keep a formal tone. ${generic}` }), 'Keep a formal tone.');
  }
  assert.equal(vocabularyMaterialInstruction({ instruction: 'Use the expression just taught.' }),'Use the expression just taught.');
});
test('reveal keeps authored lessons and explanations while excluding semantic axes and source metadata', () => {
  const html = renderToStaticMarkup(createElement('div',{},renderVocabularyReveal({
    axisNote: 'Top-level semantic membership',explanation: 'A useful explanation.',source: { note: 'Private source note' },
    reveal: { axisNote: 'Internal semantic axis',teachingNote: 'Describe appetite rather than hunger.',
      exampleTranslation: 'I crave something tasty.',explanation: 'A useful explanation.' },
  })));
  assert.match(html,/Usage note/); assert.match(html,/Describe appetite rather than hunger/); assert.match(html,/I crave something tasty/);
  assert.equal(html.split('A useful explanation.').length - 1,1);
  assert.doesNotMatch(html,/Top-level semantic membership|Internal semantic axis|Private source note/);
  assert.doesNotMatch(html,/production-supplement-frame|production-supplement-sentence|「」/);
});
test('partial supplements omit empty paragraphs and empty sentence quotation marks', () => {
  const html = renderToStaticMarkup(createElement(ProductionSupplementAside,{
    supplement: { englishFrame: '  ',exampleSentence: '',exampleTranslation: 'A retained translation.' },sentenceCharacterPresentation: 'simplified',
  }));
  assert.match(html,/A retained translation/);
  assert.doesNotMatch(html,/production-supplement-frame|production-supplement-sentence|「|」|<p[^>]*>\s*<\/p>/);
});


test('recognition moves frozen pronunciation above the prompt only after Reveal', () => {
  const served = { ...snapshot({ prompt: '馋', revealWords: [word] }), kind: 'recognition' as const };
  const props = { snapshot: served, word: { ...word, pinyin: 'edited pronunciation' }, sentenceCharacterPresentation: 'traditional' as const };
  const before = renderToStaticMarkup(createElement(VocabularyRecognitionPrompt, { ...props, revealed: false }));
  assert.match(before, /class="vocab-recognition-ruby"/);
  assert.match(before, /<ruby[^>]*>饞<\/ruby>/);
  assert.doesNotMatch(before, /<rt|chán|edited pronunciation/);
  const after = renderToStaticMarkup(createElement(VocabularyRecognitionPrompt, { ...props, revealed: true }));
  assert.match(after, /<ruby[^>]*>饞/); assert.match(after, /<rt lang="zh-Latn">chán<\/rt>/);
  assert.doesNotMatch(after, /edited pronunciation/);
  const meaning = answer(served);
  assert.match(meaning, /gluttonous/); assert.doesNotMatch(meaning, /chán/);
  const legacy = renderToStaticMarkup(createElement(VocabularyRecognitionPrompt, { ...props,
    snapshot: { ...served, body: { prompt: '馋' } }, word, revealed: true }));
  assert.match(legacy, /chán/);
});

test('recognition preserves character wrappers across reveal, including unaligned pronunciation', () => {
  for (const [prompt, pinyin] of [['部署', 'bùshǔ'], ['部署', 'an uncertain reading']]) {
    const served = { ...snapshot({ prompt, revealWords: [{ ...word, pinyin }] }), kind: 'recognition' as const };
    const render = (revealed: boolean) => renderToStaticMarkup(createElement(VocabularyRecognitionPrompt, {
      snapshot: served, word, revealed, sentenceCharacterPresentation: 'simplified',
    }));
    const before = render(false), after = render(true);
    assert.equal(after.replace(/<rp>.*?<\/rp>|<rt[^>]*>.*?<\/rt>/g, ''), before);
    assert.doesNotMatch(before, /<rt|bù|shǔ|uncertain/);
  }
});

test('cloze reveal ignores unrelated bootstrap examples in already served snapshots', () => {
  const served = snapshot({ prompt: 'Seeing the cake: 我有点____。', revealWords: [word], bootstrapReveal: {
    contentId: 'source', useId: 'other', exampleId: 'other-example', englishFrame: 'Another use',
    exampleSentence: '看得我都馋了。', exampleTranslation: 'It makes my mouth water.',
  } });
  const html = answer(served);
  assert.match(html, /馋/); assert.match(html, /chán/); assert.match(html, /gluttonous/);
  assert.doesNotMatch(html, /Another use|看得我都馋了|mouth water/);
  served.body.revealWords = [{ ...word, sense: { senseId: 'food', version: 1, description: 'Crave tasty food' } }];
  const mapped = answer(served);
  assert.match(mapped, /Crave tasty food/); assert.doesNotMatch(mapped, /gluttonous|mouth water/);
});

test('cloze supplements retain only translations of the completed cue plus authored explanations', () => {
  const served = snapshot({ prompt: 'Seeing the cake:\n我有点（ ）。', revealWords: [word], material: {
    reveal: { englishFrame: 'Unmapped source frame', exampleSentence: '我有点馋。', exampleTranslation: 'I crave something tasty.',
      teachingNote: 'This expresses appetite.', explanation: 'A little desire for food.' },
  } });
  const html = answer(served);
  assert.match(html, /I crave something tasty/); assert.match(html, /This expresses appetite/); assert.match(html, /A little desire for food/);
  assert.doesNotMatch(html, /Unmapped source frame|我有点馋|production-supplement-sentence/);
  served.body.material = { reveal: { exampleSentence: '看得我都馋了。', exampleTranslation: 'It makes my mouth water.' } };
  assert.doesNotMatch(answer(served), /看得我都馋了|mouth water/);
});

test('definition production still uses its frozen bootstrap example', () => {
  const html = answer(snapshot({ revealWords: [word], bootstrapReveal: {
    contentId: 'source', useId: 'food', exampleId: 'example', englishFrame: 'A craving',
    exampleSentence: '我有点馋。', exampleTranslation: 'I crave something tasty.',
  } }));
  assert.match(html, /A craving/); assert.match(html, /我有点馋/); assert.doesNotMatch(html, /gluttonous/);
});
