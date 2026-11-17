import { prepareRehearsal, operateRehearsal } from './lib/hosted-rehearsal.ts';
import { createDefaultHostedUpgradeDeps } from './lib/hosted-upgrade.ts';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';

const args = readStrictArguments(['backup-capture', 'backup-provider', 'source-revision', 'action', 'app', 'source-app', 'image', 'schema', 'source-backup-env-file', 'run-dir', 'region', 'vm-size', 'volume-size-gb', 'script']);
const action = requireArgument(args, 'action');
const dir = requireArgument(args, 'run-dir');
const deps = createDefaultHostedUpgradeDeps(process.cwd());
if (action === 'prepare') {
  const schema = requireArgument(args, 'schema');
  if (schema !== 'unchanged' && schema !== 'migrate') throw new Error('--schema must be unchanged or migrate.');
  const backupProvider = args.get('backup-provider') ?? 'sqlite';
  if (backupProvider !== 'sqlite' && backupProvider !== 'litestream') throw new Error('Invalid --backup-provider.');
  const backupCapture = args.get('backup-capture') ?? 'retained';
  if (backupCapture !== 'retained' && backupCapture !== 'fresh') throw new Error('--backup-capture must be retained or fresh.');
  await prepareRehearsal({ backupCapture, backupProvider, sourceRevision: args.get('source-revision'), app: requireArgument(args, 'app'), sourceApp: requireArgument(args, 'source-app'),
    image: requireArgument(args, 'image'), schema, sourceBackupEnvFile: requireArgument(args, 'source-backup-env-file'), runDir: dir,
    region: args.get('region'), vmSize: args.get('vm-size'), volumeSizeGb: args.has('volume-size-gb') ? Number(args.get('volume-size-gb')) : undefined }, deps);
} else if (action === 'check' || action === 'migrate' || action === 'status' || action === 'destroy') {
  await operateRehearsal(action, dir, deps, args.get('script'));
} else throw new Error('--action must be prepare, check, migrate, status, or destroy.');
