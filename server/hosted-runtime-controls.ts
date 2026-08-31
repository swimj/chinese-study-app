import { getHostedServiceControls } from './db/hosted-operations.ts';

export const MAINTENANCE_MODE_CODE = 'MAINTENANCE_MODE';
export const PROVIDER_WORK_DISABLED_CODE = 'PROVIDER_WORK_DISABLED';

export class HostedProviderWorkUnavailableError extends Error {
  readonly code: typeof MAINTENANCE_MODE_CODE | typeof PROVIDER_WORK_DISABLED_CODE;

  constructor(code: HostedProviderWorkUnavailableError['code']) {
    super(code === MAINTENANCE_MODE_CODE
      ? 'The service is in maintenance mode.'
      : 'Provider work is temporarily disabled.');
    this.name = 'HostedProviderWorkUnavailableError';
    this.code = code;
  }
}

let activeProviderWorkCount = 0;

export function getActiveProviderWorkCount(): number {
  return activeProviderWorkCount;
}

export async function runHostedProviderWork<T>(work: () => Promise<T>): Promise<T> {
  const controls = getHostedServiceControls();
  if (controls.maintenanceMode) throw new HostedProviderWorkUnavailableError(MAINTENANCE_MODE_CODE);
  if (!controls.providerWorkEnabled) {
    throw new HostedProviderWorkUnavailableError(PROVIDER_WORK_DISABLED_CODE);
  }
  activeProviderWorkCount += 1;
  try {
    return await work();
  } finally {
    activeProviderWorkCount -= 1;
  }
}
