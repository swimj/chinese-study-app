import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { alignVocabularyPinyin, VocabularyCharacterRuby, vocabularySentenceRuby } from '../src/features/vocabulary-study/VocabularyRuby.tsx';
import { VocabularyWarmupContent } from '../src/features/vocabulary-study/VocabularyWarmup.tsx';

test('tone-marked concatenated and separated pinyin align to exact characters', () => {
  assert.deepEqual(alignVocabularyPinyin('téngjiāo', 2), ['téng', 'jiāo']);
  assert.deepEqual(alignVocabularyPinyin('Téng jiāo', 2), ['Téng', 'jiāo']);
  assert.deepEqual(alignVocabularyPinyin('xīān', 2), ['xī', 'ān']);
  assert.equal(alignVocabularyPinyin('xian', 1)?.[0], 'xian');
  assert.equal(alignVocabularyPinyin('xian', 3), null);
  assert.equal(alignVocabularyPinyin('chang an', 1), null);
  assert.equal(alignVocabularyPinyin('ABC 123', 2), null);
});
test('ruby centers each authored syllable for simplified and traditional word characters', () => {
  const render = (text: string) => renderToStaticMarkup(createElement(VocabularyCharacterRuby, { text, pinyin: 'téngjiāo' }));
  assert.match(render('藤椒'), /藤<rp>\(<\/rp><rt lang="zh-Latn">téng<\/rt>/);
  assert.match(render('藤椒'), /椒<rp>\(<\/rp><rt lang="zh-Latn">jiāo<\/rt>/);
  assert.match(renderToStaticMarkup(createElement(VocabularyCharacterRuby, { text: '學習', pinyin: 'xuéxí' })), /學<rp>\(<\/rp><rt lang="zh-Latn">xué/);
});
test('sentence ruby preserves punctuation and repeated target readings, with focusable non-target hints', () => {
  const node = vocabularySentenceRuby('你学，你学。', 'Nǐ xué, nǐ xué.', '学', 'xué');
  assert.ok(node);
  const html = renderToStaticMarkup(createElement('span', null, node));
  assert.equal((html.match(/vocab-ruby-target/g) ?? []).length, 2);
  assert.equal((html.match(/vocab-ruby-on-demand/g) ?? []).length, 2);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 2);
  assert.match(html, /，/); assert.match(html, /。/);
  assert.ok(vocabularySentenceRuby('你學。', 'nǐ xué', '學', 'xué'));
});
test('uncertain count, mixed alphabet, and inconsistent target readings refuse sentence alignment', () => {
  assert.equal(vocabularySentenceRuby('你学。', 'xué', '学', 'xué'), null);
  assert.equal(vocabularySentenceRuby('你学ABC。', 'nǐ xué', '学', 'xué'), null);
  assert.equal(vocabularySentenceRuby('你学。', 'nǐ xuè', '学', 'xué'), null);
  assert.equal(vocabularySentenceRuby('你学。', null, '学', 'xué'), null);
  // Two legal boundaries fit two characters: xi + an, xian cannot fill two.
  assert.deepEqual(alignVocabularyPinyin('xian', 2), ['xi', 'an']);
  // Both chang+an and chan+gan are valid, so no boundary is assumed.
  assert.equal(alignVocabularyPinyin('changan', 2), null);
});

test('warmup supplies full ruby only after reveal and otherwise keeps the authored Pinyin disclosure', () => {
  const render = (revealed: boolean, pronunciation: string) => renderToStaticMarkup(createElement(VocabularyWarmupContent, {
    word: { wordId: 'learn', hanzi: '学', traditional: '學', pinyin: 'xué', meaning: 'learn' },
    example: { sentence: '你学。', pronunciation, translation: 'You learn.', sense: 'Study' }, stage: revealed ? 3 : 0,
    busy: false, onPrimary: () => {}, characterPresentation: 'simplified', sentenceCharacterPresentation: 'traditional',
  }));
  assert.doesNotMatch(render(false, 'nǐ xué'), /<ruby|nǐ|xué|You learn/);
  const aligned = render(true, 'nǐ xué');
  assert.match(aligned, /vocab-ruby-on-demand/);
  assert.match(aligned, /vocab-ruby-target/);
  assert.match(aligned, /學<rp>\(<\/rp><rt lang="zh-Latn">xué/);
  assert.match(aligned, /学：Study/);
  assert.doesNotMatch(aligned, /<summary>Pinyin/);
  assert.match(render(true, 'Uncertain authored pronunciation'), /<summary>Pinyin/);
});
