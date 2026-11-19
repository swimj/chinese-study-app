import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A fixed port so an operator can forward it with `ssh -L 8765:127.0.0.1:8765 <host>`. */
export const RELEASE_TRACKER_PORT = 8765;
/** Release history lives on the operator machine, outside any checkout. */
export const DEFAULT_RELEASE_ROOT = path.join(os.homedir(), '.chinese-study-app', 'releases');

export type TrackerStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'waiting';
export type TrackerStage = { status: TrackerStatus; detail?: string; startedAt?: string; endedAt?: string };
export type ReleaseOutcome = 'in-progress' | 'released' | 'failed' | 'abandoned';
export type TrackerState = {
  version: 1;
  id: string;
  mode: 'code' | 'migrate';
  commit: string | null;
  createdAt: string;
  outcome: ReleaseOutcome;
  title: string;
  phase: string;
  plan: Array<{ group: string; stages: Array<{ id: string; label: string }> }>;
  stages: Record<string, TrackerStage>;
  facts: Record<string, string>;
  notes: Array<{ at: string; text: string }>;
  updatedAt: string;
};

const CODE_STAGES: Array<[string, string]> = [
  ['declare', 'declare: checkout, origin/main, config env, ledger'],
  ['build', 'build: image built before the window (skipped with --image)'],
  ['backup', 'backup: recent scheduled backup, or a fresh online one'],
  ['quiesce', 'quiesce: provider work off, maintenance on, drain'],
  ['deploy', 'deploy: digest-qualified image'],
  ['confirm', 'confirm: identity, closed controls, ledger unchanged'],
  ['smoke', 'smoke: frontend + authenticated read'],
  ['reopen', 'reopen: writes, then provider work'],
];
const MIGRATE_STAGES: Array<[string, string]> = [
  ['declare', 'declare: checkout, origin/main, config env, ledger, rehearsal gate'],
  ['quiesce', 'quiesce: provider work off, maintenance on, drain'],
  ['backup', 'backup: pre-release backup after writes stop'],
  ['idle', 'idle: Machine on target image, app stopped'],
  ['migrate', 'migrate: wrapper over SSH'],
  ['start', 'start: deploy target image'],
  ['confirm', 'confirm: identity, closed controls, ledger'],
  ['smoke', 'smoke: frontend + authenticated read'],
  ['reopen', 'reopen: writes, then provider work'],
  ['post-backup', 'post-backup: online capture of the migrated database'],
];

/** Production stage ids are prefixed so they can sit beside the agent's own preparation stages. */
export function productionStageId(stage: string): string {
  return `p-${stage}`;
}

export function initialState(input: { id: string; mode: 'code' | 'migrate'; title: string; commit?: string }, now: string): TrackerState {
  const { id, mode, title } = input;
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Error('Release id must be lowercase letters, digits, and hyphens.');
  const preparation = [
    { id: 'sync', label: 'Resync checkout to the release commit' },
    { id: 'ledger', label: 'Read production migration ledger' },
  ];
  const plan: TrackerState['plan'] = [{ group: 'Preparation', stages: preparation }];
  if (mode === 'migrate') {
    plan.push({ group: 'Build', stages: [{ id: 'build', label: 'hosted:build → digest-qualified image' }] });
    plan.push({ group: 'Rehearsal (restored copy; production keeps serving)', stages: [
      { id: 'r-prepare', label: 'prepare: Machine, volume, restore, integrity' },
      { id: 'r-before', label: 'checks before migrating' },
      { id: 'r-migrate', label: 'migrate: author checks + pending migrations' },
      { id: 'r-after', label: 'checks after migrating' },
    ] });
  }
  const production = (mode === 'migrate' ? MIGRATE_STAGES : CODE_STAGES).map(([id, label]) => ({ id: productionStageId(id), label }));
  plan.push({ group: `Production: hosted:upgrade --mode=${mode}`, stages: production });
  plan.push({ group: 'Wrap-up', stages: [
    { id: 'verify', label: 'Post-release health and observations' },
    ...(mode === 'migrate' ? [{ id: 'cleanup', label: 'Destroy rehearsal Machine and volume' }] : []),
  ] });
  const stages: Record<string, TrackerStage> = {};
  for (const group of plan) for (const stage of group.stages) stages[stage.id] = { status: 'pending' };
  return { version: 1, id, mode, commit: input.commit ?? null, createdAt: now, outcome: 'in-progress',
    title, phase: 'Preparing', plan, stages, facts: {}, notes: [], updatedAt: now };
}

