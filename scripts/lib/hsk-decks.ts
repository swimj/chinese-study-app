import { normalizeToneMarkedPinyin, stripPinyinTones } from './canonical-words.ts';

/**
 * HSK deck assignment support (SPECS/diet-deck-distribution.md §2.2).
 *
 * Pure parsing/join/subdivision logic behind scripts/build-deck-manifest.ts.
 * Decks derive from HSK 2.0 deltas; HSK 3.0 (final 2025-11 syllabus) tags
 * ride along on canonical words. Joins are primarily (hanzi, reading);
 * hanzi-only fallbacks are recorded as ambiguous, never silently guessed.
 */

export type HskSourceEntry = {
  hanzi: string;
  pinyin: string | null;
  /** 1-6 for regular levels; 7 denotes the shared HSK 3.0 7-9 band. */
  level: number;
};

export type HskJoin = {
  level: number;
  /**
   * exact: tone-marked readings matched. tone-stripped: tone marks disagreed
   * (e.g. source "bā" vs canonical neutral "ba") but stripped readings
   * matched. hanzi-only: no reading comparison possible.
   */
  matchKind: 'exact' | 'tone-stripped' | 'hanzi-only';
  /** True when the hanzi has multiple canonical readings and the join could not pick one. */
  ambiguous: boolean;
};

export type HskJoinStats = {
  exactMatches: number;
  toneStrippedMatches: number;
  hanziOnlyMatches: number;
  ambiguousJoins: string[];
  unmatchedJoins: string[];
  hskHanziWithoutCanonicalWord: string[];
};

/** Official introduced-per-level counts, HSK 2.0 (cumulative 150/300/600/1200/2500/5000). */
export const EXPECTED_HSK20_DELTA_COUNTS = [150, 150, 300, 600, 1300, 2500] as const;
/** Official introduced-per-level counts, final HSK 3.0 syllabus (2025-11). */
export const EXPECTED_HSK30_DELTA_COUNTS = [300, 200, 500, 1000, 1600, 1800] as const;

export const DECK_SUBDIVISION_THRESHOLD = 400;
export const DECK_STRATUM_TARGET_SIZE = 250;
export const TAIL_DECK_ID = 'beyond-hsk';

/** Manifest assignment key: `${hanzi}|${pinyinNormalized}` (matches the runtime loader). */
export function manifestWordKey(hanzi: string, pinyinNormalized: string): string {
  return `${hanzi.trim()}|${pinyinNormalized}`;
}

/**
 * Reading equality for cross-source joins: tone-marked, lowercased, NFC,
 * with spaces and apostrophes removed so "bàba" and "bà ba" compare equal.
 */
