export type SourceTag = 'subtlex' | 'cc-cedict' | 'tatoeba' | 'hack-chinese';

export type CanonicalWord = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyinDisplay: string;
  pinyinNormalized: string;
  pinyinSearch: string;
  meaning: string;
  meanings: string[];
  frequencyRank: number | null;
  frequencyScore: number | null;
  priority: number | null;
  exampleSentenceIds: number[];
  posFrequency: Array<{ pos: string; count: number }>;
  mergeStatus: 'seed' | 'cc-cedict-exact' | 'cc-cedict-neutral-fallback' | 'hack-only';
  sourceKeys: Partial<Record<SourceTag, string>>;
};

export type CanonicalWordSeed = {
  hanzi: string;
  traditional?: string | null;
  pinyin: string;
  meanings: string[];
};

const COMBINING_MARKS_REGEX = /[\u0300-\u036f]/g;
const WHITESPACE_REGEX = /\s+/g;
const TONE_MARK_REGEX = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;

export function normalizeToneMarkedPinyin(input: string): string {
  return input
    .normalize('NFC')
    .trim()
    .replace(WHITESPACE_REGEX, ' ')
    .toLowerCase();
}

export function stripPinyinTones(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS_REGEX, '')
    .replace(WHITESPACE_REGEX, ' ')
    .trim()
    .toLowerCase();
}

export function canonicalJoinKey(hanzi: string, toneMarkedPinyin: string): string {
  return `${hanzi.trim()}\t${normalizeToneMarkedPinyin(toneMarkedPinyin)}`;
}

export function fuzzyJoinKey(hanzi: string, toneMarkedPinyin: string): string {
  return `${hanzi.trim()}\t${stripPinyinTones(toneMarkedPinyin)}`;
}

export function splitPinyinSyllables(input: string): string[] {
  return normalizeToneMarkedPinyin(input)
    .replace(/'/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function hasExplicitToneMark(input: string): boolean {
  return TONE_MARK_REGEX.test(input.normalize('NFC'));
}

export function canMatchByNeutralToneFallback(a: string, b: string): boolean {
  const aSyllables = splitPinyinSyllables(a);
  const bSyllables = splitPinyinSyllables(b);

  if (aSyllables.length !== bSyllables.length) {
    return false;
  }

  let usedFallback = false;

  for (let index = 0; index < aSyllables.length; index += 1) {
    const left = aSyllables[index];
    const right = bSyllables[index];

    if (left === right) {
      continue;
    }

    if (stripPinyinTones(left) !== stripPinyinTones(right)) {
      return false;
    }

    const leftHasTone = hasExplicitToneMark(left);
    const rightHasTone = hasExplicitToneMark(right);

    if (leftHasTone === rightHasTone) {
      return false;
    }

    usedFallback = true;
  }

  return usedFallback;
}

export function makeCanonicalWordId(hanzi: string, toneMarkedPinyin: string): string {
  const normalizedPinyin = normalizeToneMarkedPinyin(toneMarkedPinyin);
  const pinyinSlug = normalizedPinyin.replaceAll(' ', '_');
  return `cw:${hanzi}:${pinyinSlug}`;
}

export function buildCanonicalWord(seed: CanonicalWordSeed): CanonicalWord {
  const pinyinDisplay = seed.pinyin.trim();
  const pinyinNormalized = normalizeToneMarkedPinyin(pinyinDisplay);

  return {
    id: makeCanonicalWordId(seed.hanzi, pinyinDisplay),
    hanzi: seed.hanzi.trim(),
    traditional: seed.traditional?.trim() ?? null,
    pinyinDisplay,
    pinyinNormalized,
    pinyinSearch: stripPinyinTones(pinyinDisplay),
    meaning: seed.meanings[0] ?? '',
    meanings: [...new Set(seed.meanings.map((meaning) => meaning.trim()).filter(Boolean))],
    frequencyRank: null,
    frequencyScore: null,
    priority: null,
    exampleSentenceIds: [],
    posFrequency: [],
    mergeStatus: 'seed',
    sourceKeys: {},
  };
}
