import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { parseReceipt, syncFile } from './receiver.ts';
import {
  confirmExisting, OffsiteError, offsiteKey, prepareOffsiteObject, putOffsiteObject, s3Status,
  type ObserveS3, type OffsiteObject,
} from './offsite-object.ts';
import type { BackupReceipt } from './types.ts';

const HOUR = 3_600_000;
type Confirmed = OffsiteObject & { confirmedAt: string };
type State = { pending: OffsiteObject | null; confirmed: Confirmed | null };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function parseObject(value: unknown, sourceApp: string): OffsiteObject {
  if (!record(value) || typeof value.gzipBytes !== 'number' || !Number.isSafeInteger(value.gzipBytes)
    || value.gzipBytes < 1 || typeof value.gzipSha256 !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value.gzipSha256)) {
    throw new OffsiteError('invalid_offsite_receipt');
  }
  const capture = parseReceipt(value.capture);
  if (capture.sourceApp !== sourceApp) throw new OffsiteError('invalid_offsite_source');
  const anchor = value.scheduledAt;
  if (typeof anchor !== 'string' || !Number.isFinite(Date.parse(anchor)) || new Date(anchor).toISOString() !== anchor
    || anchor > capture.startedAt || Date.parse(capture.startedAt) - Date.parse(anchor) > HOUR) {
    throw new OffsiteError('invalid_offsite_schedule_anchor');
  }
  return { capture, scheduledAt: anchor, gzipBytes: value.gzipBytes, gzipSha256: value.gzipSha256 };
}

type Options = {
  dataDir: string; sourceApp: string; bucket: string; region: string; client: S3Client;
  scratchDir?: string; now?: () => number; log?: (event: Record<string, unknown>) => void;
};

export class OffsiteBackup {
  private state: State = { pending: null, confirmed: null };
  private initialized = false;
  private operation: Promise<void> | null = null;
  private readonly shutdown = new AbortController();
  private retryAfter = 0;
  private failures = 0;
  private readonly clock: () => number;
  private readonly receiptPath: string;
  private readonly scratch: string;

  constructor(private readonly options: Options) {
    this.clock = options.now ?? Date.now;
    this.receiptPath = path.join(options.dataDir, '.offsite-receipt.json');
    // The receiver's directory lock grants exclusive ownership of this scratch file.
    const owner = createHash('sha256').update(path.resolve(options.dataDir)).digest('hex').slice(0, 16);
    this.scratch = path.join(options.scratchDir ?? os.tmpdir(), `sqlite-offsite-${owner}`);
  }

  status() {
    const receipt = this.state.confirmed;
    return { lastConfirmed: receipt ? {
      id: receipt.capture.id, key: offsiteKey(receipt.capture), startedAt: receipt.capture.startedAt,
      confirmedAt: receipt.confirmedAt,
    } : null };
  }

  poll(scheduled: BackupReceipt | null, latest: BackupReceipt | null): Promise<void> {
    if (this.operation) return this.operation;
    if (this.shutdown.signal.aborted || this.clock() < this.retryAfter) return Promise.resolve();
    this.operation = this.run(scheduled, latest).finally(() => { this.operation = null; });
    return this.operation;
  }

  async close() {
    this.shutdown.abort();
    await this.operation;
    this.options.client.destroy();
  }

