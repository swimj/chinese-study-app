import type { Request, RequestHandler } from 'express';
import { config } from './db/connection.ts';
import { getHostedServiceControls } from './db/hosted-operations.ts';
import { isOperatorSubject, parseOperatorAllowlist, resolveOperatorSubject } from './operator-access.ts';

/** Runs after session verification, before learner resolution or any application work. */
export function createServiceAccessMiddleware(
  resolveVerifiedClerkSubject: (request: Request) => string | null,
): RequestHandler {
  return (request, response, next) => {
    const subject = resolveOperatorSubject({
      authMode: config.authMode,
      trustedLocalLearnerId: config.learnerId,
      clerkUserId: resolveVerifiedClerkSubject(request),
    });
    const allowed = !getHostedServiceControls().operatorOnly
      || isOperatorSubject(subject, parseOperatorAllowlist(), config.authMode);
    response.setHeader('Cache-Control', 'no-store');
    if (request.path === '/service-access' && ['GET', 'HEAD'].includes(request.method)) {
      response.json({ allowed });
      return;
    }
    if (!allowed) {
      response.status(503).json({
        code: 'OPERATOR_ONLY',
        error: 'The service is temporarily unavailable.',
      });
      return;
    }
    next();
  };
}
