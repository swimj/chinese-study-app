// Journal housekeeping: where things are, snapshots, copies and the fixture.
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixture.ts';
import { backupDir, copyDatabase, copyPath, fixturePath, isPrimaryCheckout, journalHome, livePath, snapshot } from './storage.ts';

const checkout = dirname(fileURLToPath(import.meta.url));
const [command, ...args] = process.argv.slice(2);
const force = args.includes('--force');

async function main() {
  if (command === 'where') {
    console.log(`Journal home     ${journalHome()}
Live journal     ${livePath()}${existsSync(livePath()) ? '' : '  (not created yet)'}
Live backups     ${backupDir()}
This checkout    ${checkout}${isPrimaryCheckout(checkout) ? '  (primary: may open the live journal)' : '  (worktree: fixture or copy only)'}
Fixture          ${fixturePath(checkout)}${existsSync(fixturePath(checkout)) ? '' : '  (built on first start)'}
Live copy        ${copyPath(checkout)}${existsSync(copyPath(checkout)) ? '' : '  (none)'}`);
    return;
  }
  if (command === 'backup') {
    const made = await snapshot(livePath(), backupDir());
    console.log(made ? 'Saved ' + made : 'No live journal to back up yet.');
    return;
  }
  if (command === 'copy-live') {
    if (!existsSync(livePath())) throw new Error('No live journal at ' + livePath());
    if (existsSync(copyPath(checkout)) && !force) throw new Error('A copy already exists at ' + copyPath(checkout) + '. Pass --force to replace it.');
    await copyDatabase(livePath(), copyPath(checkout));
    console.log('Copied the live journal to ' + copyPath(checkout) + '. Run `npm run start:copy`.');
    return;
  }
  if (command === 'fixture') {
    await buildFixture(fixturePath(checkout));
    console.log('Rebuilt ' + fixturePath(checkout));
    return;
  }
  throw new Error('Usage: journal-cli.ts where | backup | copy-live [--force] | fixture');
}
main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
