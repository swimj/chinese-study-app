import {
  configureHostedDatabase,
  readBooleanArgument,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';
import { closeDbConnection } from '../server/db/connection.ts';

const args = readStrictArguments(['data-dir', 'learner-id', 'disabled', 'actor-id']);
configureHostedDatabase(args);

const { setHostedLearnerDisabled } = await import('../server/db.ts');
try {
  const result = setHostedLearnerDisabled({
    learnerId: requireArgument(args, 'learner-id'),
    disabled: readBooleanArgument(args, 'disabled'),
    actorId: requireArgument(args, 'actor-id'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  closeDbConnection();
}
