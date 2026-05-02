import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const dbPathArg = args.find((arg) => arg.startsWith('--db-path='));

if (!dbPathArg) {
  throw new Error('Expected --db-path=/absolute/or/relative/path/to.db');
}

const rawDbPath = dbPathArg.slice('--db-path='.length);
const dbPath = path.resolve(rawDbPath);

const db = new DatabaseSync(dbPath);

try {
  const row = db.prepare('SELECT MAX(priority) AS max_priority FROM words').get() as { max_priority: number | null };
  const maxPriority = row.max_priority ?? 0;
  const bumpUnit = Math.ceil(maxPriority * 0.10);

  console.log(JSON.stringify({
    dbPath,
    maxPriority,
    bumpUnit,
  }, null, 2));
} finally {
  db.close();
}
