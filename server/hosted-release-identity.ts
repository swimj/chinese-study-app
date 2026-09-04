import fs from 'node:fs';
import path from 'node:path';

export type HostedReleaseIdentity = {
  appVersion: string;
  sourceRevision: string;
  flyAppName: string | null;
  flyImageRef: string | null;
  flyMachineId: string | null;
  flyMachineVersion: string | null;
  flyRegion: string | null;
};

export function readHostedReleaseIdentity(
  environment: NodeJS.ProcessEnv = process.env,
  packageVersion = environment.npm_package_version ?? readPackageJsonVersion(),
): HostedReleaseIdentity {
  return {
    appVersion: readRequiredIdentityLabel(packageVersion, 'app version'),
    sourceRevision: readSourceRevision(environment.APP_REVISION),
    flyAppName: readOptionalIdentityValue(environment.FLY_APP_NAME),
    flyImageRef: readOptionalIdentityValue(environment.FLY_IMAGE_REF),
    flyMachineId: readOptionalIdentityValue(environment.FLY_MACHINE_ID),
    flyMachineVersion: readOptionalIdentityValue(environment.FLY_MACHINE_VERSION),
    flyRegion: readOptionalIdentityValue(environment.FLY_REGION),
  };
}

function readSourceRevision(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  if (normalized === '' || normalized === 'unknown') return 'unknown';
  if (!/^[a-f0-9]{40}$/.test(normalized)) {
    throw new Error('APP_REVISION must be the full 40-character Git SHA baked at image build time.');
  }
  return normalized;
}

function readRequiredIdentityLabel(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized === '') throw new Error(`Missing ${label} for hosted release identity.`);
  return normalized;
}

function readOptionalIdentityValue(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? null : normalized;
}

function readPackageJsonVersion(): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version?: unknown };
    return typeof raw.version === 'string' ? raw.version : undefined;
  } catch {
    return undefined;
  }
}
