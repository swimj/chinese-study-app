import path from 'node:path';
import { readBooleanArgument, readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import {
  createDefaultHostedUpgradeDeps,
  runHostedUpgrade,
} from './lib/hosted-upgrade.ts';

const args = readStrictArguments(['app', 'actor-id', 'confirm-source-revision', 'confirm-eligible-release', 'image']);
const repoRoot = process.cwd();
const result = await runHostedUpgrade({
  repoRoot,
  app: requireArgument(args, 'app'),
  actorId: requireArgument(args, 'actor-id'),
  confirmSourceRevision: requireArgument(args, 'confirm-source-revision'),
  confirmEligibleRelease: readBooleanArgument(args, 'confirm-eligible-release'),
  image: args.get('image'),
  flyConfigPath: path.join('deploy/fly/.generated/fly.toml'),
}, createDefaultHostedUpgradeDeps(repoRoot));

if (result.status !== 'ok') process.exitCode = 1;
