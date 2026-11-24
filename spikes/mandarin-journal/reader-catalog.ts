import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const text = z.string().trim().min(1);
const entrySchema = z.strictObject({
  wordId: text, forms: z.array(text).min(1), pinyin: text,
  senses: z.array(z.strictObject({ senseId: text, label: text, notes: z.array(text).optional() })),
});
const entriesSchema = z.array(entrySchema);
export type WordEntry = z.infer<typeof entrySchema>;
export type ReaderSense = {
  wordId: string; senseId: string; pinyin: string; label: string; notes?: readonly string[];
};

export function createReaderCatalog(source: unknown) {
  const entries = entriesSchema.parse(source);
  const byForm = new Map<string, ReaderSense[]>();
  const words = new Set<string>();
  const senses = new Set<string>();
  for (const entry of entries) {
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
  const forms: ReadonlySet<string> = new Set(byForm.keys());
  const hash = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  return { forms, hash, sensesFor(form: string): readonly ReaderSense[] { return byForm.get(form) ?? []; } };
}

const receiptSchema = z.strictObject({
  decisionId: text, previousDecisionId: text.optional(), outcome: z.enum(['linked', 'added', 'occurrence']),
  senseId: text.nullable(), reason: text, judgedAt: z.iso.datetime(), flagged: z.boolean(),
  model: text.nullable(), promptHash: text.nullable(), instantMatch: z.boolean().optional(),
});
export type GrowthReceipt = z.infer<typeof receiptSchema>;

const fileSchema = z.strictObject({
  version: z.literal(1), entries: entriesSchema, receipts: z.array(receiptSchema),
});
type CatalogFile = z.infer<typeof fileSchema>;
export type GrowthChoice =
  | { kind: 'link'; senseId: string; reason: string }
  | { kind: 'add'; pinyin: string; label: string; notes: string[]; reason: string }
  | { kind: 'occurrence'; reason: string };

function readCatalog(file: CatalogFile, seed: WordEntry[]) {
  const all = new Map(seed.map(entry => [entry.wordId, { ...entry, senses: [...entry.senses] }]));
  const learned = new Set<string>();
  for (const entry of file.entries) {
    if (learned.has(entry.wordId)) throw new Error('Duplicate learned word ID ' + entry.wordId);
    learned.add(entry.wordId);
    const existing = all.get(entry.wordId);
    if (existing) {
      if (entry.pinyin !== existing.pinyin || JSON.stringify(entry.forms) !== JSON.stringify(existing.forms)) {
        throw new Error('Learned extension conflicts with seed word ' + entry.wordId);
      }
      existing.senses.push(...entry.senses);
    } else all.set(entry.wordId, entry);
  }
  const entries = [...all.values()];
  const inventory = createReaderCatalog(entries);
  const allIds = new Set(entries.flatMap(entry => entry.senses.map(sense => sense.senseId)));
  const visible = new Set(seed.flatMap(entry => entry.senses.map(sense => sense.senseId)));
  const superseded = new Set(file.receipts.filter(receipt => !receipt.flagged).map(receipt => receipt.previousDecisionId).filter(Boolean));
  const receipts = new Map<string, GrowthReceipt>();
  for (const receipt of file.receipts) {
    if (receipts.has(receipt.decisionId)) throw new Error('Duplicate catalog decision ' + receipt.decisionId);
    if (receipt.senseId !== null && !allIds.has(receipt.senseId)) throw new Error('Unknown sense in catalog receipt');
    receipts.set(receipt.decisionId, receipt);
    // Showing a previously learned label again is a link, but supplies no new linguistic evidence.
    if (receipt.senseId && !receipt.instantMatch && !receipt.flagged && !superseded.has(receipt.decisionId)) visible.add(receipt.senseId);
  }
  const snapshot = visible.size === allIds.size ? inventory : createReaderCatalog(entries.map(entry => ({
    ...entry, senses: entry.senses.filter(sense => visible.has(sense.senseId)),
  })).filter(entry => entry.senses.length));
  return { entries, inventory, receipts, snapshot };
}

const readingKey = (value: string) => value.normalize('NFC').toLowerCase().replace(/[\s’']/gu, '');

function addSense(file: CatalogFile, entries: WordEntry[], form: string, choice: Extract<GrowthChoice, {kind:'add'}>) {
  const matches = entries.filter(entry => entry.forms.includes(form) && readingKey(entry.pinyin) === readingKey(choice.pinyin));
  if (matches.length > 1) throw new Error('Ambiguous catalog entry for ' + form);
  const word = matches[0];
  const duplicate = word?.senses.find(sense => sense.label.toLowerCase() === choice.label.trim().toLowerCase());
  if (duplicate) return { outcome: 'linked', senseId: duplicate.senseId } as const;
  let extension = word && file.entries.find(entry => entry.wordId === word.wordId);
  if (!extension) {
    extension = { wordId: word?.wordId ?? randomUUID(), forms: word?.forms ?? [form], pinyin: word?.pinyin ?? choice.pinyin, senses: [] };
    file.entries.push(extension);
  }
  const senseId = randomUUID();
  extension.senses.push({ senseId, label: choice.label, notes: choice.notes });
  return { outcome: 'added', senseId } as const;
}

type DecisionIdentity = { id: string; feedback: object | null };
type CatalogCommit = {
  id: string; previousDecisionId?: string; form: string; choice: GrowthChoice;
  instantMatch: boolean; expectedHash: string; flagged: () => boolean; model: string | null; promptHash: string | null;
};

export function openReaderCatalog(databasePath: string) {
  const path = databasePath + '.catalog.json';
  const seed = entriesSchema.parse(JSON.parse(readFileSync(new URL('./lookup-experiment/sense-catalog.sample.json', import.meta.url), 'utf8')));
  let cached: { stamp: string; file: CatalogFile; view: ReturnType<typeof readCatalog> } | undefined;

  function current() {
    const stat = statSync(path, { bigint: true, throwIfNoEntry: false });
    // Every publication is a rename. A reader in another process sees either complete snapshot.
    const stamp = stat ? [stat.ino, stat.mtimeNs, stat.size].join('/') : 'absent';
    if (!cached || cached.stamp !== stamp) {
      const file = stat ? fileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) :
        { version: 1 as const, entries: [], receipts: [] };
      cached = { stamp, file, view: readCatalog(file, seed) };
    }
    return cached;
  }

  function publish(file: CatalogFile) {
    const persisted = fileSchema.parse(file);
    readCatalog(persisted, seed);
    const temp = path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temp, JSON.stringify(persisted, null, 2) + '\n', { mode: 0o600, flag: 'wx', flush: true });
      renameSync(temp, path);
    } finally {
      if (statSync(temp, { throwIfNoEntry: false })) unlinkSync(temp);
    }
    cached = undefined;
  }

  return {
    path,
    snapshot: () => current().view.snapshot,
    entries: () => structuredClone(current().view.entries),
    receipts: () => structuredClone(current().file.receipts),
    receipt: (id: string) => current().view.receipts.get(id),
    needsDecision(row: DecisionIdentity) {
      const receipt = current().view.receipts.get(row.id);
      return !receipt || (!!row.feedback && !receipt.flagged);
    },
    // The journal's short SQLite write lock serializes JSON publication across processes
    // and is released by the OS on exit. No journal schema or data lives in this transaction.
    // Model judgment runs before acquiring it and retries against a changed inventory.
    commit(input: CatalogCommit): GrowthReceipt | 'retry' {
      const db = new DatabaseSync(databasePath);
      try {
        db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
        const { file, view } = current();
        const flagged = input.flagged();
        const existing = view.receipts.get(input.id);
        if (existing && (!flagged || existing.flagged)) return existing;
        const next = structuredClone(file);
        if (existing) {
          const updated = { ...existing, flagged: true };
          next.receipts[next.receipts.findIndex(r => r.decisionId === input.id)] = updated;
          publish(next);
          return updated;
        }

        if (!flagged && view.snapshot.hash !== input.expectedHash) return 'retry';
        const { choice } = input;
        let outcome: GrowthReceipt['outcome'] = 'occurrence';
        let senseId: string | null = null;
        if (!flagged && choice.kind === 'link') {
          if (!view.inventory.sensesFor(input.form).some(sense => sense.senseId === choice.senseId)) {
            throw new Error('Cannot link an unknown reader sense for this form');
          }
          outcome = 'linked';
          senseId = choice.senseId;
        } else if (!flagged && choice.kind === 'add') {
          ({ outcome, senseId } = addSense(next, view.entries, input.form, choice));
        }
        const receipt: GrowthReceipt = { decisionId: input.id,
          ...(input.previousDecisionId && !flagged ? { previousDecisionId: input.previousDecisionId } : {}),
          ...(input.instantMatch && { instantMatch: true }),
          outcome, senseId, reason: flagged ? 'Reader flagged this answer.' : choice.reason,
          flagged, judgedAt: new Date().toISOString(), model: input.model, promptHash: input.promptHash };
        next.receipts.push(receipt);
        publish(next);
        return receipt;
      } finally {
        db.close();
      }
    },
  };
}
export type ReaderCatalogStore = ReturnType<typeof openReaderCatalog>;
