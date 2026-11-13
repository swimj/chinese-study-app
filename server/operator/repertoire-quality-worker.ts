import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { buildRepertoireSnapshot } from '../db/repertoire-quality.ts';

if (!parentPort || typeof workerData?.databasePath !== 'string') throw new Error('Expected repertoire snapshot worker');
const db = new DatabaseSync(workerData.databasePath, {readOnly:true});
try {
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
  const snapshot = buildRepertoireSnapshot(db);
  db.exec('COMMIT');
  parentPort.postMessage(snapshot);
} finally {
  db.close();
}
