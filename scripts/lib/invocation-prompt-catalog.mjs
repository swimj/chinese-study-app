import { readdirSync, readFileSync } from 'node:fs';

export const archivePath = 'artifacts/invocation-prompts';
export const catalogPath = 'server/db/invocation-prompt-catalog.json';
export const usesDirectory = 'server/db/invocation-prompt-uses';
export const registeredUsesPath = usesDirectory + '/registered.json';

export function isPromptLabel(value) {
  return typeof value === 'string' && /^\S+$/.test(value);
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function comparePromptUses(first, second) {
  return compare(first.name, second.name) || compare(first.version, second.version) || compare(first.hash, second.hash);
}

export function readPromptUseFiles() {
  const files = new Map();
  for (const entry of readdirSync(usesDirectory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json')) continue;
    const path = usesDirectory + '/' + entry.name;
    if (!entry.isFile()) throw new Error(`Invalid invocation prompt uses file: ${path}`);
    files.set(path, readFileSync(path, 'utf8'));
  }
  return files;
}

export function parsePromptUses(files, hashes) {
  const uses = [];
  for (const [path, text] of files) {
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error(`Expected an array of invocation prompt uses in ${path}`);
    for (const row of rows) {
      if (!row || Object.keys(row).length !== 3 || !isPromptLabel(row.name) ||
          !isPromptLabel(row.version) || !hashes.has(row.hash)) {
        throw new Error(`Invalid invocation prompt use in ${path}: ${JSON.stringify(row)}`);
      }
    }
    if (rows.some((row, index) => index > 0 && comparePromptUses(rows[index - 1], row) >= 0)) {
      throw new Error(`Invocation prompt uses in ${path} must be sorted by name, version, and hash without duplicates`);
    }
    uses.push(...rows);
  }
  uses.sort(comparePromptUses);
  const duplicate = uses.find((row, index) => index > 0 && comparePromptUses(uses[index - 1], row) === 0);
  if (duplicate) throw new Error(`Duplicate invocation prompt use across files: ${JSON.stringify(duplicate)}`);
  return uses;
}
