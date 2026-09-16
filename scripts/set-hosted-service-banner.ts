import { closeDbConnection } from '../server/db/connection.ts';
import {
  configureHostedDatabase,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'actor-id', 'message', 'clear']);
configureHostedDatabase(args);
const actorId = requireArgument(args, 'actor-id');
const clearRaw = args.get('clear');
const messageRaw = args.get('message');
if (clearRaw !== undefined && messageRaw !== undefined) {
  throw new Error('Pass either --message=... or --clear=true, not both.');
}

const dbModule = await import('../server/db.ts');
try {
  if (clearRaw !== undefined) {
    if (clearRaw !== 'true') throw new Error('--clear must be true.');
    const result = dbModule.clearServiceBanner({ actorId });
    console.log(JSON.stringify({ status: result.status, banner: result }, null, 2));
  } else {
    if (messageRaw === undefined) {
      throw new Error('Expected --message=... to post a banner or --clear=true to clear one.');
    }
    const banner = dbModule.setServiceBanner({ message: messageRaw, actorId });
    console.log(JSON.stringify({ status: 'updated', banner }, null, 2));
  }
} finally {
  closeDbConnection();
}
