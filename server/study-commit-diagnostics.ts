
import fs from 'node:fs';
import path from 'node:path';

export const STUDY_COMMIT_DIAGNOSTICS_FILENAME = 'study-commit-diagnostics.jsonl';

export type StudyCommitRoute =
  | '/api/study-sessions/:sessionId/pure-cue-assessments'
  | '/api/study-sessions/:sessionId/accepted-review-attempt-batch'
  | '/api/study-sessions/:sessionId/accepted-contrast-selection-attempt'
  | '/api/review-session-summaries';

export type StudyCommitCorrelation = {
  sessionId: string | null;
  sessionActionId: string | null;
  targetWordId: string | null;
  actionKind: string | null;
  promptTargetWordId: string | null;
  selectedWordId: string | null;
  eventIds: string[];
};

export type StudyCommitFailureDiagnostic = {
  schemaVersion: 'study_commit_failure.v1';
  event: 'study_commit.failed';
  diagnosticId: string;
  at: string;
  route: StudyCommitRoute;
  responseStatus: 400 | 500;
  elapsedMs: number;
  learnerId: string | null;
  correlation: StudyCommitCorrelation;
  request: {
    params: Record<string, string>;
    body: unknown;
  };
  error: StudyCommitDiagnosticError;
  runtime: {
    appVersion: string | null;
    appRevision: string | null;
    flyMachineId: string | null;
    processId: number;
  };
};

export type StudyCommitDiagnosticError = {
  name: string;
  message: string;
  stack: string | null;
  details: Record<string, string | number | boolean | null>;
  cause: StudyCommitDiagnosticError | null;
};

export function readStudyCommitDiagnostics(input: {
  dataDir: string;
  limit?: number;
  diagnosticId?: string | null;
}): {
  diagnosticsPath: string;
  totalRecordCount: number;
  malformedRecordCount: number;
  diagnostics: StudyCommitFailureDiagnostic[];
} {
  const diagnosticsPath = path.join(input.dataDir, STUDY_COMMIT_DIAGNOSTICS_FILENAME);
  if (!fs.existsSync(diagnosticsPath)) {
    return { diagnosticsPath, totalRecordCount: 0, malformedRecordCount: 0, diagnostics: [] };
  }

  const lines = fs.readFileSync(diagnosticsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const diagnostics: StudyCommitFailureDiagnostic[] = [];
  let malformedRecordCount = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isStudyCommitFailureDiagnostic(parsed)) {
        malformedRecordCount += 1;
        continue;
      }
      if (!input.diagnosticId || parsed.diagnosticId === input.diagnosticId) {
        diagnostics.push(parsed);
      }
    } catch {
      malformedRecordCount += 1;
    }
  }

  const limit = input.limit ?? 20;
  return {
    diagnosticsPath,
    totalRecordCount: lines.length - malformedRecordCount,
    malformedRecordCount,
    diagnostics: diagnostics.slice(Math.max(0, diagnostics.length - limit)),
  };
}

function isStudyCommitFailureDiagnostic(value: unknown): value is StudyCommitFailureDiagnostic {
  return isRecord(value)
    && value.schemaVersion === 'study_commit_failure.v1'
    && value.event === 'study_commit.failed'
    && typeof value.diagnosticId === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
