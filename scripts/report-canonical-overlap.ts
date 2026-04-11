import fs from 'node:fs';
import path from 'node:path';
import { canMatchByNeutralToneFallback, canonicalJoinKey, fuzzyJoinKey } from './lib/canonical-words.ts';
import { parseCedictFile } from './lib/cc-cedict.ts';

type HackChineseFile = {
  records: Array<{
    hanzi: string;
    pinyin: string;
    meanings: string[];
  }>;
};

const cwd = process.cwd();
const hackChinesePath = path.resolve(cwd, 'data/hack-chinese-migration-v2.json');
const cedictPath = path.resolve(cwd, 'data/sources/cc-cedict/cedict_ts.u8');

const hackChinese = JSON.parse(fs.readFileSync(hackChinesePath, 'utf8')) as HackChineseFile;
const cedictEntries = parseCedictFile(fs.readFileSync(cedictPath, 'utf8'));

const cedictExact = new Map<string, typeof cedictEntries[number][]>();
const cedictFuzzy = new Map<string, typeof cedictEntries[number][]>();

for (const entry of cedictEntries) {
  const exactKey = canonicalJoinKey(entry.simplified, entry.toneMarkedPinyin);
  const fuzzyKey = fuzzyJoinKey(entry.simplified, entry.toneMarkedPinyin);
  const exactGroup = cedictExact.get(exactKey) ?? [];
  const fuzzyGroup = cedictFuzzy.get(fuzzyKey) ?? [];
  exactGroup.push(entry);
  fuzzyGroup.push(entry);
  cedictExact.set(exactKey, exactGroup);
  cedictFuzzy.set(fuzzyKey, fuzzyGroup);
}

const exactMatches: Array<{ hanzi: string; pinyin: string; meanings: string[]; cedictGlosses: string[] }> = [];
const neutralToneFallbackMatches: Array<{ hanzi: string; pinyin: string; candidatePinyins: string[] }> = [];
const ambiguousFuzzyMatches: Array<{ hanzi: string; pinyin: string; candidatePinyins: string[] }> = [];
const unmatched: Array<{ hanzi: string; pinyin: string; meanings: string[] }> = [];

for (const record of hackChinese.records) {
  const exactKey = canonicalJoinKey(record.hanzi, record.pinyin);
  const fuzzyKey = fuzzyJoinKey(record.hanzi, record.pinyin);
  const exactGroup = cedictExact.get(exactKey) ?? [];

  if (exactGroup.length > 0) {
    exactMatches.push({
      hanzi: record.hanzi,
      pinyin: record.pinyin,
      meanings: record.meanings,
      cedictGlosses: [...new Set(exactGroup.flatMap((entry) => entry.glosses))].slice(0, 8),
    });
    continue;
  }

  const fuzzyGroup = cedictFuzzy.get(fuzzyKey) ?? [];
  const neutralCandidates = fuzzyGroup.filter((entry) =>
    canMatchByNeutralToneFallback(record.pinyin, entry.toneMarkedPinyin),
  );

  if (neutralCandidates.length === 1) {
    neutralToneFallbackMatches.push({
      hanzi: record.hanzi,
      pinyin: record.pinyin,
      candidatePinyins: [neutralCandidates[0].toneMarkedPinyin],
    });
    continue;
  }

  if (fuzzyGroup.length > 0) {
    ambiguousFuzzyMatches.push({
      hanzi: record.hanzi,
      pinyin: record.pinyin,
      candidatePinyins: [...new Set(fuzzyGroup.map((entry) => entry.toneMarkedPinyin))].sort(),
    });
    continue;
  }

  unmatched.push({
    hanzi: record.hanzi,
    pinyin: record.pinyin,
    meanings: record.meanings,
  });
}

console.log(
  JSON.stringify(
    {
      hackChineseCount: hackChinese.records.length,
      cedictCount: cedictEntries.length,
      exactMatchCount: exactMatches.length,
      neutralToneFallbackMatchCount: neutralToneFallbackMatches.length,
      ambiguousFuzzyMatchCount: ambiguousFuzzyMatches.length,
      unmatchedCount: unmatched.length,
      exactMatchRate: Number((exactMatches.length / hackChinese.records.length).toFixed(4)),
      sampleExactMatches: exactMatches.slice(0, 10),
      sampleNeutralToneFallbackMatches: neutralToneFallbackMatches.slice(0, 10),
      sampleAmbiguousFuzzyMatches: ambiguousFuzzyMatches.slice(0, 10),
      sampleUnmatched: unmatched.slice(0, 10),
    },
    null,
    2,
  ),
);
