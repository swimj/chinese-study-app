import { isRecord, sanitizeHostedOutput } from './hosted-json.ts';

export const HOSTED_SMOKE_SESSION_TTL_SECONDS = 60;
export const HOSTED_SMOKE_ENDPOINT = '/api/vocabulary/statistics';

export type ClerkSmokeDirectory = {
  getUserIdByEmail(email: string): Promise<string>;
  createSession(userId: string): Promise<{ id: string }>;
  getToken(sessionId: string, expiresInSeconds: number): Promise<string>;
  revokeSession(sessionId: string): Promise<void>;
};

export type HostedSmokeResult = {
  status: 'ok' | 'failed';
  endpoint: typeof HOSTED_SMOKE_ENDPOINT;
  httpStatus: number | null;
  sessionRevoked: boolean;
  clerkUserResolved: boolean;
  learnerMapped: boolean;
  failure: string | null;
};

export type HostedSmokeLearnerLookup = {
  resolveClerkLearnerId(clerkUserId: string): string | null;
  assertLearnerUsable(learnerId: string): void;
};

type ClerkSmokeClient = {
  users: {
    getUserList(params: { emailAddress: string[]; limit: number }): Promise<{
      data: Array<{ id: string; banned?: boolean }>;
    }>;
  };
  sessions: {
    createSession(params: { userId: string }): Promise<{ id: string }>;
    getToken(sessionId: string, template?: string, expiresInSeconds?: number): Promise<{ jwt: string }>;
    revokeSession(sessionId: string): Promise<unknown>;
  };
};

export function createClerkSmokeDirectoryFromClient(client: ClerkSmokeClient): ClerkSmokeDirectory {
  return {
    async getUserIdByEmail(email) {
      const result = await client.users.getUserList({ emailAddress: [email], limit: 2 });
      if (result.data.length !== 1 || !result.data[0]?.id) {
        throw new Error('Expected exactly one Clerk user for the configured smoke identity.');
      }
      if (result.data[0].banned) {
        throw new Error('Configured smoke Clerk user is banned.');
      }
      return result.data[0].id;
    },
    async createSession(userId) {
      const session = await client.sessions.createSession({ userId });
      if (!session.id) throw new Error('Clerk did not return a smoke session id.');
      return { id: session.id };
    },
    async getToken(sessionId, expiresInSeconds) {
      const token = await client.sessions.getToken(sessionId, undefined, expiresInSeconds);
      if (!token?.jwt) throw new Error('Clerk did not return a smoke session token.');
      return token.jwt;
    },
    async revokeSession(sessionId) {
      await client.sessions.revokeSession(sessionId);
    },
  };
}

export async function runHostedSmoke(options: {
  clerkUserId?: string;
  clerkEmail?: string;
  apiBase: string;
  clerk: ClerkSmokeDirectory;
  learners: HostedSmokeLearnerLookup;
  fetchImpl?: typeof fetch;
}): Promise<HostedSmokeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let sessionId: string | undefined;
  let sessionRevoked = false;
  let clerkUserResolved = false;
  let learnerMapped = false;
  let httpStatus: number | null = null;
  let result: HostedSmokeResult | undefined;

  try {
    const clerkUserId = await resolveSmokeClerkUserId(options);
    clerkUserResolved = true;
    const learnerId = options.learners.resolveClerkLearnerId(clerkUserId);
    if (!learnerId) {
      result = failedSmoke({
        httpStatus,
        sessionRevoked,
        clerkUserResolved,
        learnerMapped,
        failure: 'Smoke Clerk user is not mapped to a learner; refusing to bootstrap one during maintenance.',
      });
      return result;
    }
    options.learners.assertLearnerUsable(learnerId);
    learnerMapped = true;

    const session = await options.clerk.createSession(clerkUserId);
    sessionId = session.id;
    const token = await options.clerk.getToken(session.id, HOSTED_SMOKE_SESSION_TTL_SECONDS);
    if (typeof token !== 'string' || token.trim() === '') {
      throw new Error('Clerk did not return a smoke session token.');
    }

    // Read current learner state without reserving words, creating a study session, or queuing generation.
    const url = `${trimTrailingSlash(options.apiBase)}${HOSTED_SMOKE_ENDPOINT}`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    httpStatus = response.status;
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      result = failedSmoke({
        httpStatus,
        sessionRevoked,
        clerkUserResolved,
        learnerMapped,
        failure: `Authenticated smoke GET failed with HTTP ${response.status}.`,
      });
      return result;
    }
    assertVocabularyStatisticsShape(body);
    result = {
      status: 'ok',
      endpoint: HOSTED_SMOKE_ENDPOINT,
      httpStatus,
      sessionRevoked,
      clerkUserResolved,
      learnerMapped,
      failure: null,
    };
    return result;
  } catch (error) {
    result = failedSmoke({
      httpStatus,
      sessionRevoked,
      clerkUserResolved,
      learnerMapped,
      failure: smokeFailureMessage(error),
    });
    return result;
  } finally {
    if (sessionId) {
      try {
        await options.clerk.revokeSession(sessionId);
        sessionRevoked = true;
      } catch {
        sessionRevoked = false;
      }
    }
    if (result) {
      result.sessionRevoked = sessionRevoked;
      if (result.status === 'ok' && sessionId && !sessionRevoked) {
        result.status = 'failed';
        result.failure = 'Smoke session could not be revoked.';
      }
    }
  }
}

