import { z } from 'zod';

// One lexical entry groups senses of one reading. Written forms can share entries
// (e.g. 還 and 还), and the same form can name entries with different readings.
const text = z.string().trim().min(1);
const catalogSchema = z.array(z.strictObject({
  wordId: text, forms: z.array(text).min(1), pinyin: text,
  senses: z.array(z.strictObject({ senseId: text, label: text, notes: z.array(text).optional() })),
}));

export type ReaderSense = {
  wordId: string; senseId: string; pinyin: string; label: string; notes?: readonly string[];
};

export function createReaderCatalog(source: unknown) {
  const byForm = new Map<string, ReaderSense[]>();
  const words = new Set<string>();
  const senses = new Set<string>();
  for (const entry of catalogSchema.parse(source)) {
    if (words.has(entry.wordId)) throw new Error('Duplicate reader word ID ' + entry.wordId);
    words.add(entry.wordId);
    const candidates = entry.senses.map(sense => {
      if (senses.has(sense.senseId)) throw new Error('Duplicate reader sense ID ' + sense.senseId);
      senses.add(sense.senseId);
      return { ...sense, wordId: entry.wordId, pinyin: entry.pinyin };
    });
    for (const form of new Set(entry.forms)) {
      const existing = byForm.get(form);
      if (existing) existing.push(...candidates);
      else byForm.set(form, [...candidates]);
    }
  }
  return { sensesFor(form: string): readonly ReaderSense[] { return byForm.get(form) ?? []; } };
}
