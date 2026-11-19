import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { authorized, backupId, jsonResponse, readBackupJson, requireBackupToken } from './http.ts';

const exec = promisify(execFile);
const worker = fileURLToPath(new URL('../../scripts/create-sqlite-backup.ts', import.meta.url));
export type BackupSourceOptions = {
  databasePath: string; token: string; sourceRevision: string; sourceApp: string;
  scratchDirectory?: string; maxBytes?: number; timeoutMs?: number;
};

export function createBackupSourceServer(options: BackupSourceOptions): Server {
  const token = requireBackupToken(options.token);
  if (!path.isAbsolute(options.databasePath) || !/^[a-f0-9]{40}$/.test(options.sourceRevision) || !options.sourceApp) throw new Error('Invalid backup source');
  const scratch = options.scratchDirectory ?? os.tmpdir();
  const maxBytes = options.maxBytes ?? 4 * 1024 ** 3;
  let busy = false;
  const server = createServer(async (request, response) => {
    if (!authorized(request, token)) { jsonResponse(response, 401, { error: 'unauthorized' }); return; }
    if (request.method !== 'POST' || request.url !== '/backup') { jsonResponse(response, 404, { error: 'not_found' }); return; }
    if (busy) { jsonResponse(response, 409, { error: 'backup_busy' }); return; }
    busy = true;
    const abort = new AbortController();
    const disconnected = () => { if (!response.writableFinished) abort.abort(); };
    response.once('close', disconnected);
    let directory: string | undefined;
    try {
      const body = await readBackupJson(request);
      if (!body || typeof body !== 'object' || !('id' in body) || !backupId(body.id)) {
        jsonResponse(response, 400, { error: 'invalid_backup_id' }); return;
      }
      const [db, disk] = await Promise.all([stat(options.databasePath), statfs(scratch)]);
      const wal = await stat(`${options.databasePath}-wal`).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return { size: 0 };
      });
      if (db.size > maxBytes || disk.bavail * disk.bsize < db.size + wal.size + 64 * 1024 ** 2) {
        jsonResponse(response, 507, { error: 'insufficient_backup_space' }); return;
      }
      directory = await mkdtemp(path.join(scratch, 'sqlite-backup-'));
      const output = path.join(directory, 'snapshot.db');
      const background = 'priority' in body && body.priority === 'background';
      const { stdout } = await exec(process.execPath, ['--import', 'tsx', worker,
        `--database=${options.databasePath}`, `--output=${output}`, `--max-bytes=${maxBytes}`,
        ...(background ? ['--priority=background'] : [])], {
        timeout: options.timeoutMs ?? 10 * 60_000, signal: abort.signal, maxBuffer: 16 * 1024,
      });
      const receipt: unknown = JSON.parse(stdout);
      if (!receipt || typeof receipt !== 'object' || !('bytes' in receipt) || typeof receipt.bytes !== 'number'
        || !('sha256' in receipt) || typeof receipt.sha256 !== 'string'
        || !('startedAt' in receipt) || typeof receipt.startedAt !== 'string'
        || !('completedAt' in receipt) || typeof receipt.completedAt !== 'string') throw new Error('Invalid worker receipt');
      response.writeHead(200, {
        'content-type': 'application/octet-stream', 'cache-control': 'no-store',
        'content-length': receipt.bytes, 'x-backup-id': body.id,
        'x-backup-source-revision': options.sourceRevision, 'x-backup-source-app': options.sourceApp,
        'x-backup-started-at': receipt.startedAt, 'x-backup-completed-at': receipt.completedAt,
        'x-backup-sha256': receipt.sha256,
      });
      await pipeline(createReadStream(output), response, { signal: abort.signal });
    } catch {
      if (!response.headersSent && !response.destroyed) jsonResponse(response, 503, { error: 'backup_failed' });
      else response.destroy();
    } finally {
      response.removeListener('close', disconnected);
      try {
        if (directory) await rm(directory, { recursive: true, force: true });
        busy = false;
      } catch {
        // Refuse further captures if scratch cleanup fails rather than fill disk.
        console.error(JSON.stringify({ event: 'backup_scratch_cleanup_failed' }));
      }
    }
  });
  server.requestTimeout = options.timeoutMs ?? 10 * 60_000;
  server.headersTimeout = 15_000;
  return server;
}

export function startConfiguredBackupSource(): Server | null {
  if (!process.env.APP_BACKUP_SOURCE_TOKEN) return null;
  const server = createBackupSourceServer({
    databasePath: path.join(process.env.APP_DATA_DIR ?? '/data', 'app.db'),
    token: process.env.APP_BACKUP_SOURCE_TOKEN, sourceApp: process.env.FLY_APP_NAME ?? 'local', sourceRevision: process.env.APP_REVISION ?? 'unknown',
    scratchDirectory: process.env.APP_BACKUP_SCRATCH_DIR,
  });
  server.listen(Number(process.env.APP_BACKUP_SOURCE_PORT ?? '9092'), process.env.APP_BACKUP_BIND ?? '::');
  return server;
}
