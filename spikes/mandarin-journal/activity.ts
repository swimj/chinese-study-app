import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { meterUsage } from './activity-pricing.ts';

type Kind = 'action' | 'job' | 'run' | 'model' | 'tool';
type Step = Exclude<Kind, 'action'>;
type Phase = 'foreground' | 'background';
type Meta = { dependsOn?: string[]; provider?: string; model?: string; reference?: string };
export interface ActivitySpan {
  readonly id?: string;
  usage(raw: unknown, actualModel?: string, tier?: string): void;
  outcome(label: string): void;
  finish(status?: 'ok' | 'error'): void;
}
export function recordProviderUsage(span: Pick<ActivitySpan, 'usage'>, raw: unknown) {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as Record<string, unknown>;
  span.usage(value.usage, typeof value.model === 'string' ? value.model : undefined,
    typeof value.service_tier === 'string' ? value.service_tier : undefined);
}
export interface ActivityRow {
  id: string; actionId: string; parentId: string | null; dependsOn: string[]; kind: Kind; label: string;
  reference: string | null; phase: Phase; startedAt: string; finishedAt: string | null; outcome: string | null;
  provider: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null;
  cachedTokens: number | null; writeTokens: number | null; reasoningTokens: number | null; costUsd: number | null;
  costSource: 'reported' | 'estimated' | 'unknown'; pricingBasis: string | null;
  callCount: number; knownUsd: number; unpriced: number; actionLabel: string;
}
type Context = { db: DatabaseSync; id: string; actionId: string; phase: Phase; span: ActivitySpan };
const active = new AsyncLocalStorage<Context>();
const noop: ActivitySpan = { usage() {}, outcome() {}, finish() {} };
export const activityEnabled = () => !!active.getStore();
export const activityOutcome = (label: string) => active.getStore()?.span.outcome(label);

// An observability write can fail after the journal has already committed or paid for work.
// Keep that failure out of provider retries and learner action results.
let warned = false;
function observe<T>(operation: () => T): T | undefined {
  try { return operation(); } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !String(error.code).startsWith('ERR_SQLITE')) throw error;
    if (!warned) {
      warned = true;
      console.warn('Model activity could not be recorded. Check journal database write access.');
    }
  }
}

