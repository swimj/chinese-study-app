import fs from 'node:fs';
import path from 'node:path';
import type { CanonicalWord } from './lib/canonical-words.ts';
import {
  assignHskLevels,
  buildDeckAssignments,
  EXPECTED_HSK20_DELTA_COUNTS,
  EXPECTED_HSK30_DELTA_COUNTS,
  HSK20_EXCLUDED_READINGS,
  guardSourceCounts,
  manifestWordKey,
  parseHsk20LevelJson,
  parseHsk30SyllabusTsv,
  parseSubtlexWf,
  TAIL_DECK_ID,
  type HskSourceEntry,
} from './lib/hsk-decks.ts';

/**
 * Builds the runtime deck manifest (SPECS/diet-deck-distribution.md §2.2
 * "Early artifact step: HSK tag ingestion").
 *
 * Inputs are intentionally not checked in. Install externally acquired or
 * locally retained copies at these paths before running this command.
 *
 * Logical upstream references (also recorded in the output metadata):
 * - canonical corpus dictionary: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
 * - HSK 2.0: https://github.com/drkameleon/complete-hsk-vocabulary
 * - final HSK 3.0 syllabus parser: https://github.com/Punpuf/hsk-syllabus-vocabulary-parser
 * - HSK 3.1 count cross-check: https://github.com/leonsilicon/hsk3.1
 * - flat SUBTLEX frequency list: https://github.com/leonsilicon/subtlex-ch-wf
 *
 * Inputs:
 * - data/canonical-corpus.json (run `npm run build:canonical-wordlist` first)
 * - data/sources/hsk/hsk20-level-{1..6}.json  (HSK 2.0 deltas; deck source)
 * - data/sources/hsk/hsk30-syllabus-2025.tsv  (final HSK 3.0 syllabus; tags)
 * - data/sources/hsk/hsk31-crosscheck-level-{1..6}.json (count cross-check)
 * - data/sources/subtlex/SUBTLEX-CH-WF (stratum ordering within large deltas)
 *
 * Outputs:
 * - server/decks/mandarin-decks-v1.json (checked-in runtime artifact)
 * - data/canonical-corpus.json annotated in place with per-word hskLevels
 * - tmp/deck-eyeball-report.md (human review aid, not committed)
 */

const cwd = process.cwd();
const canonicalCorpusPath = path.resolve(cwd, 'data/canonical-corpus.json');
const outputPath = path.resolve(cwd, 'server/decks/mandarin-decks-v1.json');
const reportPath = path.resolve(cwd, 'tmp/deck-eyeball-report.md');

const SOURCE_PROVENANCE = {
  hsk20: 'drkameleon/complete-hsk-vocabulary@7ac65bf wordlists/exclusive/old/{1..6}.json (retrieved 2026-09-10)',
  hsk30: 'Punpuf/hsk-syllabus-vocabulary-parser@2adf7c9 hsk_word_list.tsv, parsed from the final 2025-11 HSK 3.0 syllabus PDF (retrieved 2026-09-10)',
  hsk31Crosscheck: 'leonsilicon/hsk3.1@b575c77 HSK3.1_words_level{1..6}.json (becky82/mteh export; count cross-check, retrieved 2026-09-10)',
  subtlex: 'leonsilicon/subtlex-ch-wf@b913a2d data/SUBTLEX-CH-WF (flat word-frequency variant; stratum ordering only, retrieved 2026-09-10)',
};

