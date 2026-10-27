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
    : control === 'operator-only'
      ? 'operator_only'
      : null;
if (key === null) throw new Error('--control must be maintenance, provider-work, or operator-only.');

const dbModule = await import(pathToFileURL(path.resolve('server/db.ts')).href);
const updated = dbModule.setHostedServiceControl({
  key,
  enabled: readBooleanArgument(args, 'enabled'),
  actorId,
});
console.log(JSON.stringify({ status: 'updated', control: updated }, null, 2));
