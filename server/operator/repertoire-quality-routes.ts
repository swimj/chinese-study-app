import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import type { RepertoireSnapshot } from '../db/repertoire-quality.ts';
import type { RepertoireModel, RepertoireQualityPage } from '../../src/domain/repertoire-quality.ts';

const FRESH_MS = 10 * 60_000;
const RETRY_MS = 60_000;
const BUILD_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 25;

function buildSnapshot(databasePath: string): Promise<RepertoireSnapshot> {
  return new Promise((resolve,reject) => {
    // Register the same TypeScript runtime in the worker before loading its entry.
    const worker = new Worker(new URL('./repertoire-quality-worker.cjs', import.meta.url), {
      execArgv: [],
      workerData: {databasePath, entry:fileURLToPath(new URL('./repertoire-quality-worker.ts',import.meta.url))},
    });
    const deadline = setTimeout(() => {
      reject(new Error('Repertoire quality refresh timed out'));
      void worker.terminate();
    }, BUILD_TIMEOUT_MS);
    worker.once('message', (snapshot:RepertoireSnapshot) => { clearTimeout(deadline); resolve(snapshot); });
    worker.once('error', error => { clearTimeout(deadline); reject(error); });
    worker.once('exit', () => { clearTimeout(deadline); reject(new Error('Repertoire quality worker stopped')); });
  });
}

/** Coalesce cold reads and retain a usable snapshot during background refresh or failure. */
export function createRepertoireSnapshotCache(load: () => Promise<RepertoireSnapshot>, now = Date.now) {
  let snapshot: RepertoireSnapshot | undefined;
  let inFlight: Promise<RepertoireSnapshot> | undefined;
  let nextRefresh = 0;
  return async () => {
    if (!inFlight && now() >= nextRefresh) {
      inFlight = load().then(result => {
        snapshot = result;
        nextRefresh = now() + FRESH_MS;
        return result;
      }).catch((error: unknown) => {
        nextRefresh = now() + RETRY_MS;
        console.error('Repertoire quality snapshot failed');
        throw error;
      }).finally(() => { inFlight = undefined; });
      void inFlight.catch(() => undefined);
    }
    if (snapshot) return snapshot;
    if (inFlight) return inFlight;
    throw new Error('Repertoire quality snapshot unavailable');
  };
}

export function mountRepertoireQualityRoutes(app: Express, databasePath: string, load = () => buildSnapshot(databasePath)) {
  const readSnapshot = createRepertoireSnapshotCache(load);
  const base = '/api/operator/repertoire-quality';
  const gate = createOperatorAllowlistMiddleware();

  app.get(base, gate, async (req,res) => {
    const {view,page,model} = req.query;
    if ((view !== 'cues' && view !== 'repairs') || typeof page !== 'string' || !/^[1-9]\d{0,7}$/.test(page)
      || (model !== undefined && (view !== 'cues' || (model !== 'sol' && model !== 'luna')))) {
      res.status(400).json({error:'Invalid repertoire quality filters'});
      return;
    }
    try {
      const snapshot = await readSnapshot();
      const cues = view === 'cues'
        ? model === undefined ? snapshot.cueRows : snapshot.cueRows.filter(row => row.model === model as RepertoireModel)
        : [];
      const repairs = view === 'repairs' ? snapshot.repairRows : [];
      const total = cues.length + repairs.length;
      const selectedPage = Math.min(Number(page), Math.max(1,Math.ceil(total / PAGE_SIZE)));
      const offset = (selectedPage - 1) * PAGE_SIZE;
      const response: RepertoireQualityPage = {
        capturedAt:snapshot.capturedAt, cohorts:snapshot.cohorts, repairTotals:snapshot.repairTotals,
        cueRows:cues.slice(offset,offset+PAGE_SIZE), repairRows:repairs.slice(offset,offset+PAGE_SIZE),
        total, page:selectedPage, pageSize:PAGE_SIZE,
      };
      res.set('Cache-Control','private, no-store').json(response);
    } catch {
      res.status(503).json({error:'Repertoire quality is temporarily unavailable'});
    }
  });

  app.get(base+'/detail', gate, async (req,res) => {
    const {view,id} = req.query;
    if ((view !== 'cues' && view !== 'repairs') || typeof id !== 'string' || !id.length || id.length > 500) {
      res.status(400).json({error:'Invalid repertoire quality detail'});
      return;
    }
    try {
      const snapshot = await readSnapshot();
      const detail = (view === 'cues' ? snapshot.cues : snapshot.repairs).get(id);
      if (!detail) { res.status(404).json({error:'Cue history is unavailable'}); return; }
      res.set('Cache-Control','private, no-store').json(detail);
    } catch {
      res.status(503).json({error:'Repertoire quality is temporarily unavailable'});
    }
  });
}
