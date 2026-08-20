import { clerkMiddleware, getAuth } from '@clerk/express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  ACCOUNT_DISABLED_CODE,
  MAINTENANCE_MODE_CODE,
  MaintenanceModeError,
  type SpikeAccount,
  type SpikeDatabase,
} from './database.ts';
import { observeAuthFailure } from './metrics.ts';

export type AuthenticatedSpikeRequest = Request & { spikeAccount?: SpikeAccount };
export type ProviderSubjectResolver = (request: Request) => string | null;

export function createClerkMiddleware(publishableKey: string, authorizedParty: string): RequestHandler {
  return clerkMiddleware({ publishableKey, authorizedParties: [authorizedParty] });
}

export function createSpikeAccountMiddleware(
  database: SpikeDatabase,
  resolveProviderSubject: ProviderSubjectResolver = resolveClerkProviderSubject,
): RequestHandler {
  return (request: AuthenticatedSpikeRequest, response: Response, next: NextFunction) => {
    const providerSubject = resolveProviderSubject(request);
    if (!providerSubject) {
      observeAuthFailure(database.metrics);
      response.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
      return;
    }

    try {
      const existingAccount = database.getAccount(providerSubject);
      const account = existingAccount ?? database.ensureAccount(providerSubject);
      if (!account.enabled) {
        response.status(403).json({ error: 'Account disabled.', code: ACCOUNT_DISABLED_CODE });
        return;
      }
      request.spikeAccount = account;
      next();
    } catch (error) {
      if (error instanceof MaintenanceModeError) {
        response.status(503).json({ error: error.message, code: MAINTENANCE_MODE_CODE });
        return;
      }
      next(error);
    }
  };
}

export function requireSpikeAccount(request: AuthenticatedSpikeRequest): SpikeAccount {
  if (!request.spikeAccount) throw new Error('Authenticated spike account missing from request context.');
  return request.spikeAccount;
}

function resolveClerkProviderSubject(request: Request): string | null {
  return getAuth(request).userId;
}
