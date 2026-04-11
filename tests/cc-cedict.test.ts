import test from 'node:test';
import assert from 'node:assert/strict';
import {
  numberedPinyinToToneMarked,
  parseCedictFile,
} from '../scripts/lib/cc-cedict.ts';

test('numberedPinyinToToneMarked converts common syllables', () => {
  assert.equal(numberedPinyinToToneMarked('a1'), 'ā');
  assert.equal(numberedPinyinToToneMarked('ai2'), 'ái');
  assert.equal(numberedPinyinToToneMarked('shui3'), 'shuǐ');
  assert.equal(numberedPinyinToToneMarked('lü4'), 'lǜ');
  assert.equal(numberedPinyinToToneMarked('nu:3 peng2 you5'), 'nǚ péng you');
});

test('parseCedictFile parses core entry fields', () => {
  const contents = `
# comment
傳統 传统 [chuan2 tong3] /tradition/conventional/
女兒 女儿 [nu:3 er2] /daughter/
`;

  const entries = parseCedictFile(contents);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    traditional: '傳統',
    simplified: '传统',
    numberedPinyin: 'chuan2 tong3',
    toneMarkedPinyin: 'chuán tǒng',
    glosses: ['tradition', 'conventional'],
    sourceKey: '传统\tchuan2 tong3',
  });
  assert.deepEqual(entries[1], {
    traditional: '女兒',
    simplified: '女儿',
    numberedPinyin: 'nu:3 er2',
    toneMarkedPinyin: 'nǚ ér',
    glosses: ['daughter'],
    sourceKey: '女儿\tnu:3 er2',
  });
});
