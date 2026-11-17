import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  readBooleanArgument,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'incoming-db', 'confirm-disposable-rc-data']);
const dataDir = path.resolve(requireArgument(args, 'data-dir'));
const incomingDb = path.resolve(requireArgument(args, 'incoming-db'));
const targetDb = path.join(dataDir, 'app.db');
const previousDb = path.join(dataDir, 'rc-previous-app.db');

if (process.env.APP_DEPLOYMENT_TIER !== 'release_candidate') {
  throw new Error('RC database promotion requires APP_DEPLOYMENT_TIER=release_candidate.');
}
if (!readBooleanArgument(args, 'confirm-disposable-rc-data')) {
  throw new Error('RC database promotion requires --confirm-disposable-rc-data=true.');
}
if (!path.isAbsolute(requireArgument(args, 'data-dir'))) throw new Error('--data-dir must be absolute.');
if (!path.isAbsolute(requireArgument(args, 'incoming-db'))) throw new Error('--incoming-db must be absolute.');
if (!incomingDb.startsWith(`${dataDir}${path.sep}`) || incomingDb === targetDb || incomingDb === previousDb) {
  throw new Error('--incoming-db must be a staging file inside --data-dir.');
}
if (!fs.statSync(incomingDb).isFile()) throw new Error('--incoming-db must name an existing file.');

for (const filePath of [
  path.join(dataDir, 'litestream.sock'),
  `${targetDb}-journal`,
  `${incomingDb}-wal`,
  `${incomingDb}-shm`,
  `${incomingDb}-journal`,
]) {
  if (fs.existsSync(filePath)) {
    throw new Error(`RC database promotion requires stopped processes and no SQLite sidecars: ${filePath}`);
  }
}

// This stopped, explicitly disposable RC database is about to be retired.
// Normalize its retained WAL through SQLite so the previous copy remains
// coherent. Never discard a WAL by unlinking it or move the main file alone.
if (fs.existsSync(`${targetDb}-wal`) || fs.existsSync(`${targetDb}-shm`)) {
  if (!fs.existsSync(targetDb)) throw new Error('RC sidecars exist without their database.');
  const retiring = new DatabaseSync(targetDb);
  try {
    const result = retiring.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (result?.busy !== 0) throw new Error('RC database is still busy; keep processes stopped before promotion.');
  } finally { retiring.close(); }
  if (fs.existsSync(`${targetDb}-wal`) || fs.existsSync(`${targetDb}-shm`)) {
    throw new Error('RC SQLite sidecars remain after close; investigate active connections before promotion.');
  }
}

if (fs.existsSync(previousDb)) fs.unlinkSync(previousDb);
let previousMoved = false;
try {
  if (fs.existsSync(targetDb)) {
    fs.renameSync(targetDb, previousDb);
    previousMoved = true;
  }
  fs.renameSync(incomingDb, targetDb);
} catch (error) {
  if (previousMoved && !fs.existsSync(targetDb) && fs.existsSync(previousDb)) {
    fs.renameSync(previousDb, targetDb);
  }
  throw error;
}

console.log(JSON.stringify({
  status: 'promoted',
  targetDatabase: targetDb,
  previousDatabaseRetained: previousMoved ? previousDb : null,
}, null, 2));
