import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BackupReceipt, BackupRequest, BackupStatus } from './types.ts';
import { SCHEDULE_INTERVAL_MS } from './schedule.ts';

const exec = promisify(execFile);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const APP = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SHA = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const DAY = 86_400_000;
const DEFAULT_MAX_BYTES = 4 * 1024 ** 3;

// The original receiver recorded its timer's randomUUID in the id only.
const LEGACY_SCHEDULED_ID = /^hourly-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function isScheduled(receipt: BackupReceipt): boolean {
  return receipt.kind === 'hourly' && (receipt.captureOrigin === 'scheduled'
    || (receipt.captureOrigin === undefined && LEGACY_SCHEDULED_ID.test(receipt.id)));
}

export class BackupReceiverError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'BackupReceiverError'; }
}
function fail(code: string): never { throw new BackupReceiverError(code); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
function validateRequest(request: BackupRequest) {
  if (!request || !ID.test(request.id) || !['hourly', 'release'].includes(request.kind)
    || (request.expectedSourceRevision !== undefined && !REVISION.test(request.expectedSourceRevision))
    || (request.expectedSourceApp !== undefined && !APP.test(request.expectedSourceApp))
    || (request.releaseId !== undefined && !ID.test(request.releaseId))
    || (request.kind === 'release' && request.releaseId === undefined)) fail('invalid_request');
}
export function parseReceipt(value: unknown): BackupReceipt {
  if (!record(value) || value.version !== 1 || typeof value.id !== 'string' || !ID.test(value.id)
    || !['hourly', 'release'].includes(String(value.kind))
    || (value.captureOrigin !== undefined && value.captureOrigin !== 'scheduled' && value.captureOrigin !== 'manual')
    || (value.kind === 'release' && value.captureOrigin === 'scheduled')
    || (value.releaseId !== undefined && (typeof value.releaseId !== 'string' || !ID.test(value.releaseId)))
    || (value.kind === 'release' && value.releaseId === undefined)
    || typeof value.sourceApp !== 'string' || !APP.test(value.sourceApp)
    || typeof value.sourceRevision !== 'string' || !REVISION.test(value.sourceRevision)
    || !validTime(value.startedAt) || !validTime(value.completedAt) || !validTime(value.receivedAt)
    || Date.parse(value.completedAt) < Date.parse(value.startedAt)
    || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes <= 0
    || typeof value.sha256 !== 'string' || !SHA.test(value.sha256)
    || value.fileName !== `${value.id}.sqlite`) fail('invalid_stored_receipt');
  return value as unknown as BackupReceipt;
}
export async function syncFile(file: string) {
  const handle = await fs.open(file, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function digest(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
async function verifyDatabase(file: string, timeoutMs: number) {
  // SQLite integrity checking can take seconds on a large database. Keep it out
  // of the receiver's event loop so health and duplicate-job requests still work.
  const script = `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});try {const rows=d.prepare('PRAGMA integrity_check').all();if(rows.length!==1||Object.values(rows[0])[0]!=='ok')process.exitCode=2;if(d.prepare('PRAGMA foreign_key_check').get())process.exitCode=3;}finally{d.close();}`;
  try { await exec(process.execPath, ['-e', script, file], { timeout: timeoutMs, maxBuffer: 64 * 1024 }); }
  catch { fail('sqlite_validation_failed'); }
}

export type BackupReceiverOptions = {
  dataDir: string;
  sourceUrl: string;
  sourceToken: string;
  maxBytes?: number;
  timeoutMs?: number;
  now?: () => Date;
};
type Owner = { pid: number; boot: string; token: string };

export class BackupReceiver {
  private receipts: BackupReceipt[] = [];
  private busy = false;
  private initialized = false;
  private lastError: BackupStatus['lastError'] = null;
  private owner: Owner | null = null;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly directory: string;

  constructor(private readonly options: BackupReceiverOptions) {
    if (!path.isAbsolute(options.dataDir) || !options.sourceToken) fail('invalid_configuration');
    const url = new URL(options.sourceUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('invalid_configuration');
    this.directory = options.dataDir;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.now = options.now ?? (() => new Date());
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) fail('invalid_configuration');
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.owner) fail('already_initialized');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.acquireLock();
    try {
      this.receipts = [];
      const names = await fs.readdir(this.directory);
      for (const name of names) {
        // Only owned temporary names are disposable; retain orphan completed
        // databases after crashes for inspection instead of guessing their fate.
        if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.(sqlite|json)\.part$/.test(name)) {
          await fs.unlink(path.join(this.directory, name));
        } else if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.json$/.test(name)) {
          const receipt = parseReceipt(JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')));
          if (name !== `${receipt.id}.json`) fail('invalid_stored_receipt');
          const stat = await fs.lstat(path.join(this.directory, receipt.fileName));
          if (!stat.isFile() || stat.size !== receipt.bytes) fail('stored_backup_missing_or_wrong_size');
          this.receipts.push(receipt);
        }
      }
      this.initialized = true;
    } catch (error) { await this.close(); throw error; }
  }

  status(): BackupStatus {
    const backups = this.receipts.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    const lastScheduled = backups.find(isScheduled);
    return {
      busy: this.busy,
      lastScheduledBackup: lastScheduled ? { ...lastScheduled } : null,
      lastSuccessfulBackup: backups[0] ? { ...backups[0] } : null,
      backups: backups.map(r => ({ ...r })),
      lastError: this.lastError ? { ...this.lastError } : null,
    };
  }

  scheduledBackupDue(): boolean {
    const latest = this.status().lastScheduledBackup;
    return !latest || this.now().getTime() - Date.parse(latest.startedAt) >= SCHEDULE_INTERVAL_MS;
  }

  createScheduled(sourceApp: string): Promise<BackupReceipt> {
    return this.capture({ id: `hourly-${randomUUID()}`, kind: 'hourly', expectedSourceApp: sourceApp }, 'scheduled');
  }

  create(request: BackupRequest): Promise<BackupReceipt> {
    return this.capture(request, 'manual');
  }

  private async capture(request: BackupRequest, captureOrigin: 'scheduled' | 'manual'): Promise<BackupReceipt> {
    validateRequest(request);
    if (!this.initialized) fail('not_initialized');
    if (this.busy) fail('backup_busy');
    this.busy = true;
    const requestedAt = this.now().getTime();
    const partial = path.join(this.directory, `${request.id}.sqlite.part`);
    const receiptPartial = path.join(this.directory, `${request.id}.json.part`);
    try {
      const previous = this.receipts.find(r => r.id === request.id);
      if (previous) {
        if (previous.kind !== request.kind || previous.releaseId !== request.releaseId
          || (request.expectedSourceApp && previous.sourceApp !== request.expectedSourceApp)
          || (request.expectedSourceRevision && previous.sourceRevision !== request.expectedSourceRevision)) fail('backup_id_conflict');
        if (await digest(path.join(this.directory, previous.fileName)) !== previous.sha256) fail('stored_backup_checksum_mismatch');
        return { ...previous };
      }
      if (request.kind === 'release' && this.receipts.some(r => r.kind === 'release' && r.releaseId === request.releaseId)) fail('release_already_backed_up');
      const fileName = `${request.id}.sqlite`;
      try { await fs.lstat(path.join(this.directory, fileName)); fail('orphan_backup_requires_inspection'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const signal = AbortSignal.timeout(this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(new URL('/backup', this.options.sourceUrl), {
          method: 'POST', headers: { authorization: `Bearer ${this.options.sourceToken}`, 'content-type': 'application/json' },
          // Scheduled captures yield CPU to learner requests; release and manual captures run at full speed.
          body: JSON.stringify({ id: request.id, ...(captureOrigin === 'scheduled' ? { priority: 'background' } : {}) }),
          signal, redirect: 'error',
        });
      } catch { fail('source_request_failed'); }
      if (!response.ok) { await response.body?.cancel(); fail(`source_http_${response.status}`); }
      const id = response.headers.get('x-backup-id');
      const sourceApp = response.headers.get('x-backup-source-app');
      const sourceRevision = response.headers.get('x-backup-source-revision');
      const startedAt = response.headers.get('x-backup-started-at');
      const completedAt = response.headers.get('x-backup-completed-at');
      const expectedHash = response.headers.get('x-backup-sha256');
      const rawLength = response.headers.get('content-length');
      const bytes = Number(rawLength);
      if (!sourceApp || !APP.test(sourceApp) || (request.expectedSourceApp && sourceApp !== request.expectedSourceApp)
        || id !== request.id || !sourceRevision || !REVISION.test(sourceRevision)
        || (request.expectedSourceRevision && sourceRevision !== request.expectedSourceRevision)
        || !validTime(startedAt) || !validTime(completedAt) || Date.parse(completedAt) < Date.parse(startedAt)
        || Date.parse(startedAt) < requestedAt - 300_000
        || Date.parse(completedAt) > this.now().getTime() + 300_000
        || !expectedHash || !SHA.test(expectedHash) || !rawLength || !/^\d+$/.test(rawLength)
        || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.maxBytes
        || !response.body || response.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream') {
        await response.body?.cancel(); fail('invalid_source_metadata');
      }
      const space = await fs.statfs(this.directory);
      if (space.bavail * space.bsize < bytes + 64 * 1024 ** 2) {
        await response.body.cancel(); fail('insufficient_backup_space');
      }
      const hash = createHash('sha256'); let received = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > bytes) { callback(new BackupReceiverError('backup_size_mismatch')); return; }
        hash.update(chunk); callback(null, chunk);
      } });
      try {
        await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter,
          createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal });
      } catch { fail('backup_transfer_failed'); }
      if (received !== bytes || hash.digest('hex') !== expectedHash) fail('backup_checksum_mismatch');
      await verifyDatabase(partial, this.timeoutMs);
      await syncFile(partial);
      const receipt: BackupReceipt = { version: 1, id: request.id, kind: request.kind, captureOrigin,
        ...(request.releaseId ? { releaseId: request.releaseId } : {}), sourceRevision, sourceApp,
        startedAt, completedAt, receivedAt: this.now().toISOString(), bytes, sha256: expectedHash, fileName };
      await fs.writeFile(receiptPartial, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
      await syncFile(receiptPartial);
      await fs.rename(partial, path.join(this.directory, fileName));
      await syncFile(this.directory);
      await fs.rename(receiptPartial, path.join(this.directory, `${request.id}.json`));
      await syncFile(this.directory);
      this.receipts.push(receipt);
      await this.prune();
      this.lastError = null;
      return { ...receipt };
    } catch (error) {
      const code = error instanceof BackupReceiverError ? error.code : 'backup_storage_failed';
      this.lastError = { at: this.now().toISOString(), code };
      throw new BackupReceiverError(code);
    } finally {
      try { await Promise.all([partial, receiptPartial].map(file => fs.rm(file, { force: true }))); }
      finally { this.busy = false; }
    }
  }

  async close(): Promise<void> {
    if (this.busy) fail('backup_busy');
    if (this.owner) {
      const lock = path.join(this.directory, '.receiver-lock');
      const owner: unknown = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
      if (!record(owner) || owner.token !== this.owner.token) fail('receiver_lock_changed');
      await fs.rm(lock, { recursive: true }); this.owner = null;
    }
    this.initialized = false;
  }

  private async prune() {
    const newest = [...this.receipts].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    const keep = new Set(newest.filter(isScheduled).slice(0, 5).map(r => r.id));
    const latestManual = newest.find(r => r.kind === 'hourly' && !isScheduled(r));
    if (latestManual) keep.add(latestManual.id);
    for (const r of newest.filter(r => r.kind === 'release' && Date.parse(r.startedAt) > this.now().getTime() - 7 * DAY).slice(0, 3)) keep.add(r.id);
    for (const receipt of newest) if (!keep.has(receipt.id)) {
      // Delete the receipt first: a crash can leave an unreferenced old file,
      // never a success receipt whose file was intentionally deleted.
      await fs.unlink(path.join(this.directory, `${receipt.id}.json`));
      await syncFile(this.directory);
      this.receipts = this.receipts.filter(r => r.id !== receipt.id);
      await fs.unlink(path.join(this.directory, receipt.fileName));
    }
    await syncFile(this.directory);
  }

  private async acquireLock() {
    let boot: string;
    try { boot = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(); }
    catch { boot = os.hostname(); }
    const owner: Owner = { pid: process.pid, boot, token: randomUUID() };
    const lock = path.join(this.directory, '.receiver-lock');
    const candidate = path.join(this.directory, `.receiver-candidate-${owner.token}`);
    await fs.mkdir(candidate, { mode: 0o700 });
    try {
      await fs.writeFile(path.join(candidate, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      await syncFile(path.join(candidate, 'owner.json'));
      await syncFile(candidate);
      try { await fs.rename(candidate, lock); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        const previous: unknown = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
        if (!record(previous) || typeof previous.pid !== 'number' || !Number.isSafeInteger(previous.pid)
          || previous.pid <= 0 || typeof previous.boot !== 'string' || typeof previous.token !== 'string') fail('receiver_lock_requires_inspection');
        if (previous.boot === boot) {
          try { process.kill(previous.pid, 0); fail('receiver_already_running'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
        // Claim stale-owner recovery before moving its directory. Re-read the
        // token under the claim so concurrent starts cannot move a new owner's
        // lock after observing the same old owner. Interrupted recovery fails
        // closed rather than allowing two writers onto the volume.
        const claim = path.join(lock, 'reclaim');
        try { await fs.mkdir(claim); } catch { fail('receiver_lock_requires_inspection'); }
        const current: unknown = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
        if (!record(current) || current.token !== previous.token) {
          await fs.rmdir(claim); fail('receiver_already_running');
        }
        await fs.rename(lock, path.join(this.directory, `.receiver-stale-${randomUUID()}`));
        try { await fs.rename(candidate, lock); } catch { fail('receiver_already_running'); }
      }
      this.owner = owner;
      await syncFile(this.directory);
    } finally { await fs.rm(candidate, { recursive: true, force: true }); }
  }
}
