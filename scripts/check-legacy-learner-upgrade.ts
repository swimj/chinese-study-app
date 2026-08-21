import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validateLegacyLearnerUpgrade } from '../server/db/legacy-upgrade-validation.ts';

const args = new Map(process.argv.slice(2).map(parseArg).filter((entry): entry is [string, string] => entry !== null));
const legacyPath = args.get('legacy-db');
const upgradedPath = args.get('upgraded-db');
const learnerId = args.get('learner-id');

if (!legacyPath || !upgradedPath || !learnerId) {
  throw new Error(
    'Usage: --legacy-db=/absolute/path/to/backup --upgraded-db=/absolute/path/to/app.db '
      + '--learner-id=<stable-id>',
  );
}

const legacyDb = new DatabaseSync(path.resolve(legacyPath), { readOnly: true });
const upgradedDb = new DatabaseSync(path.resolve(upgradedPath), { readOnly: true });
try {
  const report = validateLegacyLearnerUpgrade({ legacyDb, upgradedDb, learnerId });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  legacyDb.close();
  upgradedDb.close();
}

function parseArg(argument: string): [string, string] | null {
  if (!argument.startsWith('--')) return null;
  const [key, ...rest] = argument.slice(2).split('=');
  if (!key || rest.length === 0) return null;
  return [key, rest.join('=')];
}
