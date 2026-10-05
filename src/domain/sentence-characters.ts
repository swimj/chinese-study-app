import { ConverterBuilder } from 'opencc-js/core';
import compatibilityIdeographs from 'opencc-js/dict/CJK_Compatibility_Ideographs';
import simplifiedCharacters from 'opencc-js/dict/STCharacters';
import simplifiedPhrases from 'opencc-js/dict/STPhrases';
import generatedPhrases from 'opencc-js/dict/STPhrases_GeneratedFromRegionalPhrases';
import traditionalCharacters from 'opencc-js/dict/TSCharacters';
import traditionalPhrases from 'opencc-js/dict/TSPhrases';
import taiwanVariants from 'opencc-js/dict/TWVariants';
import taiwanVariantPhrases from 'opencc-js/dict/TWVariantsPhrases';
import reversedTaiwanVariants from 'opencc-js/dict/TWVariantsRev';
import reversedTaiwanVariantPhrases from 'opencc-js/dict/TWVariantsRevPhrases';
import {
  DEFAULT_SENTENCE_CHARACTER_PRESENTATION,
  type CardCharacterForms,
  type CharacterPresentation,
  type SentenceCharacterPresentation,
} from './card-characters';

export { DEFAULT_SENTENCE_CHARACTER_PRESENTATION };
export type { SentenceCharacterPresentation };

// The pinned OpenCC 1.4.2 tw2s/s2tw presets, with only their required data.
// Keep normalization and segmentation identical to the published full preset.
const sentencePreset = {
  from: {
    cn: [[simplifiedPhrases, simplifiedCharacters]],
    tw: [[reversedTaiwanVariantPhrases, reversedTaiwanVariants]],
  },
  to: {
    cn: [[traditionalPhrases, traditionalCharacters]],
    tw: [[taiwanVariantPhrases, taiwanVariants]],
  },
  configs: {
    tw2s: {
      normalizationChain: [[compatibilityIdeographs]],
      segmentation: [traditionalPhrases],
      conversionChain: [
        [reversedTaiwanVariantPhrases, reversedTaiwanVariants],
        [traditionalPhrases, traditionalCharacters],
      ],
    },
    s2tw: {
      normalizationChain: [[compatibilityIdeographs]],
      segmentation: [simplifiedPhrases, generatedPhrases],
      conversionChain: [
        [simplifiedPhrases, generatedPhrases, simplifiedCharacters],
        [taiwanVariantPhrases, taiwanVariants],
      ],
    },
  },
};
const Converter = ConverterBuilder(sentencePreset);
const toSimplified = Converter({ from: 'tw', to: 'cn' });
// `tw` uses Taiwan glyph conventions; `twp` would also replace vocabulary.
const toTraditional = Converter({ from: 'cn', to: 'tw' });

export function effectiveSentenceCharacterPresentation(
  main: CharacterPresentation,
  preference: SentenceCharacterPresentation = DEFAULT_SENTENCE_CHARACTER_PRESENTATION,
): SentenceCharacterPresentation {
  return main === 'both' ? preference : main;
}

export function sentenceCharacterLanguage(script: SentenceCharacterPresentation): 'zh-Hans' | 'zh-Hant' {
  return script === 'simplified' ? 'zh-Hans' : 'zh-Hant';
}

/** Normalize a display copy, including mixed sources, without changing authored records. */
export function convertSentenceCharacters(text: string, script: SentenceCharacterPresentation): string {
  const convert = (part: string): string => {
    const simplified = toSimplified(part);
    return script === 'simplified' ? simplified : toTraditional(simplified);
  };
  // Equivalent forms joined by a comparison separator or explicitly labeled
  // Simplified/Traditional are instructional content: preserve both forms.
  // Unrelated alternatives and ordinary quoted Chinese still follow preference.
  const comparison = /(\p{Script=Han}+)[\t ]*(?:\/|→|↔|\bvs\b\.?|\bversus\b)[\t ]*(\p{Script=Han}+)/giu;
  const labeledComparison = /\b(Simplified|Traditional)\b[^\p{Script=Han}\n]*?(\p{Script=Han}+)[^\p{Script=Han}\n]*?\b(Simplified|Traditional)\b[^\p{Script=Han}\n]*?(\p{Script=Han}+)/giu;
  const protectedRanges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(comparison)) {
    if (match[1] !== match[2] && toSimplified(match[1]) === toSimplified(match[2])) {
      protectedRanges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  for (const match of text.matchAll(labeledComparison)) {
    if (match[1].toLowerCase() !== match[3].toLowerCase()
      && match[2] !== match[4] && toSimplified(match[2]) === toSimplified(match[4])) {
      protectedRanges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  protectedRanges.sort((left, right) => left.start - right.start);
  let cursor = 0;
  let result = '';
  for (const range of protectedRanges) {
    if (range.end <= cursor) continue;
    result += convert(text.slice(cursor, Math.max(cursor, range.start)))
      + text.slice(Math.max(cursor, range.start), range.end);
    cursor = range.end;
  }
  return result + convert(text.slice(cursor));
}

/** Preserve the lexical answer when an ambiguous character has a stored traditional form. */
export function formatSentenceAnswer(forms: CardCharacterForms, script: SentenceCharacterPresentation): string {
  if (script === 'traditional' && forms.traditional?.trim()) return forms.traditional.trim();
  return convertSentenceCharacters(forms.hanzi, script);
}

/**
 * Convert the completed sentence so the converter can see phrase context across
 * blanks, then retain the canonical lexical answer at each insertion. Alignment
 * counts Unicode characters, never reuses stored source offsets on converted text.
 */
export function convertClozeParts(
  parts: readonly string[],
  answer: string | null,
  script: SentenceCharacterPresentation,
  contextAnswer?: string,
): { parts: string[]; answer: string | null } {
  const lexicalAnswer = answer ?? contextAnswer;
  if (!lexicalAnswer || parts.length < 2) {
    return {
      parts: parts.map((part) => convertSentenceCharacters(part, script)),
      answer,
    };
  }
  const completed = parts.join(lexicalAnswer);
  const converted = Array.from(convertSentenceCharacters(completed, script));
  // No vocabulary substitutions are enabled, so ordinary mappings preserve
  // character counts. Rare external mappings that change length must not shift
  // a blank; convert each visible fragment separately in that case.
  if (converted.length !== Array.from(completed).length) {
    return { parts: parts.map((part) => convertSentenceCharacters(part, script)), answer };
  }
  const answerLength = Array.from(lexicalAnswer).length;
  let cursor = 0;
  return {
    parts: parts.map((part, index) => {
      if (index > 0) cursor += answerLength;
      const end = cursor + Array.from(part).length;
      const result = converted.slice(cursor, end).join('');
      cursor = end;
      return result;
    }),
    answer,
  };
}
