export type BackupRequest = {
  id: string;
  kind: 'hourly' | 'release';
  expectedSourceRevision?: string;
  expectedSourceApp?: string;
  releaseId?: string;
};

export type BackupReceipt = {
  version: 1;
  captureOrigin?: 'scheduled' | 'manual';
  id: string;
  kind: 'hourly' | 'release';
  releaseId?: string;
  sourceRevision: string;
  sourceApp: string;
  startedAt: string;
  completedAt: string;
  receivedAt: string;
  bytes: number;
  sha256: string;
  fileName: string;
};

export type BackupStatus = {
  busy: boolean;
  lastSuccessfulBackup: BackupReceipt | null;
  // Absent on receivers that still use the hourly schedule.
  lastScheduledBackup?: BackupReceipt | null;
  offsite?: {
    lastConfirmed: { id: string; key: string; startedAt: string; confirmedAt: string } | null;
  };
  backups: BackupReceipt[];
  lastError: { at: string; code: string } | null;
};
