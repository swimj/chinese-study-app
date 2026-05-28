import { copyFileSync, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

const sourceRootArg = process.argv[2];
const relativeDbPath = path.join('data', 'local-user-data', 'app.db');
const targetDir = path.resolve('data/local-user-data');
const targetPath = path.join(targetDir, 'app.db');

if (!sourceRootArg) {
  console.error('Usage: npm run import:local-user-data -- /absolute/path/to/existing/chinese-study-app');
  process.exit(1);
}

const sourceRoot = path.resolve(sourceRootArg);
const sourcePath = path.join(sourceRoot, relativeDbPath);

if (!existsSync(sourceRoot)) {
  console.error(`Existing app folder not found: ${sourceRoot}`);
  process.exit(1);
}

if (!statSync(sourceRoot).isDirectory()) {
  console.error(`Expected an existing app folder, got: ${sourceRoot}`);
  process.exit(1);
}

if (!existsSync(sourcePath)) {
  console.error(`Expected local user database at: ${sourcePath}`);
  console.error('This importer expects the old app to have been set up with setup:local-user-data.');
  process.exit(1);
}

if (!statSync(sourcePath).isFile()) {
  console.error(`Expected a database file, got: ${sourcePath}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

if (existsSync(targetPath) && realpathSync(sourcePath) === realpathSync(targetPath)) {
  console.error('Source and target databases are the same file. Run this from the new git clone, not the old app folder.');
  process.exit(1);
}

if (existsSync(targetPath)) {
  const backupPath = path.join(targetDir, `app.db.backup-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  copyFileSync(targetPath, backupPath);
  console.log(`Backed up existing local user database to ${backupPath}`);
}

copyFileSync(sourcePath, targetPath);

console.log(`Copied ${sourcePath} to ${targetPath}`);
console.log('Local user data is ready in this repo.');