function readSource(relativePath: string): string {
  const filePath = path.resolve(cwd, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing source file ${relativePath}. See SOURCE_PROVENANCE in scripts/build-deck-manifest.ts.`);
  }
  return readPossiblyGb18030(filePath);
}

function readPossiblyGb18030(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const replacementChar = String.fromCharCode(0xfffd);
  return utf8.includes(replacementChar) ? new TextDecoder('gb18030').decode(buffer) : utf8;
}

function loadCanonicalWords(): CanonicalWord[] {
  if (!fs.existsSync(canonicalCorpusPath)) {
    throw new Error('data/canonical-corpus.json not found. Run `npm run build:canonical-wordlist` first.');
  }
  const parsed = JSON.parse(fs.readFileSync(canonicalCorpusPath, 'utf8')) as { words?: CanonicalWord[] };
  if (!Array.isArray(parsed.words) || parsed.words.length === 0) {
    throw new Error('data/canonical-corpus.json has no words array; rebuild it with `npm run build:canonical-wordlist`.');
  }
  return parsed.words;
}

function perLevelDeltaCounts(entries: HskSourceEntry[], levels: readonly number[]): number[] {
  // First appearance per (hanzi, pinyin) reading, then count per level.
  const firstSeen = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.hanzi}|${entry.pinyin ?? ''}`;
    const current = firstSeen.get(key);
    if (current === undefined || entry.level < current) {
      firstSeen.set(key, entry.level);
    }
  }
  return levels.map((level) => [...firstSeen.values()].filter((seen) => seen === level).length);
}

