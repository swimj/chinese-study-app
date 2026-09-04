import { clerkClient } from '@clerk/express';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { configureHostedDatabase, readStrictArguments } from './lib/hosted-runtime.ts';
import {
  createClerkSmokeDirectoryFromClient,
  runHostedSmoke,
} from './lib/hosted-smoke.ts';

const args = readStrictArguments(['data-dir', 'clerk-user-id', 'clerk-email', 'api-base']);
configureHostedDatabase(args);
const dbModule = await import(pathToFileURL(path.resolve('server/db.ts')).href);

const clerkUserId = args.get('clerk-user-id')?.trim() || process.env.APP_SMOKE_CLERK_USER_ID;
const clerkEmail = args.get('clerk-email')?.trim() || process.env.APP_SMOKE_CLERK_EMAIL;
const apiBase = args.get('api-base')?.trim() || `http://127.0.0.1:${process.env.PORT?.trim() || '5174'}`;

const result = await runHostedSmoke({
  clerkUserId,
  clerkEmail,
  apiBase,
  clerk: createClerkSmokeDirectoryFromClient(clerkClient),
  learners: {
    resolveClerkLearnerId(userId) {
      return dbModule.resolveLearnerId(dbModule.CLERK_AUTH_PROVIDER, userId);
    },
    assertLearnerUsable(learnerId) {
      dbModule.assertLearnerExists(learnerId);
    },
  },
});

console.log(JSON.stringify(result, null, 2));
if (result.status !== 'ok') process.exitCode = 1;
