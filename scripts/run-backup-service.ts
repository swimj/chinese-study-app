import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackupReceiver } from '../server/backups/receiver.ts';
import { authorized, backupId, jsonResponse, readBackupJson, requireBackupToken } from '../server/backups/http.ts';
import type { BackupRequest } from '../server/backups/types.ts';

const token = requireBackupToken(process.env.APP_BACKUP_RECEIVER_TOKEN);
const sourceToken = requireBackupToken(process.env.APP_BACKUP_SOURCE_TOKEN);
const sourceUrl = process.env.APP_BACKUP_SOURCE_URL;
const sourceApp = process.env.APP_BACKUP_SOURCE_APP;
if (!sourceUrl || !sourceApp) throw new Error('Backup source URL and app are required');
const dataDir = process.env.APP_BACKUP_DIR ?? '/data/backups';
const receiver = new BackupReceiver({ dataDir, sourceUrl, sourceToken });
await receiver.initialize();
let stopping = false;
const server = createServer(async (request, response) => {
  if (!authorized(request, token)) { jsonResponse(response, 401, { error: 'unauthorized' }); return; }
  try {
    if (request.method === 'GET' && request.url === '/status') { jsonResponse(response, 200, receiver.status()); return; }
    if (request.method === 'POST' && request.url === '/backups') {
      if (stopping) { jsonResponse(response, 503, { error: 'stopping' }); return; }
      const value = await readBackupJson(request);
      if (!value || typeof value !== 'object' || !('id' in value) || !backupId(value.id)
        || !('kind' in value) || !['hourly', 'release'].includes(String(value.kind))) {
        jsonResponse(response, 400, { error: 'invalid_request' }); return;
      }
      const input = value as BackupRequest;
      if (input.expectedSourceApp && input.expectedSourceApp !== sourceApp) {
        jsonResponse(response, 400, { error: 'source_mismatch' }); return;
      }
      jsonResponse(response, 200, await receiver.create({ ...input, expectedSourceApp: sourceApp })); return;
    }
    if (request.method === 'GET' && request.url?.startsWith('/backups/')) {
      const id = request.url.slice('/backups/'.length);
      const receipt = backupId(id) ? receiver.status().backups.find(r => r.id === id) : undefined;
      if (!receipt) { jsonResponse(response, 404, { error: 'not_found' }); return; }
      // Open before publishing headers so a retention race cannot serve an empty success.
      const stream = createReadStream(path.join(dataDir, receipt.fileName));
      await new Promise<void>((resolve, reject) => { stream.once('open', () => resolve()); stream.once('error', reject); });
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': receipt.bytes,
        'x-backup-sha256': receipt.sha256, 'cache-control': 'no-store' });
      await pipeline(stream, response); return;
    }
    jsonResponse(response, 404, { error: 'not_found' });
  } catch {
    if (!response.headersSent) jsonResponse(response, receiver.status().busy ? 409 : 503, { error: 'backup_operation_failed' });
    else response.destroy();
  }
});
server.requestTimeout = 16 * 60_000;
server.headersTimeout = 15_000;
server.listen(Number(process.env.PORT ?? '9093'), '::');

// Poll eligibility instead of an in-memory one-hour sleep: restarts catch up and
// a failure retries in a minute; successful manual captures also satisfy freshness.
const tick = async () => {
  const status = receiver.status();
  const latest = status.lastSuccessfulBackup;
  if (stopping || status.busy || (latest && Date.now() - Date.parse(latest.startedAt) < 60 * 60_000)) return;
  try {
    const receipt = await receiver.create({ id: `hourly-${randomUUID()}`, kind: 'hourly', expectedSourceApp: sourceApp });
    console.log(JSON.stringify({ event: 'backup_completed', id: receipt.id, bytes: receipt.bytes, capturedAt: receipt.startedAt }));
  } catch { console.error(JSON.stringify({ event: 'backup_failed', at: new Date().toISOString() })); }
};
const timer = setInterval(() => void tick(), 60_000);
void tick();
const stop = async () => {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  await new Promise<void>(resolve => server.close(() => resolve()));
  while (receiver.status().busy) await new Promise(resolve => setTimeout(resolve, 100));
  await receiver.close();
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
