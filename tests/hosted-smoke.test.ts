import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readHostedReleaseIdentity } from '../server/hosted-release-identity.ts';
import { sanitizeHostedOutput } from '../scripts/lib/hosted-json.ts';
import {
  createClerkSmokeDirectoryFromClient,
  runHostedSmoke,
  type ClerkSmokeDirectory,
} from '../scripts/lib/hosted-smoke.ts';

describe('hosted release identity', () => {
  test('reports the baked Git SHA and Fly coordinates', () => {
    assert.deepEqual(readHostedReleaseIdentity({
      npm_package_version: '2.3.0',
      APP_REVISION: '0123456789abcdef0123456789abcdef01234567',
      FLY_APP_NAME: 'chinese-study-beta-swimj',
      FLY_IMAGE_REF: 'registry.fly.io/chinese-study-beta-swimj:deployment-1',
      FLY_MACHINE_ID: 'd8d123',
      FLY_MACHINE_VERSION: '01HXYZ',
      FLY_REGION: 'sin',
    }), {
      appVersion: '2.3.0',
      sourceRevision: '0123456789abcdef0123456789abcdef01234567',
      flyAppName: 'chinese-study-beta-swimj',
      flyImageRef: 'registry.fly.io/chinese-study-beta-swimj:deployment-1',
      flyMachineId: 'd8d123',
      flyMachineVersion: '01HXYZ',
      flyRegion: 'sin',
    });
  });

  test('keeps a missing APP_REVISION as unknown and rejects a non-SHA value', () => {
    assert.equal(readHostedReleaseIdentity({
      npm_package_version: '2.3.0',
    }).sourceRevision, 'unknown');
    assert.equal(readHostedReleaseIdentity({
      npm_package_version: '2.3.0',
      APP_REVISION: 'unknown',
    }).sourceRevision, 'unknown');
    assert.throws(() => readHostedReleaseIdentity({
      npm_package_version: '2.3.0',
      APP_REVISION: 'main',
    }), /full 40-character Git SHA/);
  });
});

describe('hosted smoke', () => {
  test('refuses an unmapped Clerk user before minting a session', async () => {
    const clerk = trackingClerk();
    const result = await runHostedSmoke({
      clerkUserId: 'user_smoke',
      apiBase: 'http://127.0.0.1:5174',
      clerk,
      learners: {
        resolveClerkLearnerId: () => null,
        assertLearnerUsable: () => {
          throw new Error('must not run');
        },
      },
      fetchImpl: async () => {
        throw new Error('must not fetch');
      },
    });
    assert.equal(result.status, 'failed');
    assert.match(result.failure ?? '', /not mapped to a learner/);
    assert.equal(result.learnerMapped, false);
    assert.equal(clerk.created, 0);
    assert.equal(clerk.tokens, 0);
  });

  test('resolves the smoke user by email, reads session-payload, and revokes the token', async () => {
    const clerk = trackingClerk({ userId: 'user_from_email' });
    const fetched: string[] = [];
    const result = await runHostedSmoke({
      clerkEmail: 'x6nscl63n@mozmail.com',
      apiBase: 'http://127.0.0.1:5174',
      studyDayKey: '2026-09-04',
      clerk,
      learners: {
        resolveClerkLearnerId: (userId) => userId === 'user_from_email' ? 'learner_smoke' : null,
        assertLearnerUsable: () => undefined,
      },
      fetchImpl: async (input, init) => {
        fetched.push(String(input));
        const authorization = new Headers(init?.headers).get('authorization');
        assert.equal(authorization, 'Bearer smoke-token');
        assert.equal(authorization?.includes('smoke-token') === true, true);
        return jsonResponse(200, {
          buckets: { review: [], learning: [], unstudied: [] },
        });
      },
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.sessionRevoked, true);
    assert.equal(result.httpStatus, 200);
    assert.equal(clerk.revoked, 1);
    assert.equal(fetched[0], 'http://127.0.0.1:5174/api/session-payload?studyDayKey=2026-09-04');
    assert.equal(JSON.stringify(result).includes('smoke-token'), false);
    assert.equal(JSON.stringify(result).includes('x6nscl63n@mozmail.com'), false);
    assert.equal(JSON.stringify(result).includes('user_from_email'), false);
  });

  test('fails the upgrade smoke on an unexpected payload and still revokes the session', async () => {
    const clerk = trackingClerk();
    const result = await runHostedSmoke({
      clerkUserId: 'user_smoke',
      apiBase: 'http://127.0.0.1:5174',
      clerk,
      learners: {
        resolveClerkLearnerId: () => 'learner_smoke',
        assertLearnerUsable: () => undefined,
      },
      fetchImpl: async () => jsonResponse(200, { unexpected: true }),
    });
    assert.equal(result.status, 'failed');
    assert.match(result.failure ?? '', /not a valid bucketed session response/);
    assert.equal(clerk.revoked, 1);
    assert.equal(JSON.stringify(result).includes('smoke-token'), false);
  });

  test('does not print bearer tokens when Clerk or HTTP errors include them', () => {
    assert.equal(
      sanitizeHostedOutput('Authorization: Bearer super-secret-token-value'),
      'Authorization: Bearer [redacted]',
    );
  });

  test('Clerk directory looks up one user by email and mints a short-lived token', async () => {
    const calls: string[] = [];
    const directory = createClerkSmokeDirectoryFromClient({
      users: {
        async getUserList(params) {
          calls.push(`list:${params.emailAddress.join(',')}`);
          return { data: [{ id: 'user_looked_up', banned: false }] };
        },
      },
      sessions: {
        async createSession(params) {
          calls.push(`session:${params.userId}`);
          return { id: 'sess_1' };
        },
        async getToken(sessionId, _template, expiresInSeconds) {
          calls.push(`token:${sessionId}:${expiresInSeconds}`);
          return { jwt: 'minted-jwt' };
        },
        async revokeSession(sessionId) {
          calls.push(`revoke:${sessionId}`);
        },
      },
    });
    assert.equal(await directory.getUserIdByEmail('x6nscl63n@mozmail.com'), 'user_looked_up');
    assert.deepEqual(await directory.createSession('user_looked_up'), { id: 'sess_1' });
    assert.equal(await directory.getToken('sess_1', 60), 'minted-jwt');
    await directory.revokeSession('sess_1');
    assert.deepEqual(calls, [
      'list:x6nscl63n@mozmail.com',
      'session:user_looked_up',
      'token:sess_1:60',
      'revoke:sess_1',
    ]);
  });
});

function trackingClerk(options: { userId?: string } = {}): ClerkSmokeDirectory & {
  created: number;
  tokens: number;
  revoked: number;
} {
  const state = { created: 0, tokens: 0, revoked: 0 };
  return {
    get created() { return state.created; },
    get tokens() { return state.tokens; },
    get revoked() { return state.revoked; },
    async getUserIdByEmail() {
      return options.userId ?? 'user_smoke';
    },
    async createSession() {
      state.created += 1;
      return { id: 'sess_smoke' };
    },
    async getToken() {
      state.tokens += 1;
      return 'smoke-token';
    },
    async revokeSession() {
      state.revoked += 1;
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
