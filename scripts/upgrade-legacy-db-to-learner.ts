import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { inspectLegacyPromptFeedback } from '../server/db/legacy-prompt-feedback.ts';
import {
  copyLegacyDatabaseIntoFreshTarget,
  inspectLegacyLearnerUpgrade,
} from '../server/db/legacy-learner-upgrade.ts';
import { validateLegacyLearnerUpgrade } from '../server/db/legacy-upgrade-validation.ts';

const args = new Map(process.argv.slice(2).map(parseArg).filter((entry): entry is [string, string] => entry !== null));
const dataDir = args.get('data-dir');
const learnerId = args.get('learner-id');
const apply = args.get('apply') === 'true';

if (!dataDir || !learnerId) {
  throw new Error('Usage: --data-dir=/absolute/path --learner-id=<stable-id> [--apply=true]');
}

const resolvedDataDir = path.resolve(dataDir);
const dbPath = path.join(resolvedDataDir, 'app.db');
const legacyDb = new DatabaseSync(dbPath, { readOnly: true });
const promptFeedback = inspectLegacyPromptFeedback(legacyDb);
const report = inspectLegacyLearnerUpgrade(legacyDb, promptFeedback);
legacyDb.close();
process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'report_only', ...report }, null, 2)}\n`);

if (apply) {
  if (report.promptFeedback.invalidActiveTargets.length > 0) {
    throw new Error('Refusing to apply: report contains invalid active bad-prompt targets');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.pre-swi-47-${timestamp}`;
  fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
  const upgradeDir = fs.mkdtempSync(path.join(resolvedDataDir, '.swi-47-upgrade-'));
  try {
    runDatabaseBootstrap(upgradeDir, learnerId, 'initialize');
    const targetPath = path.join(upgradeDir, 'app.db');
    const targetDb = new DatabaseSync(targetPath);
    copyLegacyDatabaseIntoFreshTarget({ targetDb, legacyDbPath: dbPath, learnerId, report });
    targetDb.close();
    runDatabaseBootstrap(upgradeDir, learnerId, 'validate');
    const validationLegacyDb = new DatabaseSync(dbPath, { readOnly: true });
    const validationTargetDb = new DatabaseSync(targetPath, { readOnly: true });
    try {
      const validation = validateLegacyLearnerUpgrade({
        legacyDb: validationLegacyDb,
        upgradedDb: validationTargetDb,
        learnerId,
      });
      process.stdout.write(`${JSON.stringify({ postUpgradeValidation: validation }, null, 2)}\n`);
    } finally {
      validationLegacyDb.close();
      validationTargetDb.close();
    }
    fs.renameSync(targetPath, dbPath);
    process.stdout.write(`${JSON.stringify({ applied: true, backupPath })}\n`);
  } finally {
    fs.rmSync(upgradeDir, { recursive: true, force: true });
  }
}

function runDatabaseBootstrap(targetDataDir: string, targetLearnerId: string, phase: string): void {
  const dbModuleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?legacy-upgrade=${phase}-${Date.now()}`;
  execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', `await import(${JSON.stringify(dbModuleUrl)})`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_MODE: 'study',
        APP_DATA_DIR: targetDataDir,
        APP_LEARNER_ID: targetLearnerId,
      },
      stdio: 'pipe',
    },
  );
}

function parseArg(argument: string): [string, string] | null {
  if (!argument.startsWith('--')) return null;
  const [key, ...rest] = argument.slice(2).split('=');
  if (!key || rest.length === 0) return null;
  return [key, rest.join('=')];
}
