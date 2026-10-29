// Sent by the observer checkout to Node on the selected Fly Machine. No app import.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

if (isMainThread) {
  const request = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
  const worker = new Worker(Buffer.from(process.argv[2], 'base64').toString('utf8'), {
    eval: true, workerData: request, resourceLimits: { maxOldGenerationSizeMb: 64 },
  });
  const timer = setTimeout(() => {
    // Worker termination alone cannot interrupt a synchronous native SQLite call.
    // Exit this disposable observer process; never leave the remote query running.
    console.error('Observation query deadline exceeded.');
    process.kill(process.pid, 'SIGKILL');
  }, request.queryTimeoutMs);
  worker.once('message', (result) => {
    clearTimeout(timer);
    console.log(JSON.stringify(result));
  });
  worker.once('error', (error) => {
    clearTimeout(timer);
    console.error(error.message);
    process.exitCode = 1;
  });
  worker.once('exit', (code) => {
    clearTimeout(timer);
    if (code !== 0) process.exitCode = 1;
  });
} else {
  const { DatabaseSync } = require('node:sqlite');
  const startedAt = new Date().toISOString();
  const request = workerData;
  const db = new DatabaseSync(request.databasePath, { readOnly: true });
  const json = (value) => JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item instanceof Uint8Array
      ? { encoding: 'base64', data: Buffer.from(item).toString('base64') } : item);
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000; BEGIN;');
    const migrations = db.prepare("SELECT migration_id, applied_at FROM schema_migrations WHERE migration_id LIKE 'app_schema:%' ORDER BY migration_id").all();
    const results = [];
    let bytes = Buffer.byteLength(json(migrations));
    if (bytes > request.maxResultBytes) throw new Error('Migration ledger exceeded maxResultBytes.');
    for (const query of request.queries) {
      // Deliberately an operator convenience, not a security boundary against a
      // malicious credential holder. No application functions/extensions loaded.
      if (!/^\s*(SELECT\b|WITH\b|EXPLAIN\s+QUERY\s+PLAN\s+SELECT\b)/i.test(query.sql)) {
        throw new Error(`Query ${query.name} must be SELECT, WITH, or EXPLAIN QUERY PLAN SELECT.`);
      }
      const statement = db.prepare(query.sql);
      statement.setReadBigInts(true);
      const rows = [];
      for (const row of statement.iterate(...(query.params ?? []))) {
        if (rows.length >= request.maxRows) throw new Error(`Query ${query.name} exceeded maxRows; narrow the query.`);
        bytes += Buffer.byteLength(json(row));
        if (bytes > request.maxResultBytes) throw new Error('Observation exceeded maxResultBytes; narrow the query.');
        rows.push(row);
      }
      results.push({ name: query.name, rows });
    }
    db.exec('ROLLBACK');
    parentPort.postMessage(JSON.parse(json({
      status: 'ok', startedAt, finishedAt: new Date().toISOString(),
      runtime: {
        sourceRevision: process.env.APP_REVISION ?? 'unknown',
        flyMachineId: process.env.FLY_MACHINE_ID ?? null,
        flyAppName: process.env.FLY_APP_NAME ?? null,
        flyImageRef: process.env.FLY_IMAGE_REF ?? null,
        flyRegion: process.env.FLY_REGION ?? null,
        nodeVersion: process.version,
      }, migrations, results,
    })));
  } finally { db.close(); }
}
