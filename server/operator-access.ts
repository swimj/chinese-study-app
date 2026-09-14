import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getAuth } from '@clerk/express';
import { config as dbConfig } from './db/connection.ts';

export const OPERATOR_ALLOWLIST_ENV = 'APP_OPERATOR_CLERK_USER_IDS';
export const TRUSTED_LOCAL_OPERATOR_SENTINEL = 'trusted_local';

export function parseOperatorAllowlist(
  rawValue: string | undefined = process.env[OPERATOR_ALLOWLIST_ENV],
): Set<string> {
  if (!rawValue) return new Set();
  return new Set(
    rawValue
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

export function resolveOperatorSubject(input: {
  authMode: 'trusted_local' | 'clerk';
  trustedLocalLearnerId: string;
  clerkUserId: string | null;
}): string | null {
  if (input.authMode === 'trusted_local') {
    return input.trustedLocalLearnerId.trim() || null;
  }
  const clerkUserId = input.clerkUserId?.trim() ?? '';
  return clerkUserId.length > 0 ? clerkUserId : null;
}

export function isOperatorSubject(
  subject: string | null,
  allowlist: ReadonlySet<string>,
  authMode: 'trusted_local' | 'clerk',
): boolean {
  if (!subject) return false;
  if (allowlist.has(subject)) return true;
  return authMode === 'trusted_local' && allowlist.has(TRUSTED_LOCAL_OPERATOR_SENTINEL);
}

export function createOperatorAllowlistMiddleware(options?: {
  readAllowlist?: () => Set<string>;
  resolveClerkUserId?: (request: Request) => string | null;
}): RequestHandler {
  const readAllowlist = options?.readAllowlist ?? (() => parseOperatorAllowlist());
  const resolveClerkUserId = options?.resolveClerkUserId ?? defaultResolveClerkUserId;

  return (request: Request, response: Response, next: NextFunction) => {
    const allowlist = readAllowlist();
    const subject = resolveOperatorSubject({
      authMode: dbConfig.authMode,
      trustedLocalLearnerId: dbConfig.learnerId,
      clerkUserId: resolveClerkUserId(request),
    });
    if (!isOperatorSubject(subject, allowlist, dbConfig.authMode)) {
      response.status(403).json({
        error: 'Operator access required.',
        code: 'OPERATOR_FORBIDDEN',
      });
      return;
    }
    next();
  };
}

function defaultResolveClerkUserId(request: Request): string | null {
  if (dbConfig.authMode !== 'clerk') return null;
  // Clerk session authenticity and azp checks already ran in auth middleware.
  return getAuth(request).userId?.trim() || null;
}
