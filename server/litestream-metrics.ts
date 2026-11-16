import { get } from 'node:http';

export type LitestreamMetrics = {
  cpuSeconds: number;
  startTimeSeconds: number;
  localFileSequence: number;
  uploadedFiles: number | null;
};

/** Read only the local daemon. Never forward its raw labels or response body. */
export async function readLitestreamMetrics(options: {
  databasePath: string;
  port?: number;
  timeoutMs?: number;
}): Promise<LitestreamMetrics | null> {
  return new Promise((resolve) => {
    const request = get({
      hostname: '127.0.0.1',
      port: options.port ?? 9090,
      path: '/metrics',
      headers: { accept: 'text/plain' },
    });
    const deadline = setTimeout(() => request.destroy(new Error('Metrics timeout')), options.timeoutMs ?? 1_500);
    const finish = (result: LitestreamMetrics | null) => {
      clearTimeout(deadline);
      resolve(result);
    };
    request.on('error', () => finish(null));
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        response.destroy();
        finish(null);
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256 * 1_024) {
          response.destroy();
          finish(null);
        } else {
          chunks.push(chunk);
        }
      });
      response.on('error', () => finish(null));
      response.on('aborted', () => finish(null));
      response.on('end', () => finish(parseLitestreamMetrics(Buffer.concat(chunks).toString('utf8'), options.databasePath)));
    });
  });
}

/** Exact v0.5.16 allowlist. Missing/invalid required samples fail closed. */
export function parseLitestreamMetrics(text: string, databasePath: string): LitestreamMetrics | null {
  const values = new Map<string, number>();
  const names = new Map([
    ['process_cpu_seconds_total', 'cpuSeconds'],
    ['process_start_time_seconds', 'startTimeSeconds'],
    [`litestream_txid{db=${JSON.stringify(databasePath)}}`, 'localFileSequence'],
    ['litestream_replica_operation_total{operation="PUT",replica_type="s3"}', 'uploadedFiles'],
    ['litestream_replica_operation_total{replica_type="s3",operation="PUT"}', 'uploadedFiles'],
  ]);
  for (const line of text.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s*$/.exec(line);
    if (!match) continue;
    const name = names.get(match[1]);
    if (!name) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value < 0 || values.has(name)) return null;
    values.set(name, value);
  }
  const cpuSeconds = values.get('cpuSeconds');
  const localFileSequence = values.get('localFileSequence');
  const startTimeSeconds = values.get('startTimeSeconds');
  if (cpuSeconds === undefined || localFileSequence === undefined || startTimeSeconds === undefined) return null;
  return { cpuSeconds, startTimeSeconds, localFileSequence, uploadedFiles: values.get('uploadedFiles') ?? null };
}