export function readingComparisonKey(pinyin: string): string {
  return normalizeSourcePinyin(pinyin).replace(/[\s'’‘-]/g, '');
}

/** Tone-insensitive reading equality (secondary join tier). */
export function strippedReadingComparisonKey(pinyin: string): string {
  return stripPinyinTones(normalizeSourcePinyin(pinyin)).replace(/[\s'’‘-]/g, '');
}

function normalizeSourcePinyin(pinyin: string): string {
  return normalizeToneMarkedPinyin(pinyin).replace(/u:|v/g, 'ü');
}

// --- Source parsers -----------------------------------------------------------

/** drkameleon/complete-hsk-vocabulary `wordlists/exclusive/old/<level>.json`. */
export function parseHsk20LevelJson(contents: string, level: number): HskSourceEntry[] {
  const parsed: unknown = JSON.parse(contents);
  if (!Array.isArray(parsed)) {
    throw new Error(`HSK 2.0 level ${level} JSON must be an array.`);
  }
  return parsed.flatMap((entry, index) => {
    const hanzi = (entry as { simplified?: unknown })?.simplified;
    const forms = (entry as { forms?: unknown })?.forms;
    if (typeof hanzi !== 'string' || hanzi.trim().length === 0) {
      throw new Error(`HSK 2.0 level ${level} entry ${index} is missing a simplified form.`);
    }
    if (forms !== undefined && !Array.isArray(forms)) {
      throw new Error(`HSK 2.0 level ${level} entry ${index} has non-array forms.`);
    }
    if (!forms || forms.length === 0) {
      return [{ hanzi: hanzi.trim(), pinyin: null, level }];
    }
    return forms.map((form, formIndex) => {
      const pinyin = (form as { transcriptions?: { pinyin?: unknown } })?.transcriptions?.pinyin;
      if (pinyin !== null && pinyin !== undefined && typeof pinyin !== 'string') {
        throw new Error(`HSK 2.0 level ${level} entry ${index} form ${formIndex} has a non-string pinyin.`);
      }
      return { hanzi: hanzi.trim(), pinyin: (pinyin as string | null) ?? null, level };
    });
  });
}

/**
 * Punpuf/hsk-syllabus-vocabulary-parser `hsk_word_list.tsv` (final 2025-11 syllabus).
 * Columns: word_index, level, word, pinyin, part_of_speech, ...
 * The word column may carry a trailing disambiguation digit (点1 / 点2); the
 * 7-9 band is recorded as level 7.
 */
export function parseHsk30SyllabusTsv(contents: string): HskSourceEntry[] {
  const entries: HskSourceEntry[] = [];
  const lines = contents.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const columns = line.split('\t');
    if (columns[0] === 'word_index') {
      continue;
    }
    if (columns.length < 4) {
      throw new Error(`HSK 3.0 TSV line ${index + 1} has ${columns.length} columns; expected at least 4.`);
    }
    const levelRaw = columns[1].trim();
    const level = levelRaw === '7-9' ? 7 : Number.parseInt(levelRaw, 10);
    if (!Number.isInteger(level) || level < 1 || level > 7) {
      throw new Error(`HSK 3.0 TSV line ${index + 1} has invalid level "${levelRaw}".`);
    }
    const hanzi = columns[2].trim().replace(/\d+$/, '');
    if (hanzi.length === 0) {
      throw new Error(`HSK 3.0 TSV line ${index + 1} has an empty word.`);
    }
    const pinyin = columns[3].trim();
    entries.push({ hanzi, pinyin: pinyin.length > 0 ? pinyin : null, level });
  }
  return entries;
}

/**
 * Flat SUBTLEX-CH word-frequency TSV (Word, WCount, W/million, ...).
 * Returns hanzi -> token count. This is the WF variant (no PoS rows); the
 * older scripts/lib/subtlex.ts parser targets the WF_PoS variant.
 */
export function parseSubtlexWf(contents: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('"') || line.startsWith('Word\t')) {
      continue;
    }
    const columns = line.split('\t');
    if (columns.length < 2) {
      continue;
    }
    const count = Number.parseInt(columns[1], 10);
    if (!Number.isFinite(count)) {
      continue;
    }
    const hanzi = columns[0].trim();
    counts.set(hanzi, (counts.get(hanzi) ?? 0) + count);
  }
  return counts;
}

// --- Source count guards --------------------------------------------------------

/**
 * Verify introduced-per-level counts against the official numbers. The HSK
 * 3.0 check doubles as draft detection: the 2021 draft had 500 level-1 words,
 * the final 2025-11 syllabus has 300. Returns non-fatal warnings; throws on
 * gross mismatch.
 */
export function guardSourceCounts(
  actual: readonly number[],
  expected: readonly number[],
  label: string,
  tolerance: number,
): string[] {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: expected ${expected.length} levels, got ${actual.length}.`);
  }
  const warnings: string[] = [];
  for (const [index, expectedCount] of expected.entries()) {
    const actualCount = actual[index] ?? 0;
    const drift = Math.abs(actualCount - expectedCount);
    if (drift > tolerance) {
      throw new Error(
        `${label}: level ${index + 1} count ${actualCount} is ${drift} off the official ${expectedCount}. ` +
          'This source does not look like the expected syllabus revision — refusing to build.',
      );
    }
    if (drift > 0) {
      warnings.push(`${label}: level ${index + 1} has ${actualCount} words vs official ${expectedCount} (within tolerance; likely dedup).`);
    }
  }
  return warnings;
}

// --- Join -----------------------------------------------------------------------

export type CanonicalWordLike = {
  hanzi: string;
  pinyinNormalized: string;
};

/**
 * Probe the canonical corpus from the smaller HSK source set and assign each
 * matched canonical word the earliest HSK level at which its reading appears.
 * Exact (hanzi, reading) joins win. Tone-insensitive and hanzi-only fallbacks
 * are accepted only when they resolve to one canonical row; otherwise the
 * source probe is reported and left unassigned.
 */
export function assignHskLevels(
  canonicalWords: CanonicalWordLike[],
  hskEntries: HskSourceEntry[],
): { joins: Map<string, HskJoin>; stats: HskJoinStats } {
  const canonicalByHanzi = new Map<string, CanonicalWordLike[]>();
  const canonicalKeys = new Set<string>();
  for (const word of canonicalWords) {
    const key = manifestWordKey(word.hanzi, word.pinyinNormalized);
    if (canonicalKeys.has(key)) {
      throw new Error(`Canonical corpus has duplicate word key "${key}".`);
    }
    canonicalKeys.add(key);
    const group = canonicalByHanzi.get(word.hanzi) ?? [];
    group.push(word);
    canonicalByHanzi.set(word.hanzi, group);
  }

  const joins = new Map<string, HskJoin>();
  const stats: HskJoinStats = {
    exactMatches: 0,
    toneStrippedMatches: 0,
    hanziOnlyMatches: 0,
    ambiguousJoins: [],
    unmatchedJoins: [],
    hskHanziWithoutCanonicalWord: [],
  };

  const sourceEntries = new Map<string, HskSourceEntry>();
  for (const entry of hskEntries) {
    const readings = entry.pinyin?.split('/').map((reading) => reading.trim()).filter(Boolean) ?? [null];
    for (const reading of readings) {
      const expanded = { ...entry, pinyin: reading };
      const sourceKey = manifestWordKey(expanded.hanzi, expanded.pinyin ?? '');
      const previous = sourceEntries.get(sourceKey);
      if (!previous || expanded.level < previous.level) sourceEntries.set(sourceKey, expanded);
    }
  }

  const recordJoin = (word: CanonicalWordLike, entry: HskSourceEntry, matchKind: HskJoin['matchKind']): void => {
    const wordKey = manifestWordKey(word.hanzi, word.pinyinNormalized);
    const previous = joins.get(wordKey);
    if (!previous || entry.level < previous.level) {
      joins.set(wordKey, { level: entry.level, matchKind, ambiguous: false });
    }
  };

  const missingHanzi = new Set<string>();
  for (const entry of sourceEntries.values()) {
    const candidates = canonicalByHanzi.get(entry.hanzi) ?? [];
    const sourceKey = manifestWordKey(entry.hanzi, entry.pinyin ?? '');
    if (candidates.length === 0) {
      stats.unmatchedJoins.push(sourceKey);
      missingHanzi.add(entry.hanzi);
      continue;
    }

    if (entry.pinyin !== null) {
      const exact = candidates.filter(
        (word) => readingComparisonKey(word.pinyinNormalized) === readingComparisonKey(entry.pinyin!),
      );
      if (exact.length === 1) {
        stats.exactMatches += 1;
        recordJoin(exact[0]!, entry, 'exact');
        continue;
      }
      const stripped = candidates.filter(
        (word) => strippedReadingComparisonKey(word.pinyinNormalized) === strippedReadingComparisonKey(entry.pinyin!),
      );
      if (stripped.length === 1) {
        stats.toneStrippedMatches += 1;
        recordJoin(stripped[0]!, entry, 'tone-stripped');
        continue;
      }
      (stripped.length > 1 ? stats.ambiguousJoins : stats.unmatchedJoins).push(sourceKey);
      continue;
    }

    if (candidates.length === 1) {
      stats.hanziOnlyMatches += 1;
      recordJoin(candidates[0]!, entry, 'hanzi-only');
    } else {
      stats.ambiguousJoins.push(sourceKey);
    }
  }
  stats.hskHanziWithoutCanonicalWord = [...missingHanzi].sort();

  return { joins, stats };
}

// --- Deck construction -----------------------------------------------------------

export type DeckDefinition = {
  id: string;
  order: number;
  hsk: { version: '2.0'; level: number } | null;
  stratum: number | null;
  size: number;
};

export type DeckAssignmentInput = {
  wordKey: string;
  hanzi: string;
  hsk20Level: number | null;
};

/**
 * Build the deck set from HSK 2.0 delta membership. Deltas larger than the
 * subdivision threshold split into frequency-ordered strata of roughly the
 * target size (evenly distributed; unfrequented words sort last by hanzi).
 * Untagged words are not assigned — consumers treat them as the tail deck.
 */
export function buildDeckAssignments(
  words: DeckAssignmentInput[],
  frequencyByHanzi: Map<string, number>,
  options: { subdivisionThreshold?: number; stratumTargetSize?: number } = {},
): { decks: DeckDefinition[]; assignments: Record<string, string>; deckMembers: Record<string, string[]> } {
  const subdivisionThreshold = options.subdivisionThreshold ?? DECK_SUBDIVISION_THRESHOLD;
  const stratumTargetSize = options.stratumTargetSize ?? DECK_STRATUM_TARGET_SIZE;

  const decks: DeckDefinition[] = [];
  const assignments: Record<string, string> = {};
  const deckMembers: Record<string, string[]> = {};
  let order = 0;

  for (let level = 1; level <= 6; level += 1) {
    const members = words
      .filter((word) => word.hsk20Level === level)
      .sort((left, right) => {
        const frequencyDelta = (frequencyByHanzi.get(right.hanzi) ?? 0) - (frequencyByHanzi.get(left.hanzi) ?? 0);
        if (frequencyDelta !== 0) {
          return frequencyDelta;
        }
        return left.hanzi.localeCompare(right.hanzi, 'zh-Hans-CN') || left.wordKey.localeCompare(right.wordKey);
      });

    if (members.length === 0) {
      continue;
    }

    if (members.length <= subdivisionThreshold) {
      const deckId = `hsk2-l${level}`;
      decks.push({ id: deckId, order, hsk: { version: '2.0', level }, stratum: null, size: members.length });
      order += 1;
      deckMembers[deckId] = members.map((member) => member.wordKey);
      for (const member of members) {
        assignments[member.wordKey] = deckId;
      }
      continue;
    }

    const stratumCount = Math.ceil(members.length / stratumTargetSize);
    const stratumSize = Math.ceil(members.length / stratumCount);
    for (let stratum = 1; stratum <= stratumCount; stratum += 1) {
      const deckId = `hsk2-l${level}-s${stratum}`;
      const chunk = members.slice((stratum - 1) * stratumSize, stratum * stratumSize);
      decks.push({ id: deckId, order, hsk: { version: '2.0', level }, stratum, size: chunk.length });
      order += 1;
      deckMembers[deckId] = chunk.map((member) => member.wordKey);
      for (const member of chunk) {
        assignments[member.wordKey] = deckId;
      }
    }
  }

  decks.push({ id: TAIL_DECK_ID, order, hsk: null, stratum: null, size: 0 });
  return { decks, assignments, deckMembers };
}