function main() {
  const levels = [1, 2, 3, 4, 5, 6];
  const hsk20Sources = levels.map((level) => readSource(`data/sources/hsk/hsk20-level-${level}.json`));
  const hsk20Entries = hsk20Sources.flatMap((source, index) => parseHsk20LevelJson(source, index + 1));
  const hsk30Entries = parseHsk30SyllabusTsv(readSource('data/sources/hsk/hsk30-syllabus-2025.tsv'));
  const frequencyByHanzi = parseSubtlexWf(readSource('data/sources/subtlex/SUBTLEX-CH-WF'));

  const warnings: string[] = [];
  const hsk20HeadwordCounts = hsk20Sources.map((source) => {
    const parsed: unknown = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error('HSK 2.0 source must be an array.');
    return parsed.length;
  });
  warnings.push(...guardSourceCounts(hsk20HeadwordCounts, EXPECTED_HSK20_DELTA_COUNTS, 'HSK 2.0', 10));
  warnings.push(...guardSourceCounts(perLevelDeltaCounts(hsk30Entries.filter((e) => e.level <= 6), levels), EXPECTED_HSK30_DELTA_COUNTS, 'HSK 3.0', 40));

  // Cross-check the 3.0 parse against the independently packaged list.
  for (const level of levels) {
    const crosscheck: unknown = JSON.parse(readSource(`data/sources/hsk/hsk31-crosscheck-level-${level}.json`));
    if (!Array.isArray(crosscheck)) {
      throw new Error(`HSK 3.1 crosscheck level ${level} is not an array.`);
    }
    const expected = EXPECTED_HSK30_DELTA_COUNTS[level - 1];
    if (crosscheck.length !== expected) {
      throw new Error(
        `HSK 3.1 crosscheck level ${level} has ${crosscheck.length} words; expected exactly ${expected}. ` +
          'Count cross-check failed — refusing to build.',
      );
    }
  }

  const canonicalWords = loadCanonicalWords();
  const hsk20 = assignHskLevels(canonicalWords, hsk20Entries);
  const hsk30 = assignHskLevels(canonicalWords, hsk30Entries);

  const deckInput = canonicalWords.map((word) => ({
    wordKey: manifestWordKey(word.hanzi, word.pinyinNormalized),
    hanzi: word.hanzi,
    hsk20Level: hsk20.joins.get(manifestWordKey(word.hanzi, word.pinyinNormalized))?.level ?? null,
  }));
  const { decks, assignments, deckMembers } = buildDeckAssignments(deckInput, frequencyByHanzi);

  // HSK tags ride along on the canonical corpus artifact (both versions).
  for (const word of canonicalWords) {
    const key = manifestWordKey(word.hanzi, word.pinyinNormalized);
    word.hskLevels = {
      hsk20: hsk20.joins.get(key)?.level ?? null,
      hsk30: hsk30.joins.get(key)?.level ?? null,
    };
  }
  const corpus = JSON.parse(fs.readFileSync(canonicalCorpusPath, 'utf8')) as Record<string, unknown>;
  corpus.words = canonicalWords;
  fs.writeFileSync(canonicalCorpusPath, JSON.stringify(corpus, null, 2));

  const manifest = {
    meta: {
      manifestVersion: 1,
      generatedAt: new Date().toISOString(),
      purpose: 'Deck assignments for the decked new-word diet (SPECS/diet-deck-distribution.md)',
      keyFormat: 'assignments map `${hanzi}|${pinyinNormalized}` -> deck id; words absent from assignments belong to the beyond-hsk tail deck',
      deckPolicy: 'HSK 2.0 deltas; deltas over 400 words split into frequency-ordered strata of ~250 (SUBTLEX-CH-WF count desc)',
      sources: SOURCE_PROVENANCE,
      joinStats: {
        hsk20: hsk20.stats,
        hsk30: hsk30.stats,
        canonicalWordCount: canonicalWords.length,
        subtlexWordCount: frequencyByHanzi.size,
      },
      hsk20ExcludedReadings: HSK20_EXCLUDED_READINGS,
      countGuardWarnings: warnings,
    },
    decks,
    assignments,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

  // Human-eyeball report. Samples follow stratum order (frequency-sorted).
  const hanziByWordKey = new Map(deckInput.map((word) => [word.wordKey, word.hanzi]));
  const wordsByDeck = new Map<string, string[]>();
  for (const [deckId, memberKeys] of Object.entries(deckMembers)) {
    wordsByDeck.set(deckId, memberKeys.map((key) => hanziByWordKey.get(key) ?? key));
  }
  const reportLines = [
    '# Deck eyeball report',
    '',
    `Generated ${manifest.meta.generatedAt}. ${decks.length} decks (incl. tail), ${Object.keys(assignments).length} assigned words.`,
    '',
    ...warnings.map((warning) => `> WARNING: ${warning}`),
    '',
  ];
  for (const deck of decks) {
    const sample = (wordsByDeck.get(deck.id) ?? []).slice(0, 8).join(' ');
    reportLines.push(`## ${deck.id} (order ${deck.order}, size ${deck.size})`, '', sample || '(empty)', '');
  }
  reportLines.push(
    `## ${TAIL_DECK_ID}`,
    '',
    `Unassigned canonical words (runtime-dependent): ${canonicalWords.length - Object.keys(assignments).length}`,
    '',
    `HSK 3.0 joins: ${hsk30.stats.exactMatches} exact, ${hsk30.stats.toneStrippedMatches} tone-stripped, ${hsk30.stats.hanziOnlyMatches} hanzi-only, ${hsk30.stats.ambiguousJoins.length} ambiguous, ${hsk30.stats.unmatchedJoins.length} unmatched source readings.`,
    `HSK 2.0 joins: ${hsk20.stats.exactMatches} exact, ${hsk20.stats.toneStrippedMatches} tone-stripped, ${hsk20.stats.hanziOnlyMatches} hanzi-only, ${hsk20.stats.ambiguousJoins.length} ambiguous, ${hsk20.stats.unmatchedJoins.length} unmatched source readings.`,
    '',
    '### HSK 3.0 ambiguous source probes',
    '',
    hsk30.stats.ambiguousJoins.join('\n') || '(none)',
    '',
    '### HSK 3.0 unmatched source probes',
    '',
    hsk30.stats.unmatchedJoins.join('\n') || '(none)',
    '',
    '### HSK 2.0 ambiguous source probes',
    '',
    hsk20.stats.ambiguousJoins.join('\n') || '(none)',
    '',
    '### HSK 2.0 unmatched source probes',
    '',
    hsk20.stats.unmatchedJoins.join('\n') || '(none)',
    '',
    '### HSK 2.0 excluded obscure readings',
    '',
    ...Object.entries(HSK20_EXCLUDED_READINGS).map(([key, reason]) => `- ${key}: ${reason}`),
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, reportLines.join('\n'));

  console.log(JSON.stringify({
    outputPath,
    reportPath,
    deckCount: decks.length,
    assignedWords: Object.keys(assignments).length,
    deckSizes: Object.fromEntries(decks.map((deck) => [deck.id, deck.size])),
    warnings,
  }, null, 2));
}

main();
