import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Converter } from 'opencc-js';
import { assertSentenceCharacterPresentation } from '../src/domain/card-characters.ts';
import {
  convertClozeParts,
  convertSentenceCharacters,
  effectiveSentenceCharacterPresentation,
  formatSentenceAnswer,
  sentenceCharacterLanguage,
} from '../src/domain/sentence-characters.ts';

describe('sentence character presentation', () => {
  test('minimal dictionary presets retain upstream normalization and phrase conversion', () => {
    const fullSimplified = Converter({ from: 'tw', to: 'cn' });
    const fullTraditional = Converter({ from: 'cn', to: 'tw' });
    const samples = [
      '這份工作看似简单，其實很考验耐心。',
      '头发，发展，干燥，干净，自行车，软件。',
      '神福龍，麵包和面条，鼠标和滑鼠，服务器与伺服器。',
      '𠮷正在学习，㑇和㐷，發展與頭髮。',
    ];
    for (const sample of samples) {
      const simplified = fullSimplified(sample);
      assert.equal(convertSentenceCharacters(sample, 'simplified'), simplified);
      assert.equal(convertSentenceCharacters(sample, 'traditional'), fullTraditional(simplified));
    }
  });
  test('the main preference wins unless it requests both', () => {
    assert.equal(effectiveSentenceCharacterPresentation('simplified', 'traditional'), 'simplified');
    assert.equal(effectiveSentenceCharacterPresentation('traditional', 'simplified'), 'traditional');
    assert.equal(effectiveSentenceCharacterPresentation('both'), 'simplified');
    assert.equal(effectiveSentenceCharacterPresentation('both', 'traditional'), 'traditional');
    assert.throws(() => assertSentenceCharacterPresentation('both'));
    assert.equal(sentenceCharacterLanguage('simplified'), 'zh-Hans');
    assert.equal(sentenceCharacterLanguage('traditional'), 'zh-Hant');
  });

  test('normalizes existing traditional and mixed examples in either direction', () => {
    const source = '這份工作看似简单，其實很考验耐心。';
    assert.equal(convertSentenceCharacters(source, 'simplified'), '这份工作看似简单，其实很考验耐心。');
    assert.equal(convertSentenceCharacters(source, 'traditional'), '這份工作看似簡單，其實很考驗耐心。');
    assert.equal(convertSentenceCharacters('看似', 'traditional'), '看似');
    assert.equal(convertSentenceCharacters('English, pinyin: xuéxí, 123.', 'traditional'), 'English, pinyin: xuéxí, 123.');
  });

  test('uses phrase context and Taiwan characters without replacing vocabulary', () => {
    assert.equal(convertSentenceCharacters('头发，发展，干燥，干净，自行车，软件。', 'traditional'),
      '頭髮，發展，乾燥，乾淨，自行車，軟件。');
  });

  test('preserves explicit equivalent character comparisons in instructional prose', () => {
    const note = 'Compare 学习 / 學習 and 后/後, then read 这句话。';
    assert.equal(convertSentenceCharacters(note, 'traditional'),
      'Compare 学习 / 學習 and 后/後, then read 這句話。');
    assert.equal(convertSentenceCharacters(note, 'simplified'), note);
    assert.equal(convertSentenceCharacters('学习 / 阅读', 'traditional'), '學習 / 閱讀');
    for (const comparison of ['学习 vs 學習', '学习 versus 學習', '后→後', '后 ↔ 後',
      'Simplified 学习; Traditional 學習', 'Traditional: 學習; Simplified: 学习']) {
      assert.equal(convertSentenceCharacters(`${comparison}，然后学习。`, 'traditional'),
        `${comparison}，然後學習。`);
      assert.equal(convertSentenceCharacters(comparison, 'simplified'), comparison);
    }
  });

  test('sentence answers use stored lexical identity and convert missing traditional forms', () => {
    assert.equal(formatSentenceAnswer({ hanzi: '发', traditional: '髮' }, 'traditional'), '髮');
    assert.equal(formatSentenceAnswer({ hanzi: '学习', traditional: null }, 'traditional'), '學習');
    assert.equal(formatSentenceAnswer({ hanzi: '學習', traditional: null }, 'simplified'), '学习');
  });

  test('converts phrase context across a hidden blank and preserves the canonical revealed answer', () => {
    assert.deepEqual(convertClozeParts(['头', '很长。'], null, 'traditional', '髮'),
      { parts: ['頭', '很長。'], answer: null });
    assert.deepEqual(convertClozeParts(['他的', '型变了。'], '髮', 'traditional'),
      { parts: ['他的', '型變了。'], answer: '髮' });
    assert.deepEqual(convertClozeParts(['头', '，头', '。'], '髮', 'traditional'),
      { parts: ['頭', '，頭', '。'], answer: '髮' });
    assert.deepEqual(convertClozeParts(['𠮷正在', '，也喜欢', '中文。'], '學習', 'traditional'),
      { parts: ['𠮷正在', '，也喜歡', '中文。'], answer: '學習' });
  });
});
