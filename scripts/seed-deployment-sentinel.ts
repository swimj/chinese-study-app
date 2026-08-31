import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  configureHostedDatabase,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'actor-id', 'sentinel-id']);
configureHostedDatabase(args);
const dbModule = await import(pathToFileURL(path.resolve('server/db.ts')).href);
const sentinel = dbModule.createDeploymentSentinel({
  sentinelId: requireArgument(args, 'sentinel-id'),
  actorId: requireArgument(args, 'actor-id'),
});
console.log(JSON.stringify({ status: 'created', sentinel }, null, 2));
