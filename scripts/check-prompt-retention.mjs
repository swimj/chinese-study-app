import { execFileSync } from 'node:child_process';

const [base, candidate] = process.argv.slice(2);
if (!base || !candidate || process.argv.length !== 4) {
  throw new Error('Usage: node scripts/check-prompt-retention.mjs <base> <candidate>');
}

function promptFiles(revision) {
  const tree = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', revision, '--', 'server'], { encoding: 'utf8' });
  const files = new Map();
  for (const entry of tree.split('\0')) {
    const tab = entry.indexOf('\t');
    const path = entry.slice(tab + 1);
    if (!/(?:\/prompts|\/[^/]+-prompts)\//.test(path) || path.endsWith('/README.md')) continue;
    const [mode, , blob] = entry.slice(0, tab).split(' ');
    if (mode === '100644' || mode === '100755') files.set(blob, path);
  }
  return files;
}

const retained = promptFiles(candidate);
for (const [blob, path] of promptFiles(base)) {
  if (retained.has(blob)) continue;
  console.error(`Missing prompt source from ${base}: ${path} (blob ${blob}). Preserve its exact bytes in a server prompt directory, e.g. under archive/.`);
  process.exitCode = 1;
}
