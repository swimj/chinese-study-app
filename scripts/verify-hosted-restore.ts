import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  configureHostedDatabase,
  readNonNegativeIntegerArgument,
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'sentinel-id', 'minimum-learners']);
configureHostedDatabase(args);
const minimumLearners = readNonNegativeIntegerArgument(args, 'minimum-learners', 0);
const dbModule = await import(pathToFileURL(path.resolve('server/db.ts')).href);
const validation = dbModule.validateHostedRestore(requireArgument(args, 'sentinel-id'));
if (validation.learnerCount < minimumLearners) {
  throw new Error(
    `Restored database has ${validation.learnerCount} learners; expected at least ${minimumLearners}.`,
  );
}
console.log(JSON.stringify({ status: 'valid', validation }, null, 2));
