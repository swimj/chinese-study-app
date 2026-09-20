import path from 'node:path';
import {
  activateHostedRc,
  createDefaultHostedRcDeps,
  idleHostedRc,
  inspectHostedRc,
  quiesceHostedRc,
  runHostedRcDeploy,
  type HostedRcSchemaMode,
} from './lib/hosted-rc.ts';
import {
  readBooleanArgument,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';

const args = readStrictArguments([
  'action',
  'app',
  'actor-id',
  'confirm-source-revision',
  'confirm-disposable-rc-data',
  'schema',
  'source-backup-env-file',
  'restore-age-hours',
  'image',
  'replica-path',
]);
const action = requireArgument(args, 'action');
const app = requireArgument(args, 'app');
const repoRoot = process.cwd();
const configPath = path.join(repoRoot, 'deploy/fly/.generated/rc.fly.toml');
const deps = createDefaultHostedRcDeps(repoRoot);

if (action === 'deploy' || action === 'restore') {
  const rawSchema = requireArgument(args, 'schema');
  if (rawSchema !== 'unchanged' && rawSchema !== 'migrate') {
    throw new Error('--schema must be unchanged or migrate.');
  }
  const restoreAgeRaw = args.get('restore-age-hours');
  const restoreAgeHours = restoreAgeRaw === undefined ? undefined : Number(restoreAgeRaw);
  const result = await runHostedRcDeploy({
    repoRoot,
    app,
    actorId: requireArgument(args, 'actor-id'),
    confirmSourceRevision: requireArgument(args, 'confirm-source-revision'),
    confirmDisposableRcData: readBooleanArgument(args, 'confirm-disposable-rc-data'),
    schemaMode: rawSchema as HostedRcSchemaMode,
    sourceBackupEnvFile: requireArgument(args, 'source-backup-env-file'),
    restoreAgeHours,
    activateAfterPrepare: action === 'deploy',
    flyConfigPath: configPath,
  }, deps);
  if (result.status !== 'ok') process.exitCode = 1;
} else if (action === 'activate') {
  console.log(JSON.stringify({
    status: 'active',
    app,
    ...await activateHostedRc({
      repoRoot,
      app,
      actorId: requireArgument(args, 'actor-id'),
      sourceRevision: requireArgument(args, 'confirm-source-revision'),
      image: requireArgument(args, 'image'),
      replicaPath: requireArgument(args, 'replica-path'),
      flyConfigPath: configPath,
    }, deps),
  }, null, 2));
} else if (action === 'quiesce') {
  await quiesceHostedRc(app, requireArgument(args, 'actor-id'), configPath, deps);
  console.log(JSON.stringify({ status: 'quiesced', app }));
} else if (action === 'idle') {
  await idleHostedRc(app, requireArgument(args, 'actor-id'), configPath, deps);
  console.log(JSON.stringify({ status: 'idle', app }));
} else if (action === 'status') {
  console.log(JSON.stringify(await inspectHostedRc(app, configPath, deps), null, 2));
} else {
  throw new Error('--action must be deploy, restore, activate, quiesce, idle, or status.');
}
