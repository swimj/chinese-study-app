import fs from 'node:fs';
import path from 'node:path';
import { getHostedServiceControls } from './db.ts';
import { readHostedBackupStatus } from './hosted-backup-status.ts';
import { getActiveProviderWorkCount } from './hosted-runtime-controls.ts';
import type { ServiceOperationalMetrics } from './observability.ts';

export async function readServiceOperationalMetrics(options: {
  dataDir?: string;
  litestreamSocketPath?: string;
} = {}): Promise<ServiceOperationalMetrics> {
  const dataDir = options.dataDir ?? process.env.APP_DATA_DIR ?? '/data';
  const databasePath = path.join(dataDir, 'app.db');
  let controls: ReturnType<typeof getHostedServiceControls> | null = null;
  try {
    controls = getHostedServiceControls();
  } catch {
    // Process and request metrics must remain available during a database incident.
  }
  const backup = await readHostedBackupStatus({
    databasePath,
    socketPath: options.litestreamSocketPath,
  });
  return {
    databaseBytes: readFileSize(databasePath),
    walBytes: readFileSize(`${databasePath}-wal`),
    backupReplicationAgeSeconds: backup?.ageSeconds ?? null,
    maintenanceMode: controls?.maintenanceMode ?? null,
    providerWorkEnabled: controls?.providerWorkEnabled ?? null,
    activeProviderWorkCount: getActiveProviderWorkCount(),
  };
}

function readFileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : null;
  }
}
