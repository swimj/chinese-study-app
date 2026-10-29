import fs from 'node:fs';
import path from 'node:path';
import { configureHostedDatabase, readStrictArguments, requireArgument, readBooleanArgument } from './lib/hosted-runtime.ts';
import { closeDbConnection } from '../server/db/connection.ts';

const args = readStrictArguments(['data-dir', 'learner-id', 'actor-id', 'apply', 'confirm-plan']);
const dataDir = configureHostedDatabase(args);
const learnerId = requireArgument(args, 'learner-id');
const apply = args.has('apply') ? readBooleanArgument(args, 'apply') : false;
const actorId = apply ? requireArgument(args, 'actor-id') : null;
const expectedPlanDigest = apply ? requireArgument(args, 'confirm-plan') : null;
if (!fs.existsSync(path.join(dataDir, 'app.db'))) throw new Error('Recovery requires an existing database.');

const { runWithLearnerId, assertLearnerExists, previewCorrectCueRepairRecovery, recoverCorrectCueRepairs } = await import('../server/db.ts');
try {
  const result = runWithLearnerId(learnerId, () => {
    assertLearnerExists(learnerId);
    return apply
      ? recoverCorrectCueRepairs({ actorId: actorId!, expectedPlanDigest: expectedPlanDigest! })
      : previewCorrectCueRepairRecovery();
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  closeDbConnection();
}
