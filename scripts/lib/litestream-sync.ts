import { isRecord } from './hosted-json.ts';

/** A completed local sync and replica acknowledgement, not a monitor heartbeat. */
export function readLitestreamSyncReceipt(result: unknown, databasePath: string) {
  if (!isRecord(result) || result.db_path !== databasePath
    || typeof result.txid !== 'number' || !Number.isSafeInteger(result.txid) || result.txid <= 0
    || typeof result.replica_txid !== 'number' || !Number.isSafeInteger(result.replica_txid)
    || result.replica_txid < result.txid) {
    throw new Error('Litestream did not confirm replication through the requested database position.');
  }
  return { databasePath: result.db_path, txid: result.txid, replicaTxid: result.replica_txid };
}
