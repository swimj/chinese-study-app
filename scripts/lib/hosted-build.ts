import path from 'node:path';
import { sanitizeHostedOutput } from './hosted-json.ts';
import {
  DEFAULT_FLY_CONFIG_PATH,
  flyCommandEnv,
  readPreparedFlyConfig,
  validateReleaseCheckout,
  type HostedUpgradeDeps,
  type PlannedReleaseIdentity,
} from './hosted-upgrade.ts';

export const BUILD_TIMEOUT_MS = 1_200_000;
const FLY_REGISTRY = 'registry.fly.io';
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export type HostedBuildInput = {
  repoRoot: string;
  /** Fly app whose registry receives the image; it need not be the app that runs it. */
  imageApp: string;
  confirmSourceRevision: string;
  flyConfigPath?: string;
};

export type HostedBuildResult = {
  type: 'build-result';
  /** Digest-qualified reference accepted by hosted:rehearse, hosted:rc, and hosted:upgrade. */
  image: string;
  imageApp: string;
  tag: string;
  digest: string;
  plannedRelease: PlannedReleaseIdentity;
  builtAt: string;
};

/**
 * Builds the checkout's HEAD remotely with its APP_REVISION, pushes it to the
 * image app's registry without deploying anything, and resolves the pushed
 * tag to an immutable digest through the registry API.
 */
export async function buildHostedImage(input: HostedBuildInput, deps: HostedUpgradeDeps): Promise<HostedBuildResult> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.imageApp)) throw new Error('--image-app must be a Fly app name.');
  const plannedRelease = validateReleaseCheckout(input, deps);
  const flyConfig = readPreparedFlyConfig(path.resolve(input.repoRoot, input.flyConfigPath ?? DEFAULT_FLY_CONFIG_PATH), deps);
  const tag = `release-${plannedRelease.sourceRevision}`;
  // The production config supplies the frontend build arguments; --app only redirects the push.
  await deps.run('fly', [
    'deploy', '--app', input.imageApp, '--config', flyConfig.configPath,
    '--remote-only', '--build-only', '--push',
    '--image-label', tag,
    '--build-arg', `APP_REVISION=${plannedRelease.sourceRevision}`,
  ], { cwd: input.repoRoot, timeoutMs: BUILD_TIMEOUT_MS, env: flyCommandEnv() });
  const digest = await resolveRegistryDigest(input.imageApp, tag, deps);
  return {
    type: 'build-result',
    image: `${FLY_REGISTRY}/${input.imageApp}:${tag}@${digest}`,
    imageApp: input.imageApp,
    tag,
    digest,
    plannedRelease,
    builtAt: deps.now().toISOString(),
  };
}

/** Reads a tag's manifest digest from the Fly registry using the CLI's token; the token never leaves this process's request headers. */
export async function resolveRegistryDigest(repository: string, tag: string, deps: HostedUpgradeDeps): Promise<string> {
  const token = (await deps.run('fly', ['auth', 'token'], { timeoutMs: 30_000, env: flyCommandEnv() })).stdout.trim();
  if (!token || /\s/.test(token)) throw new Error('fly auth token did not return a token.');
  const response = await deps.fetch(`https://${FLY_REGISTRY}/v2/${repository}/manifests/${encodeURIComponent(tag)}`, {
    method: 'HEAD',
    headers: {
      authorization: `Basic ${Buffer.from(`x:${token}`).toString('base64')}`,
      accept: MANIFEST_ACCEPT,
    },
  });
  if (!response.ok) throw new Error(sanitizeHostedOutput(`Registry manifest lookup for ${repository}:${tag} returned HTTP ${response.status}.`));
  const digest = response.headers.get('docker-content-digest') ?? '';
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Registry did not report a sha256 manifest digest.');
  return digest;
}
