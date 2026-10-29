import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LunaReflectionProviderError, type LunaReflectionRunMetadata } from './luna-provider.ts';

export const REFLECTION_FAILURE_ARTIFACT_DIRECTORY = 'reflection-failures';
export const REFLECTION_FAILURE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const ARTIFACT_FILENAME = /^failure-(\d{13})-[0-9a-f-]{36}\.json$/;

export type ReflectionFailureArtifactInput = {
  runId: string;
  clientRequestId: string;
  sourceSessionId: string | null;
  reflectionFlowVersion: string;
  startedAt: string;
  completedAt: string;
  metadata: LunaReflectionRunMetadata;
  failureCode: string | null;
  evidenceBundle: unknown;
  error: unknown;
};

export type ReflectionFailureArtifactSink = {
  record(input: ReflectionFailureArtifactInput): void;
};

/** Private operator files; never served by HTTP or copied to ordinary logs. */
export function createFileReflectionFailureArtifactSink(
  dataDir: string,
  now: () => number = Date.now,
): ReflectionFailureArtifactSink {
  const directory = path.join(dataDir, REFLECTION_FAILURE_ARTIFACT_DIRECTORY);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const cutoff = now() - REFLECTION_FAILURE_RETENTION_MS;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const match = ARTIFACT_FILENAME.exec(entry.name);
      if (!entry.isFile() || match === null || Number(match[1]) > cutoff) continue;
      try {
        fs.unlinkSync(path.join(directory, entry.name));
      } catch {
        warn('cleanup');
      }
    }
  } catch {
    warn('cleanup');
  }
  return {
    record(input) {
      try {
        const diagnostic = input.error instanceof LunaReflectionProviderError ? input.error.diagnostic : null;
        const capturedAt = now();
        const { error, ...context } = input;
        const artifact = {
          schemaVersion: 'reflection_failure_artifact.v1',
          capturedAt: new Date(capturedAt).toISOString(),
          ...context,
          diagnostic,
          rejectedOutput: diagnostic?.fullRejectedOutput ?? diagnostic?.rejectedOutput ?? null,
          // Transport errors can contain auth headers or upstream response bodies.
          // Keep their existing allowlisted classification, not arbitrary causes.
          error: describeError(error, diagnostic?.phase === 'provider_transport'),
        };
        fs.writeFileSync(path.join(directory, `failure-${capturedAt}-${randomUUID()}.json`),
          `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      } catch {
        warn('write', input.runId);
      }
    },
  };
}

function describeError(error: unknown, transport: boolean, depth = 0): unknown {
  if (!(error instanceof Error)) return { name: typeof error, message: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: transport ? null : error.stack ?? null,
    cause: transport || depth >= 5 || error.cause === undefined
      ? null : describeError(error.cause, false, depth + 1),
  };
}

function warn(operation: 'cleanup' | 'write', runId?: string): void {
  console.error(JSON.stringify({ event: `reflection.failure_artifact_${operation}_failed`, ...(runId ? { runId } : {}) }));
}
