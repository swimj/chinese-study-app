import {
  configureHostedDatabase,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';
import { closeDbConnection } from '../server/db/connection.ts';

const args = readStrictArguments(['data-dir', 'learner-id', 'actor-id', 'word-id']);
configureHostedDatabase(args);

const { provisionHostedBetaReviewTest } = await import('../server/db.ts');
try {
  const result = provisionHostedBetaReviewTest({
    learnerId: requireArgument(args, 'learner-id'),
    actorId: requireArgument(args, 'actor-id'),
    wordId: args.get('word-id'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  closeDbConnection();
}
