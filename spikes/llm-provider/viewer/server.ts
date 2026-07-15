import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { allProviderFixtures } from '../fixtures/index.js';
import { scanRunArtifacts } from './artifact-index.js';

export type ViewerServerOptions = {
  artifactsDirectory: string;
  staticDirectory?: string;
};

export const defaultViewerStaticDirectory = fileURLToPath(new URL('./public', import.meta.url));

export function buildViewerIndex(artifactsDirectory: string): object {
  const scan = scanRunArtifacts(artifactsDirectory);
  return {
    runs: scan.artifacts.map((entry) => entry.index),
    warnings: scan.warnings,
    fixtures: allProviderFixtures.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      title: fixture.source.title,
      evaluationMode: fixture.evaluation.mode ?? 'scored',
      evaluation: fixture.evaluation,
    })),
  };
}

export function findRunArtifact(artifactsDirectory: string, runId: string): unknown | null {
  const scan = scanRunArtifacts(artifactsDirectory);
  return scan.artifacts.find((entry) => entry.index.runId === runId)?.artifact ?? null;
}

export function createViewerApp(options: ViewerServerOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/index', (_request, response) => {
    response.json(buildViewerIndex(options.artifactsDirectory));
  });

  app.get('/api/runs/:runId', (request, response) => {
    const artifact = findRunArtifact(options.artifactsDirectory, request.params.runId);
    if (artifact === null) {
      response.status(404).json({ error: `Unknown run ${request.params.runId}.` });
      return;
    }
    response.json(artifact);
  });

  app.use(express.static(options.staticDirectory ?? defaultViewerStaticDirectory));
  return app;
}

type ServerCliOptions = {
  port: number;
  artifactsDirectory: string;
};

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`${option} must be an integer between 1 and 65535.`);
  }
  return parsed;
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function parseArgs(args: string[]): ServerCliOptions {
  const options: ServerCliOptions = {
    port: 4_180,
    artifactsDirectory: path.resolve('artifacts/llm-provider'),
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '--port':
        options.port = parsePositiveInteger(takeValue(args, index, argument), argument);
        index += 1;
        break;
      case '--artifacts-dir':
        options.artifactsDirectory = path.resolve(takeValue(args, index, argument));
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const app = createViewerApp({ artifactsDirectory: options.artifactsDirectory });
  const server = app.listen(options.port, '127.0.0.1', () => {
    console.log(`LLM run viewer: http://127.0.0.1:${options.port}`);
    console.log(`Artifacts: ${options.artifactsDirectory}`);
  });
  server.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

const entrypoint = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (entrypoint === fileURLToPath(import.meta.url)) main();
