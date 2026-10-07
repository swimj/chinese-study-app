import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDbConnection, setDb } from '../server/db/connection.ts';
import { assertSchemaCurrent } from '../server/db/migrations.ts';
import { listWhatsNewPosts, saveWhatsNewPost } from '../server/db/whats-new.ts';
import {
  configureHostedDatabase,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'actor-id', 'input', 'list']);
const dataDir = configureHostedDatabase(args);
const listOnly = args.has('list');
if (listOnly && args.get('list') !== 'true') throw new Error('--list must be true.');
if (listOnly && (args.has('input') || args.has('actor-id'))) {
  throw new Error('Pass either --list=true or --input=... and --actor-id=....');
}
const actorId = listOnly ? null : requireArgument(args, 'actor-id');
let input: unknown;
if (!listOnly) {
  const inputPath = requireArgument(args, 'input');
  if (!path.isAbsolute(inputPath)) throw new Error('--input must be an absolute path.');
  if (!fs.statSync(inputPath).isFile()) throw new Error('--input must name a JSON file.');
  input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}

// Open only the explicit, existing target. Importing the application barrel
// would initialize bootstrap state and learner/provider runtime machinery.
const databasePath = path.join(dataDir, 'app.db');
if (!fs.statSync(databasePath).isFile()) throw new Error('--data-dir must contain an existing app.db file.');
const database = new DatabaseSync(databasePath, { readOnly: listOnly });
setDb(database);
try {
  database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  assertSchemaCurrent(database);
  const result = listOnly
    ? { posts: listWhatsNewPosts({ includeDrafts: true }) }
    : { post: saveWhatsNewPost(input, actorId!) };
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDbConnection();
}
