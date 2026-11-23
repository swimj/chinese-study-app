import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadDictionary, lookupLocal, type LookupInput } from './local.ts';

const directory = mkdtempSync(join(tmpdir(), 'journal-lookup-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const path = join(directory, 'test.u8');
writeFileSync(path, [
  '鹿 鹿 [lu4] /deer/CL:隻|只[zhi1]/',
  '駝鹿 驼鹿 [tuo2 lu4] /moose/',
  '愛屋及烏 爱屋及乌 [ai4 wu1 ji2 wu1] /(idiom) to love everything associated with someone/',
  '研究 研究 [yan2 jiu1] /research/', '研究生 研究生 [yan2 jiu1 sheng1] /graduate student/',
  '生命 生命 [sheng1 ming4] /life/',
  '種 种 [zhong3] /seed/', '種 种 [zhong4] /to plant/',
  '米 米 [mi3] /rice/meter/', '牠 牠 [ta1] /variant of 它[ta1]/',
  '𠮷 𠮷 [ji2] /fortunate/',
].join('\n'));
const dictionary = loadDictionary(path);
const lookup = (kind: LookupInput['kind'], text: string, start: number, end: number) =>
  lookupLocal(dictionary, { kind, text, start, end });

test('taps expand using dictionary boundaries, preserving script and marked reading', () => {
  assert.deepEqual(lookup('tap', '🙂駝鹿。', 3, 4).answer, { span: '駝鹿', pinyin: 'tuó lù', gloss: 'moose' });
  assert.deepEqual(lookup('tap', '鹿！', 0, 1).answer, { span: '鹿', pinyin: 'lù', gloss: 'deer' });
});

test('context with crossing viable word boundaries needs judgment', () => {
  assert.equal(lookup('tap', '研究生命', 2, 3).reason, 'competing-boundaries');
  assert.equal(lookup('selection', '研究生命', 0, 3).reason, 'competing-boundaries');
});

test('an exact selection may be a whole idiom, while other selections retain their scope', () => {
  assert.equal(lookup('selection', '爱屋及乌。', 0, 4).answer?.span, '爱屋及乌');
  assert.equal(lookup('selection', '我爱屋及乌', 0, 5).reason, 'no-exact-entry');
  assert.equal(lookup('selection', '駝鹿', 1, 2).reason, 'selection-crosses-word-boundary');
});

test('ambiguous or unsupported definitions abstain', () => {
  assert.equal(lookup('tap', '种', 0, 1).reason, 'multiple-readings');
  assert.equal(lookup('tap', '米', 0, 1).reason, 'multiple-or-missing-glosses');
  assert.equal(lookup('tap', '牠', 0, 1).reason, 'dictionary-reference-or-bound-form');
  assert.equal(lookup('tap', '山', 0, 1).reason, 'no-dictionary-entry');
  assert.equal(lookup('tap', '。', 0, 1).reason, 'non-han-tap');
});

test('UTF-16 targets can cover an astral Han character but cannot split it', () => {
  assert.equal(lookup('tap', '🙂𠮷。', 2, 4).answer?.span, '𠮷');
  assert.throws(() => lookup('tap', '🙂𠮷。', 2, 3), RangeError);
  assert.throws(() => lookup('tap', '駝鹿', 0, 2), RangeError);
});
