import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { archivePath, catalogPath, comparePromptUses, isPromptLabel, parsePromptUses, readPromptUseFiles, registeredUsesPath } from './lib/invocation-prompt-catalog.mjs';

const { positionals: sources, values: { use: name, version } } = parseArgs({
  allowPositionals: true,
  options: { use: { type: 'string' }, version: { type: 'string' } },
});
const labeled = name !== undefined || version !== undefined;
if (!sources.length || (labeled && (!isPromptLabel(name) || !isPromptLabel(version)))) {
  throw new Error('Usage: node scripts/register-invocation-prompt.mjs [--use=<name> --version=<version>] <rendered-system-prompt-file> [...]');
}

const prompts = sources.map(source => {
  const bytes = readFileSync(source);
  if (!isUtf8(bytes)) throw new Error(`Expected UTF-8 prompt text in ${source}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  return { hash, bytes };
});

// Hold the existing catalog lock through both writes so concurrent registrations
// cannot lose associations. Publish hash membership before publishing its metadata.
const lock = catalogPath + '.lock';
closeSync(openSync(lock, 'wx'));
const pendingCatalog = catalogPath + '.pending';
const pendingUses = registeredUsesPath + '.pending';
try {
  const hashes = new Set(JSON.parse(readFileSync(catalogPath, 'utf8')));
  const files = labeled ? readPromptUseFiles() : new Map();
  const uses = parsePromptUses(files, hashes);
  const registered = JSON.parse(files.get(registeredUsesPath) ?? '[]');
  mkdirSync(archivePath, { recursive: true });
  for (const { hash, bytes } of prompts) {
    const target = join(archivePath, hash + '.txt');
    try {
      writeFileSync(target, bytes, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!readFileSync(target).equals(bytes)) throw new Error(`Existing prompt fails content verification: ${target}`);
    }
    hashes.add(hash);
    const association = { name, version, hash };
    if (labeled && !uses.some(row => comparePromptUses(row, association) === 0)) {
      uses.push(association);
      registered.push(association);
    }
  }
  if (labeled) writeFileSync(pendingUses, JSON.stringify(registered.sort(comparePromptUses), null, 2) + '\n');
  writeFileSync(pendingCatalog, JSON.stringify([...hashes].sort(), null, 2) + '\n');
  renameSync(pendingCatalog, catalogPath);
  if (labeled) renameSync(pendingUses, registeredUsesPath);
} finally {
  rmSync(pendingCatalog, { force: true });
  rmSync(pendingUses, { force: true });
  rmSync(lock, { force: true });
}
for (const { hash } of prompts) console.log(hash);
