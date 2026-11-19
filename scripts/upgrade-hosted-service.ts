import path from 'node:path';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import {
  createDefaultHostedUpgradeDeps,
  runHostedUpgrade,
} from './lib/hosted-upgrade.ts';
import { schemaMigrationIds } from '../server/db/migrations.ts';

const args = readStrictArguments(['app', 'actor-id', 'confirm-source-revision', 'image']);
const repoRoot = process.cwd();
const result = await runHostedUpgrade({
  repoRoot,
  app: requireArgument(args, 'app'),
  actorId: requireArgument(args, 'actor-id'),
  confirmSourceRevision: requireArgument(args, 'confirm-source-revision'),
  targetSchemaMigrationIds: schemaMigrationIds(),
  image: args.get('image'),
  flyConfigPath: path.join('deploy/fly/.generated/fly.toml'),
}, createDefaultHostedUpgradeDeps(repoRoot));

if (result.status !== 'ok') process.exitCode = 1;
