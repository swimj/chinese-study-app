import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  HostedClerkInviteError,
  inviteHostedLearner,
  readInviteRedirectUrl,
} from '../scripts/lib/hosted-clerk-invite.ts';

describe('hosted Clerk invitations', () => {
  test('creates an invitation that returns to the app origin and never prints the email', async () => {
    const calls: Array<{ emailAddress: string; notify: boolean; redirectUrl: string }> = [];
    const result = await inviteHostedLearner({
      client: {
        invitations: {
          async createInvitation(params) {
            calls.push(params);
            return { id: 'inv_secret' };
          },
        },
      },
      emailEnvName: 'HOSTED_INVITE_EMAIL',
      environment: {
        HOSTED_INVITE_EMAIL: 'private-alias@example.test',
        CLERK_AUTHORIZED_PARTY: 'https://study-example.fly.dev',
      },
    });

    assert.deepEqual(result, { status: 'ok', createdCount: 1 });
    assert.deepEqual(calls, [{
      emailAddress: 'private-alias@example.test',
      notify: true,
      redirectUrl: 'https://study-example.fly.dev',
    }]);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /private-alias/);
    assert.doesNotMatch(serialized, /inv_secret/);
  });

  test('refuses unsafe email env names, missing emails, and invalid app origins', async () => {
    const client = {
      invitations: {
        async createInvitation() {
          throw new Error('must not invite');
        },
      },
    };

    await assert.rejects(
      () => inviteHostedLearner({
        client,
        emailEnvName: 'email',
        environment: { email: 'private-alias@example.test' },
      }),
      (error: unknown) => error instanceof HostedClerkInviteError && error.safeCode === 'INVALID_EMAIL_ENV_NAME',
    );
    await assert.rejects(
      () => inviteHostedLearner({
        client,
        emailEnvName: 'HOSTED_INVITE_EMAIL',
        environment: {
          HOSTED_INVITE_EMAIL: 'not-an-email',
          CLERK_AUTHORIZED_PARTY: 'https://study-example.fly.dev',
        },
      }),
      (error: unknown) => error instanceof HostedClerkInviteError
        && error.safeCode === 'EMAIL_ENV_VALUE_MISSING_OR_INVALID',
    );
    assert.throws(
      () => readInviteRedirectUrl({}),
      (error: unknown) => error instanceof HostedClerkInviteError
        && error.safeCode === 'CLERK_AUTHORIZED_PARTY_MISSING',
    );
    assert.throws(
      () => readInviteRedirectUrl({ CLERK_AUTHORIZED_PARTY: 'https://study-example.fly.dev/path' }),
      (error: unknown) => error instanceof HostedClerkInviteError
        && error.safeCode === 'CLERK_AUTHORIZED_PARTY_INVALID',
    );
    await assert.rejects(
      () => inviteHostedLearner({
        client,
        emailEnvName: 'HOSTED_INVITE_EMAIL',
        environment: {
          HOSTED_INVITE_EMAIL: 'private-alias@example.test',
          CLERK_AUTHORIZED_PARTY: 'https://study-example.fly.dev',
        },
      }),
      (error: unknown) => error instanceof HostedClerkInviteError && error.safeCode === 'CLERK_INVITE_FAILED',
    );
  });
});
