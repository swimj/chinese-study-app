import path from 'node:path';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { buildHostedImage } from './lib/hosted-build.ts';
import { createDefaultHostedUpgradeDeps } from './lib/hosted-upgrade.ts';
import { sanitizeHostedOutput } from './lib/hosted-json.ts';

const args = readStrictArguments(['image-app', 'confirm-source-revision']);
const repoRoot = process.cwd();
try {
  const result = await buildHostedImage({
    repoRoot,
    imageApp: requireArgument(args, 'image-app'),
    confirmSourceRevision: requireArgument(args, 'confirm-source-revision'),
    flyConfigPath: path.join('deploy/fly/.generated/fly.toml'),
  }, createDefaultHostedUpgradeDeps(repoRoot));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log(JSON.stringify({ type: 'build-result', status: 'failed', failure: sanitizeHostedOutput(error instanceof Error ? error.message : String(error)) }));
  process.exitCode = 1;
}
