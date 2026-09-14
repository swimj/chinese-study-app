import { clerkClient } from '@clerk/express';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import {
  HostedClerkInviteError,
  inviteHostedLearner,
} from './lib/hosted-clerk-invite.ts';

const args = readStrictArguments(['email-env']);

try {
  const result = await inviteHostedLearner({
    client: clerkClient,
    emailEnvName: requireArgument(args, 'email-env'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const code = error instanceof HostedClerkInviteError ? error.safeCode : 'CLERK_INVITE_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
  process.exitCode = 1;
}
