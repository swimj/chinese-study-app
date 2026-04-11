import fs from 'node:fs';
import path from 'node:path';
import {
  buildCanonicalWord,
  canMatchByNeutralToneFallback,
  canonicalJoinKey,
  fuzzyJoinKey,
  type CanonicalWord,
} from './lib/canonical-words.ts';
import { parseCedictFile, type CedictEntry } from './lib/cc-cedict.ts';

type BuildSummary = {
  outputPath: string;
  itemCount: number;
  exactCedictMatches: number;
  neutralFallbackMatches: number;
  hackOnlyCount: number;
  notes: string[];
  sample: CanonicalWord[];
};

const cwd = process.cwd();
const outputPath = path.resolve(cwd, process.argv[2] ?? 'data/canonical-wordlist-scaffold.json');
const cedictPath = path.resolve(cwd, 'data/sources/cc-cedict/cedict_ts.u8');

function buildSeedFromHackChinese(): CanonicalWord[] {
  const hackChinesePath = path.resolve(cwd, 'data/hack-chinese-migration-v2.json');

  if (!fs.existsSync(hackChinesePath)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(hackChinesePath, 'utf8')) as {
    records: Array<{
      hanzi: string;
      pinyin: string;
      meanings: string[];
    }>;
  };

  return parsed.records.map((record) => {
    const word = buildCanonicalWord({
      hanzi: record.hanzi,
      pinyin: record.pinyin,
      meanings: record.meanings,
    });

    word.mergeStatus = 'hack-only';
    word.sourceKeys['hack-chinese'] = canonicalJoinKey(record.hanzi, record.pinyin);
    return word;
  });
}

function loadCedictEntries(): CedictEntry[] {
  if (!fs.existsSync(cedictPath)) {
    return [];
  }

  return parseCedictFile(fs.readFileSync(cedictPath, 'utf8'));
}

function mergeWordsWithCedict(hackWords: CanonicalWord[], cedictEntries: CedictEntry[]): CanonicalWord[] {
  const exactMap = new Map<string, CedictEntry[]>();
  const fuzzyMap = new Map<string, CedictEntry[]>();

  for (const entry of cedictEntries) {
    const exactKey = canonicalJoinKey(entry.simplified, entry.toneMarkedPinyin);
    const fuzzyKey = fuzzyJoinKey(entry.simplified, entry.toneMarkedPinyin);
    const exactGroup = exactMap.get(exactKey) ?? [];
    const fuzzyGroup = fuzzyMap.get(fuzzyKey) ?? [];
    exactGroup.push(entry);
    fuzzyGroup.push(entry);
    exactMap.set(exactKey, exactGroup);
    fuzzyMap.set(fuzzyKey, fuzzyGroup);
  }

  return hackWords.map((hackWord) => {
    const exactGroup = exactMap.get(canonicalJoinKey(hackWord.hanzi, hackWord.pinyinDisplay)) ?? [];

    if (exactGroup.length > 0) {
      return mergeHackWordWithCedict(hackWord, exactGroup[0], 'cc-cedict-exact');
    }

    const fuzzyGroup = fuzzyMap.get(fuzzyJoinKey(hackWord.hanzi, hackWord.pinyinDisplay)) ?? [];
    const neutralCandidates = fuzzyGroup.filter((entry) =>
      canMatchByNeutralToneFallback(hackWord.pinyinDisplay, entry.toneMarkedPinyin),
    );

    if (neutralCandidates.length === 1) {
      return mergeHackWordWithCedict(hackWord, neutralCandidates[0], 'cc-cedict-neutral-fallback');
    }

    return hackWord;
  });
}

function mergeHackWordWithCedict(
  hackWord: CanonicalWord,
  cedictEntry: CedictEntry,
  mergeStatus: CanonicalWord['mergeStatus'],
): CanonicalWord {
  const mergedMeanings = [
    ...new Set([...hackWord.meanings, ...cedictEntry.glosses].map((meaning) => meaning.trim()).filter(Boolean)),
  ];

  return {
    ...hackWord,
    traditional: cedictEntry.traditional,
    meaning: cedictEntry.glosses[0] ?? hackWord.meaning,
    meanings: mergedMeanings,
    mergeStatus,
    sourceKeys: {
      ...hackWord.sourceKeys,
      'cc-cedict': canonicalJoinKey(cedictEntry.simplified, cedictEntry.toneMarkedPinyin),
    },
  };
}

function main() {
  const hackWords = buildSeedFromHackChinese();
  const cedictEntries = loadCedictEntries();
  const canonicalWords = mergeWordsWithCedict(hackWords, cedictEntries);
  const exactCedictMatches = canonicalWords.filter((word) => word.mergeStatus === 'cc-cedict-exact').length;
  const neutralFallbackMatches = canonicalWords.filter(
    (word) => word.mergeStatus === 'cc-cedict-neutral-fallback',
  ).length;
  const hackOnlyCount = canonicalWords.filter((word) => word.mergeStatus === 'hack-only').length;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        meta: {
          generatedAt: new Date().toISOString(),
          purpose: 'Scaffold for canonical vocabulary ingestion pipeline',
          sourceAvailability: {
            hackChinese: hackWords.length > 0,
            ccCedict: cedictEntries.length > 0,
          },
          pinyinPolicy: {
            display: 'tone-marked pinyin preserved as authored',
            normalized:
              'tone-marked, lowercased, NFC-normalized pinyin used as the primary cross-source match key',
            search: 'tone-stripped pinyin reserved for fuzzy fallback or UI search only',
          },
          joinPolicy: {
            primary: '(hanzi, pinyinNormalized)',
            fuzzyFallback: 'only when the only difference is neutral-tone marking on one side',
          },
        },
        words: canonicalWords,
      },
      null,
      2,
    ),
  );

  const summary: BuildSummary = {
    outputPath,
    itemCount: canonicalWords.length,
    exactCedictMatches,
    neutralFallbackMatches,
    hackOnlyCount,
    notes: [
      'The scaffold now starts from Hack Chinese progress records and enriches them with CC-CEDICT lexical data when safely matchable.',
      cedictEntries.length > 0
        ? `Parsed ${cedictEntries.length} CC-CEDICT entries from ${cedictPath}.`
        : `No local CC-CEDICT file found at ${cedictPath} yet.`,
      'MOE, SUBTLEX, CC-CEDICT, and Tatoeba ingestion should merge onto pinyinNormalized, not pinyinSearch.',
      'Neutral-tone fallback is allowed only when stripped syllables match and exactly one side omits tone marks.',
      `Unique primary join keys: ${new Set(canonicalWords.map((word) => canonicalJoinKey(word.hanzi, word.pinyinDisplay))).size}`,
      `Unique fuzzy join keys: ${new Set(canonicalWords.map((word) => fuzzyJoinKey(word.hanzi, word.pinyinDisplay))).size}`,
    ],
    sample: canonicalWords.slice(0, 5),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
