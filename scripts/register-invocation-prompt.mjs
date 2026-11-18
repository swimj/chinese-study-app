import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sources = process.argv.slice(2);
if (!sources.length) throw new Error('Usage: node scripts/register-invocation-prompt.mjs <rendered-system-prompt-file> [...]');
const archive = 'artifacts/invocation-prompts';
const catalog = 'server/db/invocation-prompt-catalog.json';
mkdirSync(archive, { recursive: true });
const additions = [];
for (const source of sources) {
  const bytes = readFileSync(source);
  if (!isUtf8(bytes)) throw new Error(`Expected UTF-8 prompt text in ${source}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const target = join(archive, hash + '.txt');
  try {
    writeFileSync(target, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!readFileSync(target).equals(bytes)) throw new Error(`Existing prompt fails content verification: ${target}`);
  }
  additions.push(hash);
  console.log(hash);
}
// Serialize catalog edits across concurrent registrations in this worktree.
const lock = catalog + '.lock';
const fd = openSync(lock, 'wx');
try {
  const hashes = new Set([...JSON.parse(readFileSync(catalog, 'utf8')), ...additions]);
  writeFileSync(fd, JSON.stringify([...hashes].sort(), null, 2) + '\n');
  renameSync(lock, catalog);
} catch (error) {
  rmSync(lock, { force: true });
  throw error;
} finally {
  closeSync(fd);
}
