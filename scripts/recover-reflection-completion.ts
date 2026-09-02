import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  configureHostedDatabase,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';
import { closeDbConnection } from '../server/db/connection.ts';

const args = readStrictArguments([
  'data-dir',
  'learner-id',
  'bundle-path',
  'result-path',
  'generated-at',
  'provider',
  'model',
  'prompt-version',
]);
configureHostedDatabase(args);

const { recoverReflectionCompletion } = await import('./lib/recover-reflection-completion.ts');
const { runWithLearnerId } = await import('../server/db.ts');

try {
  const bundle = await readJsonFile(requireAbsolutePath(args, 'bundle-path'));
  const result = await readJsonFile(requireAbsolutePath(args, 'result-path'));
  const recovered = runWithLearnerId(requireArgument(args, 'learner-id'), () => (
    recoverReflectionCompletion({
      bundle,
      result,
      generatedAt: args.get('generated-at')?.trim() || readBundleGeneratedAt(bundle),
      provider: args.get('provider')?.trim() || 'openai',
      model: args.get('model')?.trim() || 'gpt-5.6-terra-high',
      promptVersion: args.get('prompt-version')?.trim() || 'reflection-v8',
    })
  ));
  process.stdout.write(`${JSON.stringify(recovered)}\n`);
} finally {
  closeDbConnection();
}

function requireAbsolutePath(args: Map<string, string>, key: string): string {
  const filePath = requireArgument(args, key);
  if (!path.isAbsolute(filePath)) throw new Error(`--${key} must be an absolute path.`);
  return path.resolve(filePath);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse JSON from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readBundleGeneratedAt(bundle: unknown): string {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    throw new Error('Recovery bundle must be a JSON object.');
  }
  const generatedAt = (bundle as Record<string, unknown>).generatedAt;
  if (typeof generatedAt !== 'string' || generatedAt.trim().length === 0) {
    throw new Error('Recovery bundle is missing generatedAt; pass --generated-at=... explicitly.');
  }
  return generatedAt;
}
