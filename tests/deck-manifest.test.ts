import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignHskLevels,
  buildDeckAssignments,
  EXPECTED_HSK20_DELTA_COUNTS,
  EXPECTED_HSK30_DELTA_COUNTS,
  guardSourceCounts,
  HSK20_EXCLUDED_READINGS,
  manifestWordKey,
  parseHsk20LevelJson,
  parseHsk30SyllabusTsv,
  parseSubtlexWf,
  readingComparisonKey,
  strippedReadingComparisonKey,
  TAIL_DECK_ID,
} from '../scripts/lib/hsk-decks.ts';

test('parseHsk20LevelJson excludes obscure dictionary readings but keeps useful alternates', () => {
  const contents = JSON.stringify([
    { simplified: '啊', forms: [
      { transcriptions: { pinyin: 'ā' } },
      { transcriptions: { pinyin: 'á' } },
      { transcriptions: { pinyin: 'ǎ' } },
      { transcriptions: { pinyin: 'à' } },
      { transcriptions: { pinyin: 'a' } },
    ] },
    { simplified: '看', forms: [
      { transcriptions: { pinyin: 'kān' } },
      { transcriptions: { pinyin: 'kàn' } },
    ] },
    { simplified: '的', forms: [
      { transcriptions: { pinyin: 'de' } },
      { transcriptions: { pinyin: 'dī' } },
      { transcriptions: { pinyin: 'dí' } },
      { transcriptions: { pinyin: 'dì' } },
    ] },
    { simplified: '八', forms: [{ transcriptions: { pinyin: 'bā' } }] },
  ]);
  assert.deepEqual(parseHsk20LevelJson(contents, 1), [
    { hanzi: '啊', pinyin: 'a', level: 1 },
    { hanzi: '看', pinyin: 'kān', level: 1 },
    { hanzi: '看', pinyin: 'kàn', level: 1 },
    { hanzi: '的', pinyin: 'de', level: 1 },
    { hanzi: '八', pinyin: 'bā', level: 1 },
  ]);
});

test('the curated HSK 2.0 exclusion policy is explicit and comparison-normalized', () => {
  assert.equal(HSK20_EXCLUDED_READINGS['的|dī'], 'taxi abbreviation; not useful as a standalone beginner word');
  assert.equal(HSK20_EXCLUDED_READINGS['啊|ā'], 'tone-specific interjection is poor standalone study intake');
  assert.equal(HSK20_EXCLUDED_READINGS['看|kān'], undefined);
});

test('parseHsk20LevelJson tolerates missing pinyin and rejects bad payloads', () => {
  const contents = JSON.stringify([{ simplified: '吧', forms: [] }]);
  assert.deepEqual(parseHsk20LevelJson(contents, 2), [{ hanzi: '吧', pinyin: null, level: 2 }]);
  assert.throws(() => parseHsk20LevelJson('{}', 1), /array/);
  assert.throws(() => parseHsk20LevelJson('[{"forms":[]}]', 1), /simplified/);
});

test('parseHsk30SyllabusTsv strips disambiguation digits and maps the 7-9 band', () => {
  const tsv = [
    'word_index\tlevel\tword\tpinyin\tpart_of_speech',
    '33\t1\t点1\tdiǎn\t量',
    '336\t2\t点2\tdiǎn\t动',
    '5000\t7-9\t饕餮\ttāotiè\t名',
  ].join('\n');
  assert.deepEqual(parseHsk30SyllabusTsv(tsv), [
    { hanzi: '点', pinyin: 'diǎn', level: 1 },
    { hanzi: '点', pinyin: 'diǎn', level: 2 },
    { hanzi: '饕餮', pinyin: 'tāotiè', level: 7 },
  ]);
});

test('parseHsk30SyllabusTsv fails loudly on malformed rows', () => {
  assert.throws(() => parseHsk30SyllabusTsv('1\tx\t爱\tài'), /invalid level/);
  assert.throws(() => parseHsk30SyllabusTsv('1\t1'), /columns/);
});

test('parseSubtlexWf reads the flat frequency TSV and skips metadata', () => {
  const tsv = [
    '"Total word count: 33,546,516"',
    '"Context number: 6,243"',
    'Word\tWCount\tW/million',
    '的\t1682530\t50155.13',
    '我\t1682285\t50147.83',
  ].join('\n');
  const counts = parseSubtlexWf(tsv);
  assert.equal(counts.get('的'), 1682530);
  assert.equal(counts.get('我'), 1682285);
  assert.equal(counts.size, 2);
});

