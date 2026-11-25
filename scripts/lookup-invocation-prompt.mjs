import { readFileSync } from 'node:fs';
import { archivePath, catalogPath, isPromptLabel, parsePromptUses, readPromptUseFiles } from './lib/invocation-prompt-catalog.mjs';

const usage = `Usage:
  node scripts/lookup-invocation-prompt.mjs hash <sha256-or-prefix>
  node scripts/lookup-invocation-prompt.mjs use <name> <version>`;

function lookup(args) {
  const [mode, value, version] = args;
  const byHash = mode === 'hash' && args.length === 2 && /^[0-9a-f]{1,64}$/i.test(value);
  const byUse = mode === 'use' && args.length === 3 && isPromptLabel(value) && isPromptLabel(version);
  if (!byHash && !byUse) throw new Error(usage);

  const files = readPromptUseFiles();
  const hashes = new Set(JSON.parse(readFileSync(catalogPath, 'utf8')));
  const uses = parsePromptUses(files, hashes);
  let matches;
  if (byHash) {
    matches = [...hashes].filter(hash => hash.startsWith(value.toLowerCase()));
    if (!matches.length) throw new Error(`No cataloged invocation prompt matches hash ${value}`);
    if (matches.length > 1) {
      throw new Error(`Ambiguous invocation prompt hash prefix ${value}: ${matches.join(', ')}`);
    }
  } else {
    matches = uses.filter(row => row.name === value && row.version === version).map(row => row.hash);
    if (!matches.length) throw new Error(`No cataloged invocation prompt matches ${value} version ${version}`);
  }

  return matches.map(hash => ({
    hash,
    path: `${archivePath}/${hash}.txt`,
    uses: uses.filter(row => row.hash === hash).map(({ name, version }) => ({ name, version })),
  }));
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
  } else {
    console.log(JSON.stringify(lookup(args), null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
