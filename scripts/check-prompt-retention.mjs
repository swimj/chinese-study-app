import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { archivePath as archive, catalogPath as catalog, parsePromptUses, usesDirectory } from './lib/invocation-prompt-catalog.mjs';

const [base, candidate] = process.argv.slice(2);
if (!base || !candidate || process.argv.length !== 4) {
  throw new Error('Usage: node scripts/check-prompt-retention.mjs <base> <candidate>');
}

function promptFiles(revision) {
  const tree = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', revision, '--', 'server', archive], { encoding: 'utf8' });
  const sources = new Map();
  const archived = new Map();
  let catalogBlob;
  const useBlobs = new Map();
  for (const entry of tree.split('\0')) {
    const tab = entry.indexOf('\t');
    const path = entry.slice(tab + 1);
    const [mode, , blob] = entry.slice(0, tab).split(' ');
    const regular = mode === '100644' || mode === '100755';
    if (path === catalog && regular) catalogBlob = blob;
    if (path.startsWith(usesDirectory + '/')) {
      const filename = path.slice(usesDirectory.length + 1);
      if (!regular || filename.includes('/') || !filename.endsWith('.json')) {
        throw new Error(`Invalid invocation prompt uses file: ${path}`);
      }
      useBlobs.set(path, blob);
    }
    if (path.startsWith(archive + '/')) {
      const name = path.slice(archive.length + 1);
      if (!regular || !/^[0-9a-f]{64}\.txt$/.test(name)) throw new Error(`Invalid archived prompt file: ${path}`);
      archived.set(name.slice(0, -4), blob);
      sources.set(blob, path);
    } else if (regular && /(?:\/prompts|\/[^/]+-prompts)\//.test(path) && !path.endsWith('/README.md')) {
      sources.set(blob, path);
    }
  }
  return { sources, archived, catalogBlob, useBlobs };
}

const prior = promptFiles(base);
const current = promptFiles(candidate);
for (const [blob, path] of prior.sources) {
  if (!current.sources.has(blob)) {
    throw new Error(`Missing prompt source from ${base}: ${path} (blob ${blob}). Preserve its exact bytes in the prompt archive.`);
  }
}
for (const [hash, blob] of prior.archived) {
  if (current.archived.get(hash) !== blob) throw new Error(`Archived prompt removed or replaced: ${hash}`);
}
for (const [hash, blob] of current.archived) {
  const bytes = execFileSync('git', ['cat-file', 'blob', blob]);
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Archived prompt hash mismatch: ${hash}`);
}
if (!current.catalogBlob) throw new Error('Missing regular invocation prompt catalog file');
const indexed = JSON.parse(execFileSync('git', ['cat-file', 'blob', current.catalogBlob], { encoding: 'utf8' }));
if (JSON.stringify(indexed) !== JSON.stringify([...current.archived.keys()].sort())) {
  throw new Error('Invocation prompt catalog must list every archived hash exactly once in sorted order');
}

if (!current.useBlobs.size) throw new Error('Missing invocation prompt uses files');
const useFiles = [...current.useBlobs.entries()].map(([path, blob]) => [
  path, execFileSync('git', ['cat-file', 'blob', blob], { encoding: 'utf8' }),
]);
parsePromptUses(useFiles, new Set(indexed));
