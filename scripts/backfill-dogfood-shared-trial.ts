import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = new Map(process.argv.slice(2).map(parseArg).filter((entry): entry is [string, string] => entry !== null));
const dataDir = args.get('data-dir');
const learnerId = args.get('learner-id');
const apply = parseApply(args.get('apply'));

if (!dataDir) throw new Error('Expected --data-dir=/absolute/path');
if (!learnerId || learnerId.trim().length === 0) throw new Error('Expected --learner-id=<stable-id>');

const publishedAt = args.get('published-at') ?? new Date().toISOString();
const resolvedDataDir = path.resolve(dataDir);

process.env.APP_MODE = 'study';
process.env.APP_AUTH_MODE = 'trusted_local';
process.env.APP_DATA_DIR = resolvedDataDir;
process.env.APP_LEARNER_ID = learnerId;

const dbModuleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?dogfood-shared-trial-backfill=${Date.now()}`;
const db = await import(dbModuleUrl);
const report = db.runWithLearnerId(learnerId, () => (
  apply
    ? db.backfillDogfoodSharedTrialContent({ publishedAt })
    : db.inspectDogfoodSharedTrialBackfill({ publishedAt })
));

process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'report_only', ...report }, null, 2)}\n`);

function parseApply(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('Expected --apply=true or --apply=false');
}

function parseArg(argument: string): [string, string] | null {
  if (!argument.startsWith('--')) return null;
  const [key, ...rest] = argument.slice(2).split('=');
  if (!key || rest.length === 0) return null;
  return [key, rest.join('=')];
}