export function setStage(state: TrackerState, id: string, status: TrackerStatus, now: string, detail?: string): void {
  if (!state.stages[id]) throw new Error(`Unknown tracker stage: ${id}`);
  const stage = state.stages[id];
  if (status === 'running' && !stage.startedAt) stage.startedAt = now;
  if (status === 'ok' || status === 'failed' || status === 'skipped') {
    stage.startedAt ??= now;
    stage.endedAt = now;
  }
  stage.status = status;
  if (detail !== undefined) stage.detail = detail;
  state.updatedAt = now;
}

/**
 * Mirrors one hosted:upgrade output line into the tracker. Returns true once the
 * final result arrives. Details stay short: stage names, ids, and failures only.
 */
export function applyUpgradeEvent(state: TrackerState, line: string, now: string): boolean {
  let event: unknown;
  try { event = JSON.parse(line); } catch { return false; }
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;
  if (e.type === 'stage' && typeof e.stage === 'string' && (e.status === 'ok' || e.status === 'failed')) {
    const id = productionStageId(e.stage);
    if (!state.stages[id]) return false;
    const detail = e.detail && typeof e.detail === 'object' ? e.detail as Record<string, unknown> : {};
    setStage(state, id, e.status, now, e.status === 'failed' && typeof detail.failure === 'string' ? detail.failure.slice(0, 300) : undefined);
    if (e.status === 'ok') {
      const ids = state.plan.flatMap((group) => group.stages.map((stage) => stage.id)).filter((stageId) => stageId.startsWith('p-'));
      const next = ids[ids.indexOf(id) + 1];
      if (next) {
        setStage(state, next, 'running', now);
        state.phase = `Production: ${next.slice(2)}`;
      }
    }
    return false;
  }
  if (e.type === 'upgrade-result' || e.type === 'migration-release-result') {
    const ok = e.status === 'ok';
    state.phase = ok
      ? `Production release complete${e.reopened === false ? ' (service left closed)' : ''}`
      : `Production release failed at ${String(e.failedStage)}; reopened=${String(e.reopened)}${e.databaseState ? `; databaseState=${String(e.databaseState)}` : ''}`;
    for (const stage of Object.values(state.stages)) if (stage.status === 'running' && !ok) stage.status = 'waiting';
    // A failed final step after reopening still leaves the release serving; the agent records the outcome.
    if (!ok && e.reopened !== true) state.outcome = 'failed';
    if (ok) state.outcome = 'released';
    state.updatedAt = now;
    return true;
  }
  return false;
}

function releaseFile(root: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Error('Invalid release id.');
  return path.join(root, `${id}.json`);
}

export function readRelease(root: string, id: string): TrackerState {
  return JSON.parse(fs.readFileSync(releaseFile(root, id), 'utf8')) as TrackerState;
}

export function writeRelease(root: string, state: TrackerState): void {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = releaseFile(root, state.id);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
}

export type ReleaseSummary = Pick<TrackerState, 'id' | 'mode' | 'commit' | 'createdAt' | 'updatedAt' | 'outcome' | 'title' | 'phase'>;

/** Newest first. Unreadable files are skipped rather than hiding the rest of the history. */
export function listReleases(root: string): ReleaseSummary[] {
  if (!fs.existsSync(root)) return [];
  const releases: ReleaseSummary[] = [];
  for (const file of fs.readdirSync(root)) {
    if (!file.endsWith('.json')) continue;
    try {
      const { id, mode, commit, createdAt, updatedAt, outcome, title, phase } = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as TrackerState;
      releases.push({ id, mode, commit, createdAt, updatedAt, outcome, title, phase });
    } catch { /* partial or foreign file */ }
  }
  return releases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function latestReleaseId(root: string): string {
  const latest = listReleases(root)[0];
  if (!latest) throw new Error(`No releases recorded under ${root}.`);
  return latest.id;
}
