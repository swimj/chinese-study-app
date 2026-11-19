import path from 'node:path';
import { readBooleanArgument, readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { createDefaultHostedUpgradeDeps, runHostedUpgrade } from './lib/hosted-upgrade.ts';
import { runHostedMigrationRelease } from './lib/hosted-migration-release.ts';
import { schemaMigrationIds } from '../server/db/migrations.ts';

const args = readStrictArguments(['mode', 'app', 'actor-id', 'confirm-source-revision', 'image', 'image-app', 'rehearsal-run-dir', 'reopen', 'allow-unmerged-revision', 'allow-dropped-env', 'fresh-backup']);
const repoRoot = process.cwd();
const mode = args.get('mode') ?? 'code';
const common = {
  repoRoot,
  app: requireArgument(args, 'app'),
  actorId: requireArgument(args, 'actor-id'),
  confirmSourceRevision: requireArgument(args, 'confirm-source-revision'),
  targetSchemaMigrationIds: schemaMigrationIds(),
  flyConfigPath: path.join('deploy/fly/.generated/fly.toml'),
  reopen: args.has('reopen') ? readBooleanArgument(args, 'reopen') : true,
  allowUnmergedRevision: args.has('allow-unmerged-revision') ? readBooleanArgument(args, 'allow-unmerged-revision') : false,
  allowDroppedEnv: (args.get('allow-dropped-env') ?? '').split(',').map((name) => name.trim()).filter(Boolean),
};
const deps = createDefaultHostedUpgradeDeps(repoRoot);
let status: 'ok' | 'failed';
if (mode === 'code') {
  if (args.has('rehearsal-run-dir')) throw new Error('--rehearsal-run-dir applies only to --mode=migrate.');
  if (args.has('image') && args.has('image-app')) throw new Error('--image-app applies only when building, without --image.');
  status = (await runHostedUpgrade({ ...common, image: args.get('image'), imageApp: args.get('image-app'),
    freshBackup: args.has('fresh-backup') ? readBooleanArgument(args, 'fresh-backup') : false }, deps)).status;
} else if (mode === 'migrate') {
  if (args.has('image-app')) throw new Error('--mode=migrate deploys the rehearsed --image and never builds.');
  if (args.has('fresh-backup')) throw new Error('--mode=migrate always captures its pre-release backup after writes stop.');
  status = (await runHostedMigrationRelease({
    ...common,
    image: requireArgument(args, 'image'),
    rehearsalRunDir: requireArgument(args, 'rehearsal-run-dir'),
  }, deps)).status;
} else {
  throw new Error('--mode must be code or migrate.');
}
if (status !== 'ok') process.exitCode = 1;
