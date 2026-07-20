import path from 'node:path';
import type { ReflectionProviderFixtureV0 } from '../contracts.js';
import type { ModelTarget } from './model-registry.js';
import { getProviderAdapter } from './providers/index.js';
import { runFixture, writeRunArtifact } from './run-fixture.js';
import type { ProviderAdapter, ReflectionRunArtifactV0 } from './types.js';

export type BatchRunEntry = {
  target: ModelTarget;
  artifact: ReflectionRunArtifactV0;
  artifactPath: string;
};

export type RunBatchOptions = {
  fixture: ReflectionProviderFixtureV0;
  targets: ModelTarget[];
  apiKeysByProvider: ReadonlyMap<string, string>;
  systemPrompt: string;
  systemPromptFile: string;
  outputDirectory: string;
  maxOutputTokens: number;
  temperature: number | null;
  timeoutMs: number;
  cachePrompt: boolean;
  getAdapter?: (providerId: string) => ProviderAdapter;
};

export async function runBatch(options: RunBatchOptions): Promise<BatchRunEntry[]> {
  if (options.targets.length === 0) throw new Error('A batch requires at least one model.');
  const getAdapter = options.getAdapter ?? getProviderAdapter;
  const runsDirectory = path.join(options.outputDirectory, 'runs');
  const entries: BatchRunEntry[] = [];

  for (const target of options.targets) {
    const adapter = getAdapter(target.provider);
    const apiKey = options.apiKeysByProvider.get(target.provider);
    if (apiKey === undefined || apiKey.trim().length === 0) {
      throw new Error(`No API key was supplied for batch provider ${target.provider}.`);
    }
    const artifact = await runFixture({
      adapter,
      fixture: options.fixture,
      model: target.model,
      modelConfigId: target.id,
      reasoningEffort: target.reasoningEffort,
      apiKey,
      baseUrl: null,
      systemPrompt: options.systemPrompt,
      systemPromptFile: options.systemPromptFile,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
      cachePrompt: options.cachePrompt,
    });
    const artifactPath = writeRunArtifact(artifact, runsDirectory);
    entries.push({ target, artifact, artifactPath });
  }

  return entries;
}
