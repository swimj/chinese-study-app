import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dataDir = readRequiredFixtureDataDir();
const dbPath = path.join(dataDir, 'app.db');

fs.mkdirSync(dataDir, { recursive: true });
if (fs.existsSync(dbPath)) {
  fs.rmSync(dbPath);
}

process.env.APP_MODE = 'dev';
process.env.APP_DATA_DIR = dataDir;
process.env.APP_SEED_DATA_PATH = path.resolve('server/seeds/reflection-dev.json');
process.env.APP_INCLUDE_DEV_CONTRAST_SEED = 'false';

await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?reflection-reset=${Date.now()}`);

console.log(JSON.stringify({ reset: true, dataDir, dbPath }));

function readRequiredFixtureDataDir(): string {
  const argument = process.argv.find((value) => value.startsWith('--data-dir='));
  const rawDataDir = argument?.slice('--data-dir='.length);
  if (!rawDataDir) {
    throw new Error('Expected --data-dir=/absolute/path for the disposable reflection verification database.');
  }

  const resolved = path.resolve(rawDataDir);
  const normalDevDataDir = path.resolve('data');
  if (resolved === normalDevDataDir || resolved === process.cwd()) {
    throw new Error('Refusing to reset the default or workspace data directory. Use a dedicated fixture directory.');
  }

  return resolved;
}
