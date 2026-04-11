import {
  buildCanonicalWord,
  canonicalJoinKey,
  type CanonicalWord,
} from './canonical-words.ts';

export type CedictEntry = {
  traditional: string;
  simplified: string;
  numberedPinyin: string;
  toneMarkedPinyin: string;
  glosses: string[];
  sourceKey: string;
};

const ENTRY_REGEX = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/;

const TONE_VOWELS: Record<string, string[]> = {
  a: ['a', 'ā', 'á', 'ǎ', 'à'],
  e: ['e', 'ē', 'é', 'ě', 'è'],
  i: ['i', 'ī', 'í', 'ǐ', 'ì'],
  o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
  u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
  ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

export function parseCedictFile(contents: string): CedictEntry[] {
  const entries: CedictEntry[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(ENTRY_REGEX);
    if (!match) {
      continue;
    }

    const [, traditional, simplified, numberedPinyin, rawGlosses] = match;
    const glosses = rawGlosses
      .split('/')
      .map((gloss) => gloss.trim())
      .filter(Boolean);

    entries.push({
      traditional,
      simplified,
      numberedPinyin,
      toneMarkedPinyin: numberedPinyinToToneMarked(numberedPinyin),
      glosses,
      sourceKey: `${simplified}\t${numberedPinyin}`,
    });
  }

  return entries;
}

export function cedictEntriesToCanonicalWords(entries: CedictEntry[]): CanonicalWord[] {
  return entries.map((entry) => {
    const word = buildCanonicalWord({
      hanzi: entry.simplified,
      traditional: entry.traditional,
      pinyin: entry.toneMarkedPinyin,
      meanings: entry.glosses,
    });

    word.mergeStatus = 'cc-cedict-exact';
    word.sourceKeys['cc-cedict'] = canonicalJoinKey(entry.simplified, entry.toneMarkedPinyin);
    return word;
  });
}

export function numberedPinyinToToneMarked(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .map(convertSyllable)
    .join(' ');
}

function convertSyllable(rawSyllable: string): string {
  let syllable = rawSyllable.toLowerCase().replace(/u:/g, 'ü').replace(/v/g, 'ü');
  const toneMatch = syllable.match(/([0-5])$/);

  if (!toneMatch) {
    return syllable;
  }

  const tone = Number.parseInt(toneMatch[1], 10);
  syllable = syllable.slice(0, -1);

  if (tone === 5 || tone === 0) {
    return syllable;
  }

  const vowelIndex = findToneVowelIndex(syllable);
  if (vowelIndex === -1) {
    return syllable;
  }

  const vowel = syllable[vowelIndex];
  const replacements = TONE_VOWELS[vowel];

  if (!replacements) {
    return syllable;
  }

  return `${syllable.slice(0, vowelIndex)}${replacements[tone]}${syllable.slice(vowelIndex + 1)}`;
}

function findToneVowelIndex(syllable: string): number {
  for (const vowel of ['a', 'e']) {
    const index = syllable.indexOf(vowel);
    if (index !== -1) {
      return index;
    }
  }

  const ouIndex = syllable.indexOf('ou');
  if (ouIndex !== -1) {
    return ouIndex;
  }

  for (let index = syllable.length - 1; index >= 0; index -= 1) {
    if ('iouü'.includes(syllable[index])) {
      return index;
    }
  }

  return -1;
}
