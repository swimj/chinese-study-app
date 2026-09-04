import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { configureHostedDatabase, readStrictArguments } from './lib/hosted-runtime.ts';
import { readHostedBackupStatus } from '../server/hosted-backup-status.ts';
import { readHostedReleaseIdentity } from '../server/hosted-release-identity.ts';

const args = readStrictArguments(['data-dir', 'litestream-socket']);
configureHostedDatabase(args);
const dbModule = await import(pathToFileURL(path.resolve('server/db.ts')).href);
console.log(JSON.stringify({
  status: 'ok',
  releaseIdentity: readHostedReleaseIdentity(),
  diagnostics: dbModule.getHostedOperationalDiagnostics(),
  backup: await readHostedBackupStatus({ socketPath: args.get('litestream-socket') }),
}, null, 2));
