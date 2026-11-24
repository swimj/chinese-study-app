import { readFileSync } from 'node:fs';
import { parseCedictFile, type CedictEntry } from '../../scripts/lib/cc-cedict.ts';

export type LookupInput = { kind: 'tap' | 'selection'; text: string; start: number; end: number };
export type LookupAnswer = { span: string; pinyin: string; gloss: string; chunks?: string[] };
export type LocalResult = { answer: LookupAnswer | null; reason: string; occurrence?: { text: string; start: number; end: number } };
type Dictionary = { byForm: Map<string, CedictEntry[]>; maxLength: number; hasForm(form: string): boolean };

export function loadDictionary(path: string): Dictionary {
  const byForm = new Map<string, CedictEntry[]>();
  let maxLength = 0;
  for (const entry of parseCedictFile(readFileSync(path, 'utf8'))) {
    for (const form of new Set([entry.simplified, entry.traditional])) {
      const entries = byForm.get(form);
      if (entries) entries.push(entry);
      else byForm.set(form, [entry]);
      maxLength = Math.max(maxLength, Array.from(form).length);
    }
  }
  if (!byForm.size) throw new Error(`No CC-CEDICT entries found in ${path}`);
  return { byForm, maxLength, hasForm: form => byForm.has(form) };
}

// Share the loaded CC-CEDICT entries across catalog revisions. Additional forms
// participate in segmentation without acquiring invented dictionary glosses.
export function withCatalogForms(dictionary: Dictionary, forms: Iterable<string>): Dictionary {
  const catalog = new Set(forms);
  let maxLength = dictionary.maxLength;
  for (const form of catalog) maxLength = Math.max(maxLength, [...form].length);
  return { byForm: dictionary.byForm, maxLength, hasForm: form => catalog.has(form) || dictionary.byForm.has(form) };
}

const han = /^\p{Script=Han}$/u;
const hanRun = /^\p{Script=Han}+$/u;
const cutsSurrogate = (text: string, offset: number) =>
  /[\uD800-\uDBFF]/.test(text.charAt(offset - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(offset));

// Segment the contiguous Han run from each end. Unknown characters consume one
// code point; they can establish a boundary but cannot produce a local answer.
function tokenAt(dictionary: Dictionary, chars: string[], target: number, direction: 1 | -1) {
  let cursor = target;
  while (han.test(chars[cursor - direction] ?? '')) cursor -= direction;
  let remaining = 1;
  while (han.test(chars[cursor + remaining * direction] ?? '')) remaining++;
  while (remaining > 0) {
    let length = Math.min(dictionary.maxLength, remaining);
    let start: number;
    let end: number;
    while (true) {
      start = direction === 1 ? cursor : cursor - length + 1;
      end = start + length;
      if (length === 1 || dictionary.hasForm(chars.slice(start, end).join(''))) break;
      length--;
    }
    if (start <= target && target < end) return { start, end };
    cursor += length * direction;
    remaining -= length;
  }
  throw new Error('Target escaped its Han run');
}

function resolveEntry(entries: CedictEntry[], span: string): LocalResult {
  const readings = new Set(entries.map(entry => entry.toneMarkedPinyin));
  if (readings.size !== 1) return { answer: null, reason: 'multiple-readings' };
  const glosses = new Set(entries.flatMap(entry => entry.glosses).filter(gloss => !/^CL:/.test(gloss)));
  if (glosses.size !== 1) return { answer: null, reason: 'multiple-or-missing-glosses' };
  const [gloss] = glosses;
  // A cross-reference or a bound form needs another lookup or its host word.
  if (/^(?:see\b|(?:.*?\s)?variant of\b|(?:abbr\.|abbreviation) (?:for|of)\b|\(bound form\))/i.test(gloss)) {
    return { answer: null, reason: 'dictionary-reference-or-bound-form' };
  }
  return { answer: { span, pinyin: entries[0].toneMarkedPinyin, gloss }, reason: 'single-reading-and-gloss' };
}

export function lookupLocal(dictionary: Dictionary, input: LookupInput): LocalResult {
  const { kind, text, start, end } = input;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end ||
      cutsSurrogate(text, start) || cutsSurrogate(text, end)) throw new RangeError('Invalid UTF-16 target range');
  const selected = text.slice(start, end);
  if (kind === 'tap' && Array.from(selected).length !== 1) throw new RangeError('Tap must target one code point');
  if (kind === 'tap' && !han.test(selected)) return { answer: null, reason: 'non-han-tap' };
  if (kind === 'selection' && !dictionary.hasForm(selected)) return { answer: null, reason: 'no-exact-entry' };

  let span = selected;
  let spanStart = start;
  if (hanRun.test(selected)) {
    const chars = Array.from(text);
    const target = Array.from(text.slice(0, start)).length;
    const forward = tokenAt(dictionary, chars, target, 1);
    const backward = tokenAt(dictionary, chars, target, -1);
    if (forward.start !== backward.start || forward.end !== backward.end) {
      return { answer: null, reason: 'competing-boundaries' };
    }
    span = chars.slice(forward.start, forward.end).join('');
    spanStart = start - chars.slice(forward.start, target).join('').length;
    if (kind === 'selection' && (forward.start !== target || selected !== span)) {
      return { answer: null, reason: 'selection-crosses-word-boundary' };
    }
  }
  const entries = dictionary.byForm.get(span);
  if (!dictionary.hasForm(span)) return { answer: null, reason: 'no-dictionary-entry' };
  const occurrence = { text, start: spanStart, end: spanStart + span.length };
  if (!entries) return { answer: null, reason: 'catalog-form', occurrence };
  return { ...resolveEntry(entries, span), occurrence };
}