  private async initialize() {
    let raw: string;
    try { raw = await fs.readFile(this.receiptPath, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.initialized = true;
      return;
    }
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1) throw new OffsiteError('invalid_offsite_receipt');
    if (value.bucket === this.options.bucket && value.region === this.options.region && value.sourceApp === this.options.sourceApp) {
      const pending = value.pending === null ? null : parseObject(value.pending, this.options.sourceApp);
      let confirmed: Confirmed | null = null;
      if (value.confirmed !== null) {
        const object = parseObject(value.confirmed, this.options.sourceApp);
        const at = record(value.confirmed) && value.confirmed.confirmedAt;
        if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at
          || Date.parse(at) < Date.parse(object.capture.startedAt)) throw new OffsiteError('invalid_offsite_confirmation');
        confirmed = { ...object, confirmedAt: at };
      }
      this.state = { pending, confirmed };
    }
    this.initialized = true;
  }

  private async save(state: State) {
    const { bucket, region, dataDir, sourceApp } = this.options;
    const partial = this.receiptPath + '.part';
    await fs.writeFile(partial, JSON.stringify({ version: 1, bucket, region, sourceApp, ...state }), { mode: 0o600 });
    await syncFile(partial);
    await fs.rename(partial, this.receiptPath);
    await syncFile(dataDir);
    this.state = state;
  }

  private fresh(capture: BackupReceipt) {
    const age = this.clock() - Date.parse(capture.startedAt);
    return capture.sourceApp === this.options.sourceApp && age >= 0 && age <= HOUR;
  }

  private async run(scheduled: BackupReceipt | null, latest: BackupReceipt | null) {
    const started = this.clock();
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(20 * 60_000)]);
    const { bucket, dataDir, client } = this.options;
    const staged = path.join(this.scratch, 'backup.sqlite.gz.part');
    const traffic = { bodyBytesRead: 0 };
    const log = this.options.log ?? (event => console.log(JSON.stringify(event)));
    const context: Record<string, unknown> = {
      event: 'offsite_backup', purpose: 'sqlite-backup', app: process.env.FLY_APP_NAME,
      machine: process.env.FLY_MACHINE_ID, revision: process.env.APP_REVISION,
      operationId: randomUUID(), retries: this.failures,
    };
    const observe: ObserveS3 = async (operation, send) => {
      const requestStart = this.clock();
      try {
        const response = await send();
        log({ ...context, event: 'offsite_s3_request', operation, requestId: response.$metadata.requestId,
          httpStatus: response.$metadata.httpStatusCode, outcome: 'ok', durationMs: this.clock() - requestStart });
        return response;
      } catch (error) {
        log({ ...context, event: 'offsite_s3_request', operation, httpStatus: s3Status(error), outcome: 'failed',
          requestId: error instanceof S3ServiceException ? error.$metadata.requestId : undefined, durationMs: this.clock() - requestStart });
        throw error;
      }
    };
    let usedScratch = false;
    try {
      if (!this.initialized) {
        await this.initialize();
        await fs.rm(staged, { force: true });
      }
      const confirmed = this.state.confirmed;
      if (confirmed && started - Date.parse(confirmed.scheduledAt) < 12 * HOUR) return;
      // Only a fresh scheduled anchor starts a due upload. If a manual or release
      // capture completed more recently, its bytes win without moving the next deadline.
      const anchor = scheduled && this.fresh(scheduled) ? scheduled : null;
      const capture = anchor && latest && this.fresh(latest) && latest.startedAt >= anchor.startedAt ? latest : anchor;
      const pending = this.state.pending;
      if (pending) {
        Object.assign(context, { operation: 'HeadObject', key: offsiteKey(pending.capture), sqliteBytes: pending.capture.bytes,
          gzipBytes: pending.gzipBytes });
        let existing;
        try {
          existing = await confirmExisting(client, bucket, pending, signal, observe);
        } catch (error) {
          if (!(error instanceof OffsiteError) || error.message !== 'existing_object_mismatch' || !capture
            || offsiteKey(capture) === offsiteKey(pending.capture)) throw error;
          // Leave a conflicting key untouched. It cannot permanently prevent a
          // different, verified capture from becoming the next recovery point.
          log({ ...context, outcome: 'failed', code: error.message, durationMs: this.clock() - started });
        }
        if (existing) {
          await this.save({ pending: null, confirmed: { ...pending, confirmedAt: new Date(this.clock()).toISOString() } });
          this.failures = 0;
          log({ ...context, outcome: 'confirmed_existing', requestId: existing.requestId, durationMs: this.clock() - started });
          return;
        }
        // No further requests for an unconfirmed key until a fresh local capture is eligible.
        if (!capture) { this.retryAfter = this.clock() + 15 * 60_000; return; }
      }
      if (!capture || !anchor) return;
      Object.assign(context, { operation: 'PutObject', key: offsiteKey(capture), sqliteBytes: capture.bytes });
      await fs.mkdir(this.scratch, { recursive: true, mode: 0o700 });
      usedScratch = true;
      await fs.rm(staged, { force: true });
      const object = await prepareOffsiteObject(capture, anchor.startedAt, path.join(dataDir, capture.fileName), this.scratch, staged, signal);
      context.gzipBytes = object.gzipBytes;
      if (!this.fresh(capture)) return;
      // If S3 accepts the bytes and our process loses the response, reconcile
      // the exact key and digest even after receiver retention removes the source.
      await this.save({ pending: object, confirmed });
      const result = await putOffsiteObject(client, bucket, object, staged, signal, traffic, observe);
      await this.save({ pending: null, confirmed: { ...object, confirmedAt: new Date(this.clock()).toISOString() } });
      this.failures = 0;
      log({ ...context, outcome: result.outcome, requestId: result.requestId, ...traffic, durationMs: this.clock() - started });
    } catch (error) {
      this.failures++;
      this.retryAfter = this.clock() + Math.min(15, 2 ** Math.min(4, this.failures - 1)) * 60_000;
      log({ ...context, outcome: 'failed', code: error instanceof OffsiteError ? error.message : 'offsite_operation_failed',
        httpStatus: s3Status(error), ...traffic, durationMs: this.clock() - started });
    } finally {
      if (usedScratch) {
        try { await fs.rm(staged, { force: true }); }
        catch { log({ ...context, outcome: 'scratch_cleanup_failed' }); }
      }
    }
  }
}

export function configuredOffsite(dataDir: string, sourceApp: string): OffsiteBackup | null {
  const bucket = process.env.APP_BACKUP_S3_BUCKET;
  if (!bucket) return null;
  const region = process.env.APP_BACKUP_S3_REGION ?? '';
  const client = new S3Client({
    region: async () => {
      if (!region) throw new OffsiteError('missing_writer_region');
      return region;
    },
    credentials: async () => {
      const accessKeyId = process.env.APP_BACKUP_S3_ACCESS_KEY_ID;
      const secretAccessKey = process.env.APP_BACKUP_S3_SECRET_ACCESS_KEY;
      if (!accessKeyId || !secretAccessKey) throw new OffsiteError('missing_writer_credentials');
      return { accessKeyId, secretAccessKey };
    },
    maxAttempts: 1, ignoreConfiguredEndpointUrls: true, customUserAgent: 'sqlite-backup-receiver',
  });
  return new OffsiteBackup({ bucket, region, client, dataDir, sourceApp, scratchDir: process.env.APP_BACKUP_S3_SCRATCH_DIR });
}
