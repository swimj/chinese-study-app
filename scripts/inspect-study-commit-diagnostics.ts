import path from 'node:path';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { readStudyCommitDiagnostics } from '../server/study-commit-diagnostics.ts';

const args = readStrictArguments(['data-dir', 'limit', 'diagnostic-id']);
const rawDataDir = requireArgument(args, 'data-dir');
if (!path.isAbsolute(rawDataDir)) throw new Error('--data-dir must be an absolute path.');

const rawLimit = args.get('limit') ?? '20';
const limit = Number(rawLimit);
if (!Number.isInteger(limit) || limit <= 0) {
  throw new Error('--limit must be a positive integer.');
}

const result = readStudyCommitDiagnostics({
  dataDir: path.resolve(rawDataDir),
  limit,
  diagnosticId: args.get('diagnostic-id')?.trim() || null,
});
console.log(JSON.stringify({ status: 'ok', ...result }, null, 2));