function begin(db: DatabaseSync, kind: Kind, label: string, phase: Phase, meta: Meta,
  parent?: Pick<Context, 'id' | 'actionId'>): Context | undefined {
  const id = randomUUID();
  const actionId = parent?.actionId ?? id;
  const inserted = observe(() => db.prepare(`INSERT INTO activity_spans (id,actionId,parentId,kind,label,phase,reference,provider,model,startedAt,ownerPid,dependencies)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, actionId, parent?.id ?? null, kind, label, phase, meta.reference ?? null,
      meta.provider ?? null, meta.model ?? null, new Date().toISOString(), process.pid, JSON.stringify(meta.dependsOn ?? [])));
  if (!inserted) return;
  const span: ActivitySpan = {
    id,
    usage(raw, actualModel, tier) {
      const model = actualModel || meta.model || '';
      const u = meterUsage(meta.provider ?? '', model, raw, tier);
      observe(() => db.prepare(`UPDATE activity_spans SET model=?,inputTokens=?,outputTokens=?,cachedTokens=?,writeTokens=?,
        reasoningTokens=?,costUsd=?,costSource=?,pricingBasis=? WHERE id=?`)
        .run(model, u.input, u.output, u.cached, u.write, u.reasoning, u.cost, u.source, u.basis, id));
    },
    outcome(value) { observe(() => db.prepare('UPDATE activity_spans SET outcome=? WHERE id=?').run(value, id)); },
    finish(status = 'ok') {
      observe(() => db.prepare(`UPDATE activity_spans SET finishedAt=?, outcome=coalesce(outcome,?), ownerPid=NULL
        WHERE id=? AND finishedAt IS NULL`).run(new Date().toISOString(), status, id));
    },
  };
  return { db, id, actionId, phase, span };
}
async function execute<T>(ctx: Context | undefined, work: (span: ActivitySpan) => Promise<T>) {
  if (!ctx) return active.exit(work, noop);
  try {
    const result = await active.run(ctx, work, ctx.span);
    ctx.span.finish();
    return result;
  } catch (error) {
    ctx.span.finish('error');
    throw error;
  }
}
export function startActivityStep(kind: Step, label: string, meta: Meta = {}): ActivitySpan {
  const parent = active.getStore();
  return parent ? begin(parent.db, kind, label, parent.phase, meta, parent)?.span ?? noop : noop;
}
export async function activityStep<T>(kind: Step, label: string, work: (span: ActivitySpan) => Promise<T>, meta: Meta = {}) {
  const parent = active.getStore();
  return parent ? execute(begin(parent.db, kind, label, parent.phase, meta, parent), work) : work(noop);
}

const projections = `s.id,s.actionId,s.parentId,s.kind,s.label,s.reference,s.phase,s.startedAt,s.finishedAt,s.outcome,
  s.provider,s.model,s.inputTokens,s.outputTokens,s.cachedTokens,s.writeTokens,s.reasoningTokens,s.costUsd,s.costSource,s.pricingBasis,
  s.dependencies,root.label AS actionLabel`;
const limit = 250;
export function createActivity(db: DatabaseSync) {
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS activity_spans (
      id TEXT PRIMARY KEY,actionId TEXT NOT NULL,parentId TEXT,kind TEXT NOT NULL,label TEXT NOT NULL,phase TEXT NOT NULL,
      dependencies TEXT NOT NULL,reference TEXT,startedAt TEXT NOT NULL,finishedAt TEXT,outcome TEXT,ownerPid INTEGER,provider TEXT,model TEXT,
      inputTokens INTEGER,outputTokens INTEGER,cachedTokens INTEGER,writeTokens INTEGER,reasoningTokens INTEGER,
      costUsd REAL,costSource TEXT NOT NULL DEFAULT 'unknown',pricingBasis TEXT);
    CREATE INDEX IF NOT EXISTS activity_by_action ON activity_spans(actionId,kind,startedAt);
    CREATE INDEX IF NOT EXISTS activity_by_kind_time ON activity_spans(kind,startedAt);
    CREATE TABLE IF NOT EXISTS activity_links (kind TEXT,reference TEXT,spanId TEXT NOT NULL,PRIMARY KEY(kind,reference));
  `);
  // Another local server may share this journal. Only mark work owned by a dead process.
  for (const row of db.prepare('SELECT DISTINCT ownerPid FROM activity_spans WHERE ownerPid IS NOT NULL').all()) {
    try { process.kill(Number(row.ownerPid), 0); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
        db.prepare("UPDATE activity_spans SET outcome='interrupted',ownerPid=NULL WHERE ownerPid=?").run(row.ownerPid);
      }
    }
  }
  function link(kind: string, reference: string) {
    const ctx = active.getStore();
    if (!ctx) return;
    if (ctx.db !== db) throw new Error('Activity link belongs to another journal');
    observe(() => db.prepare('INSERT OR IGNORE INTO activity_links VALUES (?,?,?)').run(kind, reference, ctx.id));
  }
  function rows(where: string, value: string, order: string, totals: boolean) {
    // Per-action totals cover all its calls, including work outside the selected start-time window.
    const rollup = totals ? `(SELECT count(*) FROM activity_spans c WHERE c.actionId=s.id AND c.kind='model') AS callCount,
      (SELECT coalesce(sum(costUsd),0) FROM activity_spans c WHERE c.actionId=s.id AND c.kind='model') AS knownUsd,
      (SELECT count(*) FROM activity_spans c WHERE c.actionId=s.id AND c.kind='model' AND c.costUsd IS NULL) AS unpriced`
      : "iif(s.kind='model',1,0) AS callCount,coalesce(s.costUsd,0) AS knownUsd,iif(s.kind='model' AND s.costUsd IS NULL,1,0) AS unpriced";
    const result = db.prepare(`SELECT ${projections},${rollup} FROM activity_spans s
      JOIN activity_spans root ON root.id=s.actionId WHERE ${where} ORDER BY ${order}`).all(value) as unknown as (Omit<ActivityRow, 'dependsOn'> & { dependencies: string })[];
    return result.map(({ dependencies, ...row }) => ({ ...row, dependsOn: JSON.parse(dependencies) as string[] }));
  }
  return {
    db, link,
    action<T>(label: string, reference: string, work: () => Promise<T>) {
      return execute(begin(db, 'action', label, 'foreground', { reference }), work);
    },
    background<T>(kind: string, reference: string, work: () => Promise<T>): Promise<T> {
      const origin = db.prepare(`SELECT s.id,s.actionId FROM activity_links l JOIN activity_spans s ON s.id=l.spanId
        WHERE l.kind=? AND l.reference=?`).get(kind, reference);
      if (origin) return execute(begin(db, 'job', kind, 'background', { reference },
        { id: String(origin.id), actionId: String(origin.actionId) }), work);
      // Older persisted jobs have no producer. Give retries a common, explicitly background root.
      return execute(begin(db, 'action', 'Previously queued · ' + kind, 'background', { reference }), async () => {
        link(kind, reference);
        return activityStep('job', kind, work, { reference });
      });
    },
    report(hours: number) {
      const since = new Date(Date.now() - hours * 3_600_000).toISOString();
      const actionRows = rows("s.kind='action' AND s.startedAt>=?", since, 's.startedAt DESC,s.rowid DESC LIMIT ' + (limit + 1), true);
      const callRows = rows("s.kind='model' AND s.startedAt>=?", since, 's.startedAt DESC,s.rowid DESC LIMIT ' + (limit + 1), false);
      const summary = db.prepare(`SELECT
        (SELECT count(*) FROM activity_spans WHERE kind='action' AND startedAt>=?) AS actions,
        count(*) AS calls,count(*) FILTER (WHERE phase='background') AS backgroundCalls,
        coalesce(sum(costUsd),0) AS knownUsd,count(*) FILTER (WHERE costUsd IS NULL) AS unpriced
        FROM activity_spans WHERE kind='model' AND startedAt>=?`).get(since,since)!;
      const behaviors = db.prepare(`SELECT a.label,count(DISTINCT a.id) AS actions,count(c.id) AS calls,
        coalesce(sum(c.costUsd),0) AS knownUsd,count(c.id) FILTER (WHERE c.costUsd IS NULL) AS unpriced
        FROM activity_spans a LEFT JOIN activity_spans c ON c.actionId=a.id AND c.kind='model'
        WHERE a.kind='action' AND a.startedAt>=? GROUP BY a.label ORDER BY knownUsd DESC,calls DESC,a.label`).all(since);
      return { since, summary, behaviors, actions: actionRows.slice(0,limit), calls: callRows.slice(0,limit),
        truncatedActions: actionRows.length > limit, truncatedCalls: callRows.length > limit };
    },
    trace(id: string) {
      const [action] = rows("s.kind='action' AND s.id=?", id, 's.rowid', true);
      return action ? { action, spans: rows("s.kind<>'action' AND s.actionId=?", id, 's.startedAt,s.rowid', false) } : null;
    },
  };
}
export type ActivityStore = ReturnType<typeof createActivity>;
