import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export type ObservationQuery = { name: string; sql: string; params?: (string | number | null)[] };
export type ObservationRequest = {
  databasePath: string; queries: ObservationQuery[]; maxRows: number;
  maxResultBytes: number; queryTimeoutMs: number;
};
export type CommandRunner = (args: string[]) => string;

export function validateRequest(value: unknown): ObservationRequest {
  if (!value || typeof value !== 'object') throw new Error('Expected a query request object.');
  const request = value as Record<string, unknown>;
  const keys = ['databasePath', 'queries', 'maxRows', 'maxResultBytes', 'queryTimeoutMs'];
  if (Object.keys(request).some((key) => !keys.includes(key))) throw new Error('Unknown request field.');
  const integer = (key: string, fallback: number, max: number) => {
    const n = request[key] ?? fallback;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${key}.`);
    return n;
  };
  const databasePath = request.databasePath ?? '/data/app.db';
  if (typeof databasePath !== 'string' || !databasePath.startsWith('/') || databasePath.includes('\0')) throw new Error('databasePath must be absolute.');
  const queries = request.queries ?? [];
  if (!Array.isArray(queries) || queries.length > 20) throw new Error('Expected at most 20 queries.');
  const names = new Set<string>();
  for (const q of queries) {
    if (!q || typeof q !== 'object' || Object.keys(q).some((key) => !['name', 'sql', 'params'].includes(key)) ||
        typeof q.name !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(q.name) || names.has(q.name) ||
        typeof q.sql !== 'string' || q.sql.length === 0 || q.sql.length > 16_000 ||
        (q.params !== undefined && (!Array.isArray(q.params) || q.params.some((p: unknown) =>
          p !== null && typeof p !== 'string' && !(typeof p === 'number' && Number.isFinite(p)))))) throw new Error('Invalid query or duplicate query name.');
    names.add(q.name);
  }
  const result = { databasePath, queries, maxRows: integer('maxRows', 500, 5000),
    maxResultBytes: integer('maxResultBytes', 1_000_000, 4_000_000), queryTimeoutMs: integer('queryTimeoutMs', 5000, 15000) };
  if (Buffer.byteLength(JSON.stringify(result)) > 64_000) throw new Error('Request exceeds 64 KB.');
  return result;
}

export function buildObservationCommand(request: ObservationRequest): string {
  const source = fs.readFileSync(new URL('./hosted-observation-payload.cjs', import.meta.url), 'utf8');
  const payload = Buffer.from(source).toString('base64');
  const input = Buffer.from(JSON.stringify(request)).toString('base64');
  // Only base64 is interpolated; SQL never participates in shell parsing.
  return `node -e 'eval(Buffer.from("${payload}","base64").toString("utf8"))' '${input}' '${payload}'`;
}

export function flyRunner(args: string[]): string {
  const result = spawnSync('fly', args, { encoding: 'utf8', timeout: 45_000, maxBuffer: 5_000_000, env: process.env });
  if (result.error || result.status !== 0) {
    // Do not echo remote output, arguments (SQL), or environment secrets on failure.
    throw new Error(`Fly ${args[0]} failed (${result.error?.message ?? `exit ${result.status}`}); no successful observation recorded.`);
  }
  return result.stdout;
}

export function observeHosted(app: string, machine: string, request: ObservationRequest, run: CommandRunner = flyRunner) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(app) || !/^[a-f0-9]{6,32}$/.test(machine)) throw new Error('Explicit valid app and Machine IDs are required.');
  const startedAt = new Date().toISOString();
  const releases = JSON.parse(run(['releases', '--app', app, '--json']));
  const releasesReadAt = new Date().toISOString();
  const command = buildObservationCommand(request);
  const observerPayloadSha256 = createHash('sha256').update(fs.readFileSync(new URL('./hosted-observation-payload.cjs', import.meta.url))).digest('hex');
  const observation = JSON.parse(run(['ssh', 'console', '--app', app, '--machine', machine, '--user', 'node', '--quiet', '--command', command]));
  if (observation.status !== 'ok' || observation.runtime?.flyMachineId !== machine || observation.runtime?.flyAppName !== app ||
      !/^[a-f0-9]{40}$/.test(observation.runtime?.sourceRevision ?? '')) throw new Error('Observation lacks the expected Machine/app/runtime identity.');
  return { formatVersion: 1, startedAt, finishedAt: new Date().toISOString(), app, machine,
    observerPayloadSha256, request, releasesReadAt, releases, observation };
}
