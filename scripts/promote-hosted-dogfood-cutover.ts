import {
  readBooleanArgument,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';
import { promotePreparedDogfoodDatabase } from './lib/hosted-dogfood-cutover.ts';

const args = readStrictArguments([
  'data-dir',
  'incoming-db',
  'manifest',
  'cutover-id',
  'litestream-socket',
  'apply',
  'confirm-normal-process-stopped',
]);
const apply = args.has('apply') ? readBooleanArgument(args, 'apply') : false;
const confirmNormalProcessStopped = args.has('confirm-normal-process-stopped')
  ? readBooleanArgument(args, 'confirm-normal-process-stopped')
  : false;
const report = promotePreparedDogfoodDatabase({
  dataDir: requireArgument(args, 'data-dir'),
  incomingDatabasePath: requireArgument(args, 'incoming-db'),
  manifestPath: requireArgument(args, 'manifest'),
  cutoverId: requireArgument(args, 'cutover-id'),
  litestreamSocketPath: requireArgument(args, 'litestream-socket'),
  apply,
  confirmNormalProcessStopped,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
