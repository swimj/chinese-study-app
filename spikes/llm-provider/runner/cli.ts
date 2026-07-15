import fs from 'node:fs';
import path from 'node:path';
import { allProviderFixtures } from '../fixtures/index.js';
import { getModelTarget, modelTargets } from './model-registry.js';
import { providerAdapters, getProviderAdapter } from './providers/index.js';
import { runBatch } from './run-batch.js';
import { renderFixtureUserPrompt, runFixture, writeRunArtifact } from './run-fixture.js';
import { SESSION_REFLECTION_RESULT_SCHEMA_NAME, sessionReflectionResultSchema } from './result-schema.js';

type CliOptions = {
  provider: string | null;
  model: string | null;
  modelIds: string[];
  fixtureId: string | null;
  systemPromptFile: string | null;
  outputDirectory: string;
  maxOutputTokens: number;
  temperature: number | null;
  timeoutMs: number;
  cachePrompt: boolean;
  baseUrl: string | null;
  dryRun: boolean;
  listFixtures: boolean;
  listModels: boolean;
  listProviders: boolean;
  help: boolean;
};

function usage(): string {
  return [
    'LLM provider spike runner',
    '',
    'Usage:',
    '  npm run spike:llm -- --provider <id> --model <model> --fixture <fixture-id> --system-prompt-file <path>',
    '  npm run spike:llm -- --models <id,id,...> --fixture <fixture-id> --system-prompt-file <path>',
    '',
    'Options:',
    '  --provider <id>              Provider for a single-model run',
    '  --model <model>              Exact provider model id for a single-model run',
    '  --models <id,id,...>         Run one fixture against registered model ids in order',
    '  --fixture <fixture-id>       One ready fixture id',
    '  --system-prompt-file <path>  Versioned prompt text; required for live and dry runs',
    '  --output-dir <path>          Default: artifacts/llm-provider',
    '  --max-output-tokens <n>      Default: 8192',
    '  --temperature <n>            Omit to use the provider/model default',
    '  --timeout-ms <n>             Default: 180000',
    '  --base-url <url>             Override the adapter endpoint root',
    '  --no-prompt-cache            Disable explicit prompt caching where supported',
    '  --dry-run                    Print request metadata without reading an API key',
    '  --list-fixtures              List fixture ids and exit',
    '  --list-models                List friendly model ids and their provider model ids',
    '  --list-providers             List adapters and key environment variables',
    '  --help                       Show this help',
  ].join('\n');
}