test('reading comparison keys normalize spacing, case, and apostrophes', () => {
  assert.equal(readingComparisonKey('bàba'), readingComparisonKey('Bà  ba'));
  assert.equal(readingComparisonKey("xī'ān"), readingComparisonKey('xī ān'));
  assert.equal(readingComparisonKey('nǚ’ér'), readingComparisonKey('nǚ ér'));
  assert.equal(readingComparisonKey('hóng-lǜdēng'), readingComparisonKey('hóng lǜ dēng'));
  assert.equal(readingComparisonKey('lu:è'), readingComparisonKey('lüè'));
  assert.notEqual(readingComparisonKey('bā'), readingComparisonKey('ba'));
  assert.equal(strippedReadingComparisonKey('bā'), strippedReadingComparisonKey('ba'));
});

test('guardSourceCounts warns within tolerance and throws on gross mismatch', () => {
  const warnings = guardSourceCounts([150, 147, 298, 598, 1298, 2499], EXPECTED_HSK20_DELTA_COUNTS, 'HSK 2.0', 10);
  assert.equal(warnings.length, 5);
  // The 2021 HSK 3.0 draft had 500 level-1 words; the final syllabus has 300.
  assert.throws(
    () => guardSourceCounts([500, 200, 500, 1000, 1600, 1800], EXPECTED_HSK30_DELTA_COUNTS, 'HSK 3.0', 40),
    /refusing to build/,
  );
});

test('assignHskLevels probes from HSK readings and does not fan out by hanzi', () => {
  const canonicalWords = [
    { hanzi: '吧', pinyinNormalized: 'ba' }, // neutral-tone particle
    { hanzi: '吧', pinyinNormalized: 'bā' }, // "bar" reading
    { hanzi: '爱', pinyinNormalized: 'ài' },
    { hanzi: '猫', pinyinNormalized: 'māo' },
  ];
  const hskEntries = [{ hanzi: '吧', pinyin: 'bā', level: 1 }, { hanzi: '爱', pinyin: 'ài', level: 1 }];
  const { joins, stats } = assignHskLevels(canonicalWords, hskEntries);

  assert.deepEqual(joins.get(manifestWordKey('爱', 'ài')), { level: 1, matchKind: 'exact', ambiguous: false });
  assert.deepEqual(joins.get(manifestWordKey('吧', 'bā')), { level: 1, matchKind: 'exact', ambiguous: false });
  assert.equal(joins.has(manifestWordKey('吧', 'ba')), false);
  assert.equal(joins.has(manifestWordKey('猫', 'māo')), false);
  assert.deepEqual(stats.hskHanziWithoutCanonicalWord, []);
  assert.deepEqual(stats.ambiguousJoins, []);
});

test('assignHskLevels reports a source reading that has no canonical match', () => {
  const canonicalWords = [
    { hanzi: '吧', pinyinNormalized: 'ba' },
    { hanzi: '吧', pinyinNormalized: 'bā' },
  ];
  const { joins, stats } = assignHskLevels(canonicalWords, [{ hanzi: '吧', pinyin: 'bǎ', level: 1 }]);
  assert.equal(joins.size, 0);
  assert.deepEqual(stats.unmatchedJoins, []);
  assert.deepEqual(stats.ambiguousJoins, [manifestWordKey('吧', 'bǎ')]);
});

test('assignHskLevels reports pinyin-less probes as ambiguous only across multiple corpus readings', () => {
  const canonicalWords = [
    { hanzi: '吧', pinyinNormalized: 'ba' },
    { hanzi: '吧', pinyinNormalized: 'bā' },
  ];
  const { joins, stats } = assignHskLevels(canonicalWords, [{ hanzi: '吧', pinyin: null, level: 1 }]);
  assert.equal(joins.size, 0);
  assert.deepEqual(stats.ambiguousJoins, [manifestWordKey('吧', '')]);
});

test('assignHskLevels resolves tone-convention differences for single-reading words', () => {
  const canonicalWords = [{ hanzi: '嘛', pinyinNormalized: 'ma' }];
  const hskEntries = [{ hanzi: '嘛', pinyin: 'má', level: 3 }];
  const { joins, stats } = assignHskLevels(canonicalWords, hskEntries);
  assert.deepEqual(joins.get(manifestWordKey('嘛', 'ma')), { level: 3, matchKind: 'tone-stripped', ambiguous: false });
  assert.equal(stats.toneStrippedMatches, 1);
});

