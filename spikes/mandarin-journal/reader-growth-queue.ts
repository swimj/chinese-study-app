import { activityOutcome, type ActivityStore } from './activity.ts';
import type { readerLedger } from './reader-ledger.ts';
import type { openReaderCatalog } from './reader-catalog.ts';
import { processReaderDecision } from './reader-growth.ts';

// The immutable lookup ledger is the work list. The catalog receipt is the checkpoint.
export function startReaderGrowth(ledger: ReturnType<typeof readerLedger>, catalog: ReturnType<typeof openReaderCatalog>, activity?: ActivityStore) {
  const pending = new Set<string>();
  const retryDelays = [60_000, 300_000, 1_800_000];
  const attempts = new Map<string, number>();
  let running = false;

  function enqueue(id: string) {
    pending.add(id);
    if (!running) {
      running = true;
      setImmediate(() => void drain());
    }
  }
  async function drain() {
    try {
      for (const id of pending) {
        pending.delete(id);
        try {
          const row = ledger.get(id);
          if (!row) throw new Error('Missing reader decision');
          if (catalog.needsDecision(row)) {
            const process = async () => {
              const receipt = await processReaderDecision(catalog, row, { isFlagged: () => Boolean(ledger.get(id)?.feedback) });
              activityOutcome(receipt?.outcome ?? 'Deferred');
            };
            if (activity) await activity.background(row.feedback ? 'Dictionary feedback' : 'Dictionary growth', id, process);
            else await process();
          }
          attempts.delete(id);
        } catch (error) {
          // Keep this decision pending on disk while allowing later decisions through.
          console.error('Reader catalog could not process decision', id, error instanceof Error ? error.name : 'Error');
          const attempt = attempts.get(id) ?? 0;
          const delay = retryDelays[attempt];
          if (delay !== undefined) {
            attempts.set(id, attempt + 1);
            setTimeout(() => { if (attempts.get(id) === attempt + 1) enqueue(id); }, delay).unref();
          }
        }
      }
    } finally {
      running = false;
    }
  }
  // Previously completed and offline decisions are cheap to skip. Restore FIFO order
  // so a second occurrence can use what the first one taught the catalog.
  for (const row of [...ledger.rows()].sort((a, b) => a.completedAt.localeCompare(b.completedAt))) enqueue(row.id);
  return enqueue;
}