function parsePositiveInteger(raw: string, option: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${option} must be a positive integer.`);
  return value;
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    provider: null,
    model: null,
    modelIds: [],
    fixtureId: null,
    systemPromptFile: null,
    outputDirectory: path.resolve('artifacts/llm-provider'),
    maxOutputTokens: 8_192,
    temperature: null,
    timeoutMs: 180_000,
    cachePrompt: true,
    baseUrl: null,
    dryRun: false,
    listFixtures: false,
    listModels: false,
    listProviders: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '--provider':
        options.provider = takeValue(args, index, argument);
        index += 1;
        break;
      case '--model':
        options.model = takeValue(args, index, argument);
        index += 1;
        break;
      case '--models': {
        const modelIds = takeValue(args, index, argument)
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        if (modelIds.length === 0) throw new Error('--models requires at least one model id.');
        options.modelIds.push(...modelIds);
        index += 1;
        break;
      }
      case '--fixture':
        options.fixtureId = takeValue(args, index, argument);
        index += 1;
        break;
      case '--system-prompt-file':
        options.systemPromptFile = path.resolve(takeValue(args, index, argument));
        index += 1;
        break;
      case '--output-dir':
        options.outputDirectory = path.resolve(takeValue(args, index, argument));
        index += 1;
        break;
      case '--max-output-tokens':
        options.maxOutputTokens = parsePositiveInteger(takeValue(args, index, argument), argument);
        index += 1;
        break;
      case '--temperature': {
        const value = Number(takeValue(args, index, argument));
        if (!Number.isFinite(value) || value < 0) throw new Error('--temperature must be a non-negative number.');
        options.temperature = value;
        index += 1;
        break;
      }
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInteger(takeValue(args, index, argument), argument);
        index += 1;
        break;
      case '--base-url':
        options.baseUrl = takeValue(args, index, argument);
        index += 1;
        break;
      case '--no-prompt-cache':
        options.cachePrompt = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--list-fixtures':
        options.listFixtures = true;
        break;
      case '--list-models':
        options.listModels = true;
        break;
      case '--list-providers':
        options.listProviders = true;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function requireValue(value: string | null, option: string): string {
  if (value === null) throw new Error(`${option} is required.`);
  return value;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.listFixtures) {
    for (const fixture of allProviderFixtures) {
      console.log(`${fixture.fixtureId}\t${fixture.readiness}\t${fixture.evaluation.mode ?? 'scored'}\t${fixture.source.title}`);
    }
    return;
  }
  if (options.listModels) {
    for (const target of modelTargets) {
      console.log(`${target.id}\t${target.provider}\t${target.model}`);
    }
    return;
  }
  if (options.listProviders) {
    for (const adapter of providerAdapters) {
      console.log(`${adapter.id}\t${adapter.structuredOutputMode}\t${adapter.apiKeyEnvironmentVariable}\t${adapter.defaultBaseUrl}`);
    }
    return;
  }

  const fixtureId = requireValue(options.fixtureId, '--fixture');
  const systemPromptFile = requireValue(options.systemPromptFile, '--system-prompt-file');
  const fixture = allProviderFixtures.find((candidate) => candidate.fixtureId === fixtureId);
  if (fixture === undefined) throw new Error(`Unknown fixture ${fixtureId}. Use --list-fixtures.`);
  if (fixture.readiness !== 'ready') throw new Error(`Fixture ${fixtureId} is ${fixture.readiness}, not ready.`);

  const systemPrompt = fs.readFileSync(systemPromptFile, 'utf8');
  if (systemPrompt.trim().length === 0) throw new Error('System prompt file must not be empty.');
  const userPrompt = renderFixtureUserPrompt(fixture);

  if (options.modelIds.length > 0) {
    if (options.provider !== null || options.model !== null) {
      throw new Error('Use either --models for a comparison or --provider and --model for a single run, not both.');
    }
    if (options.baseUrl !== null) {
      throw new Error('--base-url is only available for single-model runs.');
    }
    if (new Set(options.modelIds).size !== options.modelIds.length) {
      throw new Error('--models must not contain duplicate model ids.');
    }
    const targets = options.modelIds.map(getModelTarget);

    if (options.dryRun) {
      console.log(JSON.stringify({
        fixtureId,
        systemPromptFile,
        models: targets.map((target) => {
          const adapter = getProviderAdapter(target.provider);
          return {
            id: target.id,
            provider: target.provider,
            model: target.model,
            structuredOutputMode: adapter.structuredOutputMode,
            baseUrl: adapter.defaultBaseUrl,
          };
        }),
        outputSchemaName: SESSION_REFLECTION_RESULT_SCHEMA_NAME,
        outputSchema: sessionReflectionResultSchema,
        systemPrompt,
        userPrompt,
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature,
        timeoutMs: options.timeoutMs,
        cachePrompt: options.cachePrompt,
      }, null, 2));
      return;
    }

    const apiKeysByProvider = new Map<string, string>();
    for (const target of targets) {
      const adapter = getProviderAdapter(target.provider);
      const apiKey = process.env[adapter.apiKeyEnvironmentVariable];
      if (apiKey === undefined || apiKey.trim().length === 0) {
        throw new Error(`Set ${adapter.apiKeyEnvironmentVariable} before running model ${target.id}.`);
      }
      apiKeysByProvider.set(target.provider, apiKey);
    }

    const entries = await runBatch({
      fixture,
      targets,
      apiKeysByProvider,
      systemPrompt,
      systemPromptFile,
      outputDirectory: options.outputDirectory,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
      cachePrompt: options.cachePrompt,
    });
    for (const entry of entries) {
      console.log(`${entry.artifact.response.status}\t${entry.target.id}\t${entry.artifactPath}`);
    }
    if (entries.some((entry) => entry.artifact.response.status !== 'success')) process.exitCode = 1;
    return;
  }

  const providerId = requireValue(options.provider, '--provider');
  const model = requireValue(options.model, '--model');
  const adapter = getProviderAdapter(providerId);

  if (options.dryRun) {
    console.log(JSON.stringify({
      provider: adapter.id,
      model,
      fixtureId,
      systemPromptFile,
      structuredOutputMode: adapter.structuredOutputMode,
      outputSchemaName: SESSION_REFLECTION_RESULT_SCHEMA_NAME,
      outputSchema: sessionReflectionResultSchema,
      systemPrompt,
      userPrompt,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
      cachePrompt: options.cachePrompt,
      baseUrl: options.baseUrl ?? adapter.defaultBaseUrl,
    }, null, 2));
    return;
  }

  const apiKey = process.env[adapter.apiKeyEnvironmentVariable];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(`Set ${adapter.apiKeyEnvironmentVariable} before running provider ${adapter.id}.`);
  }

  const artifact = await runFixture({
    adapter,
    fixture,
    model,
    apiKey,
    baseUrl: options.baseUrl,
    systemPrompt,
    systemPromptFile,
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    cachePrompt: options.cachePrompt,
  });
  const outputPath = writeRunArtifact(artifact, path.join(options.outputDirectory, 'runs'));
  console.log(`${artifact.response.status}\t${outputPath}`);
  if (artifact.response.status !== 'success') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
