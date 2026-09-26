import fs from 'node:fs';
import path from 'node:path';
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
  `${targetDb}-wal`,
  `${targetDb}-shm`,
  `${targetDb}-journal`,
  `${incomingDb}-wal`,
  `${incomingDb}-shm`,
  `${incomingDb}-journal`,
]) {
  if (fs.existsSync(filePath)) {
    throw new Error(`RC database promotion requires stopped processes and no SQLite sidecars: ${filePath}`);
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
