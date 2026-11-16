import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { readLitestreamMetrics, parseLitestreamMetrics } from '../server/litestream-metrics.ts';

const samples = `# HELP process_cpu_seconds_total CPU seconds.
process_cpu_seconds_total 42.5
process_start_time_seconds 1700000000
litestream_txid{db="/data/app.db"} 123
litestream_replica_operation_total{operation="PUT",replica_type="s3"} 80
litestream_replica_operation_total{operation="GET",replica_type="s3"} 200
litestream_txid{db="/private/other.db"} 999
private_metric{secret="must-not-escape"} 500
`;
const expected = { cpuSeconds: 42.5, startTimeSeconds: 1700000000, localFileSequence: 123, uploadedFiles: 80 };

test('extracts only the configured DB and fixed S3 PUT series, stripping all labels', () => {
  assert.deepEqual(parseLitestreamMetrics(samples, '/data/app.db'), expected);
  assert.deepEqual(parseLitestreamMetrics(samples.replace('operation="PUT",replica_type="s3"', 'replica_type="s3",operation="PUT"'), '/data/app.db'), expected);
  assert.deepEqual(parseLitestreamMetrics(samples.replace(/.*operation="PUT".*\n/, ''), '/data/app.db'), { ...expected, uploadedFiles: null });
  assert.equal(parseLitestreamMetrics(samples, '/data/missing.db'), null);
  assert.equal(parseLitestreamMetrics(samples.replace('process_cpu_seconds_total 42.5', 'process_cpu_seconds_total{secret="private"} 42.5'), '/data/app.db'), null);
});

test('rejects missing, nonfinite, negative and duplicate required samples', () => {
  for (const replacement of ['NaN', '+Inf', '-1', 'invalid']) {
    assert.equal(parseLitestreamMetrics(samples.replace('42.5', replacement), '/data/app.db'), null);
  }
  assert.equal(parseLitestreamMetrics(samples + 'process_cpu_seconds_total 43\n', '/data/app.db'), null);
  assert.equal(parseLitestreamMetrics('not metrics', '/data/app.db'), null);
});

test('reads actual HTTP exposition and bounds failures without returning raw content', async (t) => {
  for (const mode of ['ok', 'error', 'large', 'timeout', 'truncated'] as const) {
    await t.test(mode, async () => {
      const server = createServer((_request, response) => {
        if (mode === 'timeout') return;
        if (mode === 'error') { response.writeHead(503); response.end('private detail'); return; }
        if (mode === 'large') { response.end('x'.repeat(300_000)); return; }
        if (mode === 'truncated') { response.write(samples); response.destroy(); return; }
        response.end(samples);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert(address && typeof address !== 'string');
      try {
        const result = await readLitestreamMetrics({ databasePath: '/data/app.db', port: address.port, timeoutMs: 100 });
        assert.deepEqual(result, mode === 'ok' ? expected : null);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
  }
});
