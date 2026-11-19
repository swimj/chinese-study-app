import { backup, DatabaseSync } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';

const args = readStrictArguments(['database', 'output', 'max-bytes', 'priority']);
const priority = args.get('priority');
if (priority !== undefined && priority !== 'background') throw new Error('--priority must be background when supplied');
// A background capture yields the CPU to the app; it only slows when learners need the CPU.
if (priority === 'background') os.setPriority(os.constants.priority.PRIORITY_LOW);
const database = requireArgument(args, 'database');
const output = requireArgument(args, 'output');
const maxBytes = Number(requireArgument(args, 'max-bytes'));
if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid backup byte limit');
const source = new DatabaseSync(database, { readOnly: true });
const startedAt = new Date().toISOString();
try {
  const pageSize = Number(source.prepare('PRAGMA page_size').get()?.page_size);
  // Pin one WAL read snapshot so ongoing writes cannot repeatedly restart the
  // incremental copy. The worker deadline bounds how long checkpointing waits.
  source.exec('BEGIN');
  source.prepare('SELECT count(*) FROM sqlite_schema').get();
  await backup(source, output, { rate: 256, progress: ({ totalPages }) => {
    if (totalPages * pageSize > maxBytes) throw new Error('Backup exceeds byte limit');
  } });
} finally {
  try { source.exec('ROLLBACK'); } finally { source.close(); }
}
const completedAt = new Date().toISOString();
const bytes = (await stat(output)).size;
if (bytes > maxBytes) throw new Error('Backup exceeds byte limit');
const hash = createHash('sha256');
for await (const chunk of createReadStream(output)) hash.update(chunk);
console.log(JSON.stringify({ startedAt, completedAt, bytes, sha256: hash.digest('hex'), niceness: os.getPriority() }));