test('assignHskLevels takes the earliest level when a word appears at several', () => {
  const canonicalWords = [{ hanzi: '点', pinyinNormalized: 'diǎn' }];
  const hskEntries = [
    { hanzi: '点', pinyin: 'diǎn', level: 3 },
    { hanzi: '点', pinyin: 'diǎn', level: 1 },
  ];
  const { joins } = assignHskLevels(canonicalWords, hskEntries);
  assert.equal(joins.get(manifestWordKey('点', 'diǎn'))?.level, 1);
});

test('assignHskLevels expands slash-separated source readings into independent probes', () => {
  const canonicalWords = [
    { hanzi: '谁', pinyinNormalized: 'shéi' },
    { hanzi: '谁', pinyinNormalized: 'shuí' },
  ];
  const { joins, stats } = assignHskLevels(canonicalWords, [{ hanzi: '谁', pinyin: 'shéi/shuí', level: 2 }]);
  assert.equal(joins.get(manifestWordKey('谁', 'shéi'))?.matchKind, 'exact');
  assert.equal(joins.get(manifestWordKey('谁', 'shuí'))?.matchKind, 'exact');
  assert.equal(stats.exactMatches, 2);
});

test('buildDeckAssignments keeps small deltas whole and orders by frequency', () => {
  const frequency = new Map([
    ['我', 1000],
    ['你', 900],
    ['猫', 10],
  ]);
  const words = [
    { wordKey: manifestWordKey('猫', 'māo'), hanzi: '猫', hsk20Level: 1 },
    { wordKey: manifestWordKey('我', 'wǒ'), hanzi: '我', hsk20Level: 1 },
    { wordKey: manifestWordKey('你', 'nǐ'), hanzi: '你', hsk20Level: 1 },
    { wordKey: manifestWordKey('狗', 'gǒu'), hanzi: '狗', hsk20Level: null },
  ];
  const { decks, assignments, deckMembers } = buildDeckAssignments(words, frequency);
  assert.deepEqual(decks, [
    { id: 'hsk2-l1', order: 0, hsk: { version: '2.0', level: 1 }, stratum: null, size: 3 },
    { id: TAIL_DECK_ID, order: 1, hsk: null, stratum: null, size: 0 },
  ]);
  assert.equal(assignments[manifestWordKey('我', 'wǒ')], 'hsk2-l1');
  assert.equal(assignments[manifestWordKey('狗', 'gǒu')], undefined);
  // Frequency order is preserved in the member list.
  assert.deepEqual(deckMembers['hsk2-l1'], [
    manifestWordKey('我', 'wǒ'),
    manifestWordKey('你', 'nǐ'),
    manifestWordKey('猫', 'māo'),
  ]);
});

test('buildDeckAssignments subdivides large deltas into frequency-ordered strata', () => {
  const frequency = new Map<string, number>();
  const words = Array.from({ length: 500 }, (_, index) => {
    const hanzi = `字${String(index).padStart(3, '0')}`;
    frequency.set(hanzi, 500 - index);
    return { wordKey: manifestWordKey(hanzi, 'zì'), hanzi, hsk20Level: 4 };
  });
  const { decks, assignments, deckMembers } = buildDeckAssignments(words, frequency);

  assert.equal(decks.length, 3); // two strata + tail
  assert.equal(decks[0]?.id, 'hsk2-l4-s1');
  assert.equal(decks[1]?.id, 'hsk2-l4-s2');
  assert.equal((decks[0]?.size ?? 0) + (decks[1]?.size ?? 0), 500);
  // Most frequent words land in the first stratum.
  assert.equal(assignments[manifestWordKey('字000', 'zì')], 'hsk2-l4-s1');
  assert.equal(assignments[manifestWordKey('字499', 'zì')], 'hsk2-l4-s2');
  assert.equal(deckMembers['hsk2-l4-s1']?.[0], manifestWordKey('字000', 'zì'));
  assert.equal(decks.at(-1)?.id, TAIL_DECK_ID);
});

test('buildDeckAssignments is deterministic', () => {
  const frequency = new Map([
    ['甲', 5],
    ['乙', 5],
  ]);
  const words = [
    { wordKey: manifestWordKey('乙', 'yǐ'), hanzi: '乙', hsk20Level: 2 },
    { wordKey: manifestWordKey('甲', 'jiǎ'), hanzi: '甲', hsk20Level: 2 },
  ];
  const first = buildDeckAssignments(words, frequency);
  const second = buildDeckAssignments([...words].reverse(), frequency);
  assert.deepEqual(first, second);
});
