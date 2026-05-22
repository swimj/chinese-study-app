import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const sourcePath = process.argv[2];
const targetDir = path.resolve('data/local-user-data');
const targetPath = path.join(targetDir, 'app.db');

if (!sourcePath) {
  console.error('Usage: npm run setup:local-user-data -- /absolute/path/to/app.db');
  process.exit(1);
}

const resolvedSourcePath = path.resolve(sourcePath);

if (!existsSync(resolvedSourcePath)) {
  console.error(`Database file not found: ${resolvedSourcePath}`);
  process.exit(1);
}

if (!statSync(resolvedSourcePath).isFile()) {
  console.error(`Expected a database file, got: ${resolvedSourcePath}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

if (existsSync(targetPath)) {
  const backupPath = path.join(targetDir, `app.db.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  copyFileSync(targetPath, backupPath);
  console.log(`Backed up existing local user database to ${backupPath}`);
}

copyFileSync(resolvedSourcePath, targetPath);

console.log(`Copied ${resolvedSourcePath} to ${targetPath}`);
console.log('Local user data is ready.');
