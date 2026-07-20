import fs from 'node:fs';
import path from 'node:path';
import type { ReflectionRunArtifactV0 } from '../runner/types.js';
import {
  validateRunArtifactAgainstCurrentContract,
  type CurrentRunValidation,
} from './current-validation.js';
import { estimateRunCost, type EstimatedRunCost } from '../pricing.js';

export type RunIndexEntry = {
  runId: string;
  fixtureId: string;
  startedAt: string;
  durationMs: number;
  provider: string;
  requestedModel: string;
  providerModel: string | null;
  status: ReflectionRunArtifactV0['response']['status'];
  currentValidation: CurrentRunValidation;
  systemPromptFile: string;
  systemPromptSha256: string;
  usage: ReflectionRunArtifactV0['response']['usage'];
  estimatedCost: EstimatedRunCost | null;
  relativePath: string;
};

export type IndexedRunArtifact = {
  index: RunIndexEntry;
  artifact: ReflectionRunArtifactV0;
  absolutePath: string;
};

export type ArtifactScanResult = {
  artifacts: IndexedRunArtifact[];
  warnings: Array<{ relativePath: string; message: string }>;
  duplicateRunIds: Array<{ runId: string; relativePaths: string[] }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeRunArtifact(value: unknown): value is ReflectionRunArtifactV0 {
  if (!isRecord(value) || value.schemaVersion !== 'llm_provider_run.v0') return false;
  if (typeof value.runId !== 'string' || typeof value.fixtureId !== 'string') return false;
  if (typeof value.startedAt !== 'string' || typeof value.durationMs !== 'number') return false;
  if (!isRecord(value.request) || !isRecord(value.response)) return false;
  return typeof value.request.provider === 'string'
    && typeof value.request.model === 'string'
    && typeof value.request.systemPromptFile === 'string'
    && typeof value.request.systemPromptSha256 === 'string'
    && typeof value.response.status === 'string';
}

function jsonFilesRecursively(rootDirectory: string): string[] {
  if (!fs.existsSync(rootDirectory)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== '.trash') visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(entryPath);
    }
  };
  visit(rootDirectory);
  return files;
}

function relativePath(rootDirectory: string, filePath: string): string {
  return path.relative(rootDirectory, filePath).split(path.sep).join('/');
}

export function scanRunArtifacts(rootDirectory: string): ArtifactScanResult {
  const artifacts: IndexedRunArtifact[] = [];
  const warnings: ArtifactScanResult['warnings'] = [];
  const firstPathByRunId = new Map<string, string>();
  const duplicatePathsByRunId = new Map<string, string[]>();

  for (const filePath of jsonFilesRecursively(rootDirectory)) {
    const relative = relativePath(rootDirectory, filePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      warnings.push({
        relativePath: relative,
        message: `Could not parse JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (!looksLikeRunArtifact(parsed)) continue;
    const firstPath = firstPathByRunId.get(parsed.runId);
    if (firstPath !== undefined) {
      const duplicatePaths = duplicatePathsByRunId.get(parsed.runId) ?? [firstPath];
      duplicatePaths.push(relative);
      duplicatePathsByRunId.set(parsed.runId, duplicatePaths);
      warnings.push({ relativePath: relative, message: `Duplicate run id ${parsed.runId}; ignored.` });
      continue;
    }
    firstPathByRunId.set(parsed.runId, relative);
    artifacts.push({
      artifact: parsed,
      absolutePath: filePath,
      index: {
        runId: parsed.runId,
        fixtureId: parsed.fixtureId,
        startedAt: parsed.startedAt,
        durationMs: parsed.durationMs,
        provider: parsed.request.provider,
        requestedModel: parsed.request.model,
        providerModel: parsed.response.providerModel,
        status: parsed.response.status,
        currentValidation: validateRunArtifactAgainstCurrentContract(parsed),
        systemPromptFile: parsed.request.systemPromptFile,
        systemPromptSha256: parsed.request.systemPromptSha256,
        usage: parsed.response.usage,
        estimatedCost: estimateRunCost(parsed.request.model, parsed.response.usage),
        relativePath: relative,
      },
    });
  }

  artifacts.sort((left, right) => right.index.startedAt.localeCompare(left.index.startedAt));
  const duplicateRunIds = [...duplicatePathsByRunId].map(([runId, relativePaths]) => ({ runId, relativePaths }));
  return { artifacts, warnings, duplicateRunIds };
}
