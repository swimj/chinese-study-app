import fs from 'node:fs';
import path from 'node:path';
import { ProviderHttpError } from '../llm/types.ts';

const DIAGNOSTIC_TOKEN_PATTERN = /^[A-Za-z0-9_.-]{1,200}$/;
const PROCESSING_MS_PATTERN = /^\d+(?:\.\d+)?$/;

export type ReflectionProviderDiagnostic = {
  at: string;
  sessionId: string;
  clientRequestId: string;
  failureKind: 'http' | 'timeout' | 'transport';
  errorName: string;
  errorCode: string | null;
  cause: { name: string; code: string | null } | null;
  http: {
    status: number;
    requestId: string | null;
    processingMs: string | null;
  } | null;
};

export type ReflectionProviderDiagnosticSink = {
  record(diagnostic: ReflectionProviderDiagnostic): void;
};

/**
 * Writes allowlisted provider failure metadata to the active app data directory.
 * Messages, stacks, request bodies, and response bodies are deliberately absent.
 */
export function createFileReflectionProviderDiagnosticSink(
  dataDir: string,
): ReflectionProviderDiagnosticSink {
  const diagnosticsPath = path.join(dataDir, 'reflection-provider-diagnostics.jsonl');
  return {
    record(diagnostic) {
      try {
        fs.appendFileSync(diagnosticsPath, `${JSON.stringify(diagnostic)}\n`, 'utf8');
      } catch {
        // Diagnostics must not change the provider failure that the learner sees.
      }
    },
  };
}

export function describeReflectionProviderFailure(input: {
  sessionId: string;
  clientRequestId: string;
  error: unknown;
  at?: string;
}): ReflectionProviderDiagnostic {
  const error = input.error;
  const base = {
    at: input.at ?? new Date().toISOString(),
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    errorName: describeErrorName(error),
    errorCode: describeErrorCode(error),
    cause: describeCause(error),
  };

  if (error instanceof ProviderHttpError) {
    return {
      ...base,
      failureKind: 'http',
      http: {
        status: error.status,
        requestId: safeDiagnosticToken(error.requestId),
        processingMs: safeProcessingMs(error.processingMs),
      },
    };
  }

  return {
    ...base,
    failureKind: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'transport',
    http: null,
  };
}

function describeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  return safeDiagnosticToken(error.name) ?? 'Error';
}

function describeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return safeDiagnosticToken((error as Error & { code?: unknown }).code);
}

function describeCause(error: unknown): ReflectionProviderDiagnostic['cause'] {
  if (!(error instanceof Error) || !(error.cause instanceof Error)) return null;
  const cause = error.cause as Error & { code?: unknown };
  return {
    name: safeDiagnosticToken(cause.name) ?? 'Error',
    code: safeDiagnosticToken(cause.code),
  };
}

function safeDiagnosticToken(value: unknown): string | null {
  return typeof value === 'string' && DIAGNOSTIC_TOKEN_PATTERN.test(value) ? value : null;
}

function safeProcessingMs(value: unknown): string | null {
  return typeof value === 'string' && PROCESSING_MS_PATTERN.test(value) ? value : null;
}
