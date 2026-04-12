import fs from 'node:fs';
import path from 'node:path';
import {
  buildCanonicalWord,
  canonicalJoinKey,
  type CanonicalWord,
} from './lib/canonical-words.ts';
import { parseCedictFile, type CedictEntry } from './lib/cc-cedict.ts';
import { parseSubtlex, readSubtlexFile, type SubtlexEntry } from './lib/subtlex.ts';

type BuildSummary = {
  outputPath: string;
  itemCount: number;
  cedictSeedCount: number;
  subtlexMatchCount: number;
  prioritizedCount: number;
  notes: string[];
  sample: CanonicalWord[];
};

const cwd = process.cwd();
const outputPath = path.resolve(cwd, process.argv[2] ?? 'data/canonical-corpus.json');
const cedictPath = path.resolve(cwd, 'data/sources/cc-cedict/cedict_ts.u8');
const subtlexPath = path.resolve(cwd, 'data/sources/subtlex/SUBTLEX-CH-WF_PoS');

function loadCedictEntries(): CedictEntry[] {
  if (!fs.existsSync(cedictPath)) {
    return [];
  }

  return parseCedictFile(fs.readFileSync(cedictPath, 'utf8'));
}

function loadSubtlexEntries(): SubtlexEntry[] {
  if (!fs.existsSync(subtlexPath)) {
    return [];
  }

  return parseSubtlex(readSubtlexFile(subtlexPath));
}

function buildCanonicalSeedFromCedict(cedictEntries: CedictEntry[]): CanonicalWord[] {
  const grouped = new Map<string, CedictEntry[]>();

  for (const entry of cedictEntries) {
    const key = canonicalJoinKey(entry.simplified, entry.toneMarkedPinyin);
    const group = grouped.get(key) ?? [];
    group.push(entry);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .map(([key, entries]) => {
      const first = entries[0];
      const traditionalVariants = [...new Set(entries.map((entry) => entry.traditional.trim()).filter(Boolean))];
      const meanings = [...new Set(entries.flatMap((entry) => entry.glosses).map((gloss) => gloss.trim()).filter(Boolean))];
      const word = buildCanonicalWord({
        hanzi: first.simplified,
        traditional: traditionalVariants.length === 0 ? null : traditionalVariants.join(' / '),
        pinyin: first.toneMarkedPinyin,
        meanings,
      });

      word.mergeStatus = 'cc-cedict-exact';
      word.sourceKeys['cc-cedict'] = key;
      return word;
    })
    .sort((left, right) => left.hanzi.localeCompare(right.hanzi, 'zh-Hans-CN') || left.pinyinDisplay.localeCompare(right.pinyinDisplay));
}

function enrichWordsWithSubtlex(words: CanonicalWord[], subtlexEntries: SubtlexEntry[]): CanonicalWord[] {
  const entryMap = new Map<string, SubtlexEntry>();

  for (const entry of subtlexEntries) {
    if (!entryMap.has(entry.lemma)) {
      entryMap.set(entry.lemma, entry);
    }
  }

  const sortedByFrequency = [...entryMap.values()].sort((a, b) => b.lemmaCount - a.lemmaCount);
  const rankMap = new Map<string, number>();
  sortedByFrequency.forEach((entry, index) => {
    rankMap.set(entry.lemma, index + 1);
  });

  return words.map((word) => {
    const subtlex = entryMap.get(word.hanzi);
    if (!subtlex) {
      return word;
    }

    return {
      ...word,
      frequencyRank: rankMap.get(word.hanzi) ?? null,
      frequencyScore: subtlex.lemmaCount,
      posFrequency: subtlex.posRows.map((row) => ({ pos: row.pos, count: row.count })),
      sourceKeys: {
        ...word.sourceKeys,
        subtlex: subtlex.sourceKey,
      },
    };
  });
}

function assignPriority(words: CanonicalWord[]): CanonicalWord[] {
  const sorted = [...words].sort((left, right) => {
    const leftHasFrequency = left.frequencyRank !== null;
    const rightHasFrequency = right.frequencyRank !== null;

    if (leftHasFrequency && rightHasFrequency) {
      if (left.frequencyRank !== right.frequencyRank) {
        return (left.frequencyRank ?? Number.MAX_SAFE_INTEGER) - (right.frequencyRank ?? Number.MAX_SAFE_INTEGER);
      }
    } else if (leftHasFrequency !== rightHasFrequency) {
      return leftHasFrequency ? -1 : 1;
    }

    return left.hanzi.localeCompare(right.hanzi, 'zh-Hans-CN') || left.pinyinDisplay.localeCompare(right.pinyinDisplay);
  });

  const priorityById = new Map<string, number>();
  sorted.forEach((word, index) => {
    priorityById.set(word.id, sorted.length - index);
  });

  return words.map((word) => ({
    ...word,
    priority: priorityById.get(word.id) ?? 1,
  }));
}

function main() {
  const cedictEntries = loadCedictEntries();
  const subtlexEntries = loadSubtlexEntries();
  const cedictSeedWords = buildCanonicalSeedFromCedict(cedictEntries);
  const wordsAfterSubtlex = enrichWordsWithSubtlex(cedictSeedWords, subtlexEntries);
  const canonicalWords = assignPriority(wordsAfterSubtlex);
  const subtlexMatches = canonicalWords.filter((word) => word.frequencyRank !== null).length;
  const prioritizedCount = canonicalWords.filter((word) => word.priority !== null).length;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        meta: {
          generatedAt: new Date().toISOString(),
          purpose: 'Canonical vocabulary corpus for study import',
          sourceAvailability: {
            ccCedict: cedictEntries.length > 0,
            subtlex: subtlexEntries.length > 0,
          },
          pinyinPolicy: {
            display: 'tone-marked pinyin preserved as authored',
            normalized:
              'tone-marked, lowercased, NFC-normalized pinyin used as the primary cross-source match key',
            search: 'tone-stripped pinyin reserved for fuzzy fallback or UI search only',
          },
          priorityPolicy: {
            current: 'frequency-first global ordering from SUBTLEX rank, with unmatched words placed after ranked words',
            note: 'Ranked words sort ahead of unranked words; ties fall back to stable hanzi+pinyin order',
          },
          joinPolicy: {
            primary: '(hanzi, pinyinNormalized)',
            fuzzyFallback: 'not used in canonical corpus build; reserved for source reconciliation tasks',
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
    cedictSeedCount: cedictSeedWords.length,
    subtlexMatchCount: subtlexMatches,
    prioritizedCount,
    notes: [
      'The canonical corpus now starts from the full CC-CEDICT entry set grouped by simplified form + tone-marked pinyin.',
      cedictEntries.length > 0
        ? `Parsed ${cedictEntries.length} CC-CEDICT entries from ${cedictPath}.`
        : `No local CC-CEDICT file found at ${cedictPath} yet.`,
      subtlexEntries.length > 0
        ? `Parsed ${subtlexEntries.length} SUBTLEX lemma rows from ${subtlexPath}.`
        : `No local SUBTLEX file found at ${subtlexPath} yet.`,
      `Built ${cedictSeedWords.length} canonical seed words from grouped CC-CEDICT entries.`,
      `SUBTLEX matched ${subtlexMatches} canonical words by hanzi lemma.`,
      `Assigned priority to ${prioritizedCount} canonical words.`,
      'SUBTLEX ranking is used for priority only and does not override CC-CEDICT readings.',
      `Unique primary join keys: ${new Set(canonicalWords.map((word) => canonicalJoinKey(word.hanzi, word.pinyinDisplay))).size}`,
    ],
    sample: canonicalWords.slice(0, 5),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
