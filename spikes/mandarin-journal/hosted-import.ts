// Brings one learner's hosted-app vocabulary into a journal as targets. Only a
// summary per word comes across: schedule, recall counts and recent wrong
// answers. The hosted app's single-word recall is SRS evidence, a weaker input
// to priority than what the learner does in the journal.
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createRecordTables, setMeta, upsertTarget } from './record.ts';
import { copyPath, fixturePath, isPrimaryCheckout, livePath } from './storage.ts';

const nullable = z.string().nullable();
export const hostedExportSchema = z.object({
  exportedAt: z.string(),
  learner: z.string(),
  words: z.array(
    z.object({
      hanzi: z.string().min(1),
      pinyin: nullable,
      meaning: nullable,
      mode: z.string(),
      inStash: z.boolean(),
      dismissedAt: nullable,
      addedAt: nullable,
      lastPractisedAt: nullable,
      dueAt: nullable,
      intervalHours: z.number().nullable(),
      attempts: z.number().int(),
      incorrect: z.number().int(),
      lastIncorrectAt: nullable,
      recentMistakes: z.array(z.string()),
    }),
  ),
});
export type HostedExport = z.infer<typeof hostedExportSchema>;

export function importHosted(db: DatabaseSync, data: HostedExport) {
  createRecordTables(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const w of data.words)
      upsertTarget(db, {
        form: w.hanzi,
        gloss: w.meaning,
        pinyin: w.pinyin,
        origin: 'imported',
        at: data.exportedAt,
        hosted: {
          mode: w.mode,
          inStash: w.inStash,
          dismissed: !!w.dismissedAt,
          addedAt: w.addedAt,
          lastPractisedAt: w.lastPractisedAt,
          dueAt: w.dueAt,
          intervalHours: w.intervalHours,
          attempts: w.attempts,
          incorrect: w.incorrect,
          lastIncorrectAt: w.lastIncorrectAt,
          recentMistakes: w.recentMistakes,
        },
      });
    setMeta(db, 'hosted_import', JSON.stringify({ exportedAt: data.exportedAt, learner: data.learner, words: data.words.length }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { words: data.words.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const checkout = dirname(fileURLToPath(import.meta.url));
  const file = args.find((a) => !a.startsWith('--'));
  try {
    if (!file) throw new Error('Usage: npm run journal:import-hosted -- <export.json> [--copy | --live]');
    const path = process.env.JOURNAL_DB ?? (args.includes('--live') ? livePath() : args.includes('--copy') ? copyPath(checkout) : fixturePath(checkout));
    if (args.includes('--live') && !isPrimaryCheckout(checkout))
      throw new Error('Import into the live journal from the primary checkout. Use --copy in a worktree.');
    const data = hostedExportSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=5000');
    try {
      const { words } = importHosted(db, data);
      console.log(`Imported ${words} words from ${data.learner} (exported ${data.exportedAt}) into ${path}.`);
    } finally {
      db.close();
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
