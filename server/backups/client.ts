import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { open, link, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BackupReceipt, BackupRequest, BackupStatus } from './types.ts';
import { backupId, requireBackupToken } from './http.ts';

export function backupClientConfig() {
  const url = process.env.APP_BACKUP_RECEIVER_URL;
  if (!url) throw new Error('APP_BACKUP_RECEIVER_URL is required');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid backup receiver URL');
  return { url: url.replace(/\/$/, ''), token: requireBackupToken(process.env.APP_BACKUP_RECEIVER_TOKEN) };
}
export function parseBackupReceipt(value: unknown): BackupReceipt {
  if (!value || typeof value !== 'object') throw new Error('Invalid backup receipt');
  const r = value as Partial<BackupReceipt>;
  if (r.version !== 1 || !backupId(r.id) || !['hourly', 'release'].includes(r.kind ?? '')
    || typeof r.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(r.sourceRevision)
    || typeof r.sourceApp !== 'string' || !r.sourceApp
    || typeof r.bytes !== 'number' || !Number.isSafeInteger(r.bytes) || r.bytes < 512
    || typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256)
    || typeof r.startedAt !== 'string' || !Number.isFinite(Date.parse(r.startedAt))
    || typeof r.completedAt !== 'string' || !Number.isFinite(Date.parse(r.completedAt))
    || typeof r.receivedAt !== 'string' || !Number.isFinite(Date.parse(r.receivedAt))
    || typeof r.fileName !== 'string' || r.fileName !== `${r.id}.sqlite`
    || (r.kind === 'release' && !backupId(r.releaseId))) throw new Error('Invalid backup receipt');
  return r as BackupReceipt;
}
// Native HTTP honors our overall deadline without fetch's independent five-minute
// response-header timeout. Full SQLite verification can legitimately take longer.
function postBackup(url: string, token: string, input: BackupRequest, signal: AbortSignal): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(`${url}/backups`);
    const body = JSON.stringify(input);
    const request = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(endpoint, {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) { response.destroy(new Error('Backup receipt too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject); request.end(body);
  });
}
export async function requestHostedBackup(input: BackupRequest): Promise<BackupReceipt> {
  const { url, token } = backupClientConfig();
  const signal = AbortSignal.timeout(15 * 60_000);
  let response: {status: number; body: string};
  for (;;) {
    response = await postBackup(url, token, input, signal);
    if (response.status !== 409) break;
    // A busy refusal has not started this request. Keep the same id and wait
    // within one overall deadline; never retry an ambiguous timeout or failure.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  if (response.status !== 200) throw new Error(`Backup receiver refused request (${response.status})`);
  const receipt = parseBackupReceipt(JSON.parse(response.body));
  if (receipt.id !== input.id || receipt.kind !== input.kind || receipt.releaseId !== input.releaseId
    || (input.expectedSourceRevision && receipt.sourceRevision !== input.expectedSourceRevision)
    || (input.expectedSourceApp && receipt.sourceApp !== input.expectedSourceApp)) throw new Error('Backup receipt does not match requested source and operation');
  return receipt;
}
export async function readBackupReceiverStatus(): Promise<BackupStatus> {
  const { url, token } = backupClientConfig();
  const response = await fetch(`${url}/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Backup receiver unavailable');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('backups' in result) || !Array.isArray(result.backups)) throw new Error('Invalid backup status');
  const status = result as BackupStatus;
  status.backups = result.backups.map(parseBackupReceipt);
  if (status.lastSuccessfulBackup) status.lastSuccessfulBackup = parseBackupReceipt(status.lastSuccessfulBackup);
  return status;
}
async function assertRestoreDestinationUnused(destination: string) {
  for (const file of [destination, `${destination}-wal`, `${destination}-shm`, `${destination}-journal`]) {
    try { await lstat(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw Object.assign(new Error('Restore destination or SQLite sidecar already exists; use a fresh isolated path'), { code: 'EEXIST' });
  }
}
export async function downloadHostedBackup(receipt: BackupReceipt, destination: string) {
  await assertRestoreDestinationUnused(destination);
  const { url, token } = backupClientConfig();
  const response = await fetch(`${url}/backups/${receipt.id}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok || !response.body) throw new Error('Backup download unavailable');
  const temporary = `${destination}.incoming`;
  const hash = createHash('sha256'); let bytes = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length; hash.update(chunk);
    callback(bytes > receipt.bytes ? new Error('Backup exceeds receipt size') : null, chunk);
  } });
  const output = await open(temporary, 'wx', 0o600);
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter, output.createWriteStream());
    if (bytes !== receipt.bytes || hash.digest('hex') !== receipt.sha256) throw new Error('Backup download checksum mismatch');
    const synced = await open(temporary, 'r+');
    try { await synced.sync(); } finally { await synced.close(); }
    // Publication must not overwrite a valued database. The caller supplies a new path.
    await assertRestoreDestinationUnused(destination);
    await link(temporary, destination);
    const directory = await open(path.dirname(destination), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await output.close(); await rm(temporary, { force: true }); }
}
