import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  readNonNegativeIntegerArgument,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';

const args = readStrictArguments(['database', 'minimum-learners', 'minimum-sentinels']);
const rawDatabase = requireArgument(args, 'database');
if (!path.isAbsolute(rawDatabase)) throw new Error('--database must be absolute.');
if (process.env.APP_DEPLOYMENT_TIER !== 'release_candidate') {
  throw new Error('RC source verification requires APP_DEPLOYMENT_TIER=release_candidate.');
}
const database = path.resolve(rawDatabase);
if (!fs.statSync(database).isFile()) throw new Error('--database must name an existing database file.');
const minimumLearners = readNonNegativeIntegerArgument(args, 'minimum-learners', 2);
const minimumSentinels = readNonNegativeIntegerArgument(args, 'minimum-sentinels', 1);

const db = new DatabaseSync(database, { readOnly: true });
try {
  const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error('Restored RC source failed SQLite integrity_check.');
  }
  const foreignKeyFailures = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyFailures.length > 0) throw new Error('Restored RC source failed foreign_key_check.');
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM learners) AS learnerCount,
      (SELECT COUNT(*) FROM lexical_words) AS sharedWordCount,
      (SELECT COUNT(*) FROM content_imports) AS contentImportCount,
      (SELECT COUNT(*) FROM schema_migrations) AS schemaMigrationCount,
      (SELECT COUNT(*) FROM deployment_sentinels) AS sentinelCount
  `).get() as {
    learnerCount: number;
    sharedWordCount: number;
    contentImportCount: number;
    schemaMigrationCount: number;
    sentinelCount: number;
  };
  if (counts.learnerCount < minimumLearners) {
    throw new Error(`Restored RC source has ${counts.learnerCount} learners; expected at least ${minimumLearners}.`);
  }
  if (counts.sharedWordCount === 0) throw new Error('Restored RC source has no shared Mandarin content.');
  if (counts.sentinelCount < minimumSentinels) {
    throw new Error(
      `Restored RC source has ${counts.sentinelCount} deployment sentinels; expected at least ${minimumSentinels}.`,
    );
  }
  console.log(JSON.stringify({
    status: 'valid-source',
    integrityCheck: 'ok',
    foreignKeyCheck: 'ok',
    ...counts,
  }, null, 2));
} finally {
  db.close();
}
