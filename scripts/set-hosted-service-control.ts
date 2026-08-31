import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  configureHostedDatabase,
  readBooleanArgument,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'actor-id', 'control', 'enabled']);
configureHostedDatabase(args);
const actorId = requireArgument(args, 'actor-id');
const control = requireArgument(args, 'control');
const key = control === 'maintenance'
  ? 'maintenance_mode'
  : control === 'provider-work'
    ? 'provider_work_enabled'
    : null;
if (key === null) throw new Error('--control must be maintenance or provider-work.');

const dbModule = await import(pathToFileURL(path.resolve('server/db.ts')).href);
const updated = dbModule.setHostedServiceControl({
  key,
  enabled: readBooleanArgument(args, 'enabled'),
  actorId,
});
console.log(JSON.stringify({ status: 'updated', control: updated }, null, 2));
