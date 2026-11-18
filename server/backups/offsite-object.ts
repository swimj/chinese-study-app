import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import {
  HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException,
} from '@aws-sdk/client-s3';
import type { BackupReceipt } from './types.ts';

export type OffsiteObject = { capture: BackupReceipt; scheduledAt: string; gzipBytes: number; gzipSha256: string };

export function offsiteKey(capture: BackupReceipt): string {
  return `sqlite-backups/${capture.sourceApp}/${capture.startedAt.slice(0, 10)}/${capture.startedAt}-${capture.id}.sqlite.gz`;
}

function metadata(capture: BackupReceipt): Record<string, string> {
  return {
    'backup-id': capture.id, 'backup-kind': capture.kind, 'source-app': capture.sourceApp,
    'source-revision': capture.sourceRevision, 'capture-started-at': capture.startedAt,
    'capture-completed-at': capture.completedAt, 'sqlite-bytes': String(capture.bytes),
    'sqlite-sha256': capture.sha256, ...(capture.releaseId && { 'release-id': capture.releaseId }),
  };
}

export class OffsiteError extends Error {}

function digestStream() {
  const hash = createHash('sha256');
  const result = { bytes: 0, hash, stream: new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      result.bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  }) };
  return result;
}

// Stage outside the hourly/release store. A single checked PutObject needs both
// a known length and digest. Opening the SQLite inode protects it across pruning.
export async function prepareOffsiteObject(capture: BackupReceipt, scheduledAt: string, sourcePath: string, scratch: string,
  staged: string, signal: AbortSignal): Promise<OffsiteObject> {
  const [space, sourceDir, scratchDir] = await Promise.all([statfs(scratch), stat(path.dirname(sourcePath)), stat(scratch)]);
  // gzip can slightly expand incompressible input. When an operator places scratch
  // on the receiver volume, reserve room for another concurrent local capture.
  const sharedVolumeReserve = sourceDir.dev === scratchDir.dev ? capture.bytes + 64 * 1024 ** 2 : 0;
  if (space.bavail * space.bsize < capture.bytes * 1.01 + 64 * 1024 ** 2 + sharedVolumeReserve) {
    throw new OffsiteError('offsite_scratch_full');
  }
  const file = await open(sourcePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== capture.bytes) throw new OffsiteError('sqlite_size_mismatch');
    const sqlite = digestStream();
    const gzip = digestStream();
    await pipeline(file.createReadStream(), sqlite.stream,
      createGzip({ level: 1 }), gzip.stream, createWriteStream(staged, { flags: 'wx', mode: 0o600 }), { signal });
    if (sqlite.bytes !== capture.bytes || sqlite.hash.digest('hex') !== capture.sha256) {
      throw new OffsiteError('sqlite_checksum_mismatch');
    }
    return { capture, scheduledAt, gzipBytes: gzip.bytes, gzipSha256: gzip.hash.digest('base64') };
  } finally { await file.close(); }
}

type ResponseMetadata = { $metadata: { requestId?: string; httpStatusCode?: number } };
export type ObserveS3 = <T extends ResponseMetadata>(operation: 'PutObject' | 'HeadObject', send: () => Promise<T>) => Promise<T>;
export type PutEvidence = { requestId?: string; outcome: 'created' | 'already_exists' };

export function s3Status(error: unknown): number | undefined {
  return error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
}

export async function confirmExisting(client: S3Client, bucket: string, object: OffsiteObject,
  signal: AbortSignal, observe: ObserveS3): Promise<{ requestId?: string } | null> {
  const result = await observe('HeadObject', () => client.send(new HeadObjectCommand({
    Bucket: bucket, Key: offsiteKey(object.capture), ChecksumMode: 'ENABLED',
  }), { abortSignal: signal })).catch((error: unknown) => {
    // A writer without ListBucket can get 403 for an absent key. Both cases
    // leave the receipt unconfirmed; any subsequent PUT is create-only.
    if (s3Status(error) === 403 || s3Status(error) === 404) return null;
    throw error;
  });
  if (!result) return null;
  if (result.ContentLength !== object.gzipBytes || result.ChecksumSHA256 !== object.gzipSha256
    || !Object.entries(metadata(object.capture)).every(([key, value]) => result.Metadata?.[key] === value)) {
    throw new OffsiteError('existing_object_mismatch');
  }
  return { requestId: result.$metadata.requestId };
}

export async function putOffsiteObject(client: S3Client, bucket: string, object: OffsiteObject,
  staged: string, signal: AbortSignal, traffic: { bodyBytesRead: number }, observe: ObserveS3): Promise<PutEvidence> {
  const body = createReadStream(staged);
  try {
    const result = await observe('PutObject', () => client.send(new PutObjectCommand({
      Bucket: bucket, Key: offsiteKey(object.capture), Body: body,
      IfNoneMatch: '*', ContentLength: object.gzipBytes, ContentType: 'application/gzip',
      ChecksumSHA256: object.gzipSha256, Metadata: metadata(object.capture), ServerSideEncryption: 'AES256',
    }), { abortSignal: signal }));
    if (result.ChecksumSHA256 !== object.gzipSha256) throw new OffsiteError('s3_checksum_unconfirmed');
    return { requestId: result.$metadata.requestId, outcome: 'created' };
  } catch (error) {
    if (s3Status(error) !== 412) throw error;
    const existing = await confirmExisting(client, bucket, object, signal, observe);
    if (!existing) throw new OffsiteError('existing_object_unconfirmed');
    return { requestId: existing.requestId, outcome: 'already_exists' };
  } finally {
    traffic.bodyBytesRead = body.bytesRead;
    body.destroy();
  }
}
