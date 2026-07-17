import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

export type TrashRunArtifactResult =
  | { status: 'trashed'; relativePath: string; trashRelativePath: string }
  | { status: 'not_found' }
  | { status: 'ambiguous'; relativePaths: string[] };

function isPathInside(parentDirectory: string, candidatePath: string): boolean {
  const relative = path.relative(parentDirectory, candidatePath);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function normalizedRelativePath(rootDirectory: string, filePath: string): string {
  return path.relative(rootDirectory, filePath).split(path.sep).join('/');
}

export function trashRunArtifact(artifactsDirectory: string, runId: string): TrashRunArtifactResult {
  const rootDirectory = path.resolve(artifactsDirectory);
  const scan = scanRunArtifacts(rootDirectory);
  const duplicate = scan.duplicateRunIds.find((entry) => entry.runId === runId);
  if (duplicate !== undefined) return { status: 'ambiguous', relativePaths: duplicate.relativePaths };

  const indexed = scan.artifacts.find((entry) => entry.index.runId === runId);
  if (indexed === undefined) return { status: 'not_found' };

  const sourcePath = path.resolve(indexed.absolutePath);
  if (!isPathInside(rootDirectory, sourcePath)) {
    throw new Error(`Refusing to trash artifact outside ${rootDirectory}.`);
  }

  let sourceStats: fs.Stats;
  try {
    sourceStats = fs.lstatSync(sourcePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { status: 'not_found' };
    throw error;
  }
  if (!sourceStats.isFile()) throw new Error('Refusing to trash an artifact that is no longer a regular file.');

  const trashDirectory = path.join(rootDirectory, '.trash');
  if (fs.existsSync(trashDirectory)) {
    if (!fs.lstatSync(trashDirectory).isDirectory()) {
      throw new Error(`Artifact trash path is not a directory: ${trashDirectory}`);
    }
  } else {
    fs.mkdirSync(trashDirectory, { recursive: false });
  }

  let trashPath = path.join(trashDirectory, path.basename(sourcePath));
  if (fs.existsSync(trashPath)) {
    const extension = path.extname(trashPath);
    trashPath = path.join(trashDirectory, `${path.basename(trashPath, extension)}__${randomUUID()}${extension}`);
  }
  fs.renameSync(sourcePath, trashPath);
  return {
    status: 'trashed',
    relativePath: indexed.index.relativePath,
    trashRelativePath: normalizedRelativePath(rootDirectory, trashPath),
  };
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

  app.delete('/api/runs/:runId', (request, response) => {
    try {
      const result = trashRunArtifact(options.artifactsDirectory, request.params.runId);
      if (result.status === 'not_found') {
        response.status(404).json({ error: `Unknown run ${request.params.runId}.` });
        return;
      }
      if (result.status === 'ambiguous') {
        response.status(409).json({
          error: `Run id ${request.params.runId} appears in more than one artifact.`,
          relativePaths: result.relativePaths,
        });
        return;
      }
      response.json({ runId: request.params.runId, ...result });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
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
