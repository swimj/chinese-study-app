import { clerkMiddleware, getAuth } from '@clerk/express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  CLERK_AUTH_PROVIDER,
  DisabledLearnerError,
  resolveOrBootstrapExternalLearner,
  runWithLearnerId,
} from './db.ts';

export type ProviderSubjectResolver = (request: Request) => string | null;

export function createClerkRequestAuthentication(
  resolveProviderSubject: ProviderSubjectResolver = resolveClerkProviderSubject,
): RequestHandler[] {
  if (resolveProviderSubject === resolveClerkProviderSubject) {
    const publishableKey = requireEnvironmentVariable('CLERK_PUBLISHABLE_KEY');
    requireEnvironmentVariable('CLERK_SECRET_KEY');
    const authorizedParty = parseAuthorizedParty(requireEnvironmentVariable('CLERK_AUTHORIZED_PARTY'));
    return [
      // Do not pass authorizedParties to clerkMiddleware. Backend-minted session
      // JWTs (hosted:smoke) have no azp, and Clerk rejects a missing azp when
      // that option is set. Origin checking for tokens that do include azp is
      // in clerkUserIdFromAuth.
      clerkMiddleware({ publishableKey }),
      createLearnerContextMiddleware((request) => clerkUserIdFromAuth(getAuth(request), authorizedParty)),
    ];
  }

  return [createLearnerContextMiddleware(resolveProviderSubject)];
}

export function clerkUserIdFromAuth(
  auth: { userId?: string | null; sessionClaims?: { azp?: unknown } | null },
  authorizedParty: string,
): string | null {
  const userId = auth.userId?.trim() ?? '';
  if (!userId) return null;
  const azp = auth.sessionClaims?.azp;
  if (azp == null || azp === '') return userId;
  if (typeof azp !== 'string' || azp !== authorizedParty) return null;
  return userId;
}

export function createLearnerContextMiddleware(
  resolveProviderSubject: ProviderSubjectResolver,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const providerSubject = resolveProviderSubject(request);
    if (!providerSubject) {
      response.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
      return;
    }

    try {
      const learnerId = resolveOrBootstrapExternalLearner({
        provider: CLERK_AUTH_PROVIDER,
        providerSubject,
      });
      runWithLearnerId(learnerId, next);
    } catch (error) {
      if (error instanceof DisabledLearnerError) {
        response.status(403).json({ error: error.message, code: 'ACCOUNT_DISABLED' });
        return;
      }
      next(error);
    }
  };
}

function resolveClerkProviderSubject(request: Request): string | null {
  return getAuth(request).userId;
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseAuthorizedParty(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CLERK_AUTHORIZED_PARTY must be an absolute HTTP(S) origin.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== value) {
    throw new Error('CLERK_AUTHORIZED_PARTY must be one exact HTTP(S) origin.');
  }
  return url.origin;
}