export function resolveSmokeClerkUserIdSync(clerkUserId: string | undefined): string | null {
  const normalized = clerkUserId?.trim() ?? '';
  if (!normalized) return null;
  if (!/^user_[A-Za-z0-9_]+$/.test(normalized)) {
    throw new Error('Smoke Clerk user id must be a Clerk user_ identifier.');
  }
  return normalized;
}

async function resolveSmokeClerkUserId(options: {
  clerkUserId?: string;
  clerkEmail?: string;
  clerk: ClerkSmokeDirectory;
}): Promise<string> {
  const clerkUserId = resolveSmokeClerkUserIdSync(options.clerkUserId);
  if (clerkUserId) return clerkUserId;
  const email = options.clerkEmail?.trim() ?? '';
  if (!email) {
    throw new Error('Smoke requires APP_SMOKE_CLERK_USER_ID or APP_SMOKE_CLERK_EMAIL.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Smoke Clerk email is not a valid email address.');
  }
  const resolved = await options.clerk.getUserIdByEmail(email);
  if (!/^user_[A-Za-z0-9_]+$/.test(resolved)) {
    throw new Error('Clerk smoke user lookup did not return a user_ identifier.');
  }
  return resolved;
}

function failedSmoke(input: {
  httpStatus: number | null;
  sessionRevoked: boolean;
  clerkUserResolved: boolean;
  learnerMapped: boolean;
  failure: string;
}): HostedSmokeResult {
  return {
    status: 'failed',
    endpoint: HOSTED_SMOKE_ENDPOINT,
    httpStatus: input.httpStatus,
    sessionRevoked: input.sessionRevoked,
    clerkUserResolved: input.clerkUserResolved,
    learnerMapped: input.learnerMapped,
    failure: input.failure,
  };
}

function smokeFailureMessage(error: unknown): string {
  if (isRecord(error) && error.name === 'DisabledLearnerError') {
    return 'Smoke Clerk user maps to a disabled learner.';
  }
  return sanitizeHostedOutput(error instanceof Error ? error.message : 'Hosted smoke failed.');
}

function assertVocabularyStatisticsShape(value: unknown): void {
  const count = (n: unknown): boolean => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const modes = isRecord(value) && isRecord(value.modes) ? value.modes : null;
  if (!isRecord(value) || modes === null || !['unstudied','solidify','practice','maintain'].every(mode => count(modes[mode]))
    || !Array.isArray(value.days) || value.days.length !== 14 || !value.days.every(day => isRecord(day)
      && typeof day.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.dayKey)
      && ['sessions','coveredWords','unknownCoverageSessions','acceptedResponses','rejectedResponses','activeDurationMs','unknownDurationSessions'].every(key => count(day[key])))) {
    throw new Error('Smoke vocabulary statistics was not a valid learner statistics response.');
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
