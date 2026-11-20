import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import { getUsagePulse, getActiveServiceBanner, toPublicServiceBanner, setServiceBanner, clearServiceBanner } from '../db.ts';
import { listModelInvocations, ModelInvocationInputError } from '../db/model-invocations.ts';
import { listWordPreparationFailures } from '../db/preparation-work.ts';
import { getTeachingSetReport } from '../db/teaching-set-report.ts';
import { retryPreparationWithReadiness } from '../word-content/retry-preparation.ts';
import type { CreateAppOptions } from '../index.ts';
import type { Express } from 'express';

/** Operator usage pulse, model invocations, word-preparation failures and retry, teaching sets, and the service banner. */
export function registerOperatorRoutes(app: Express, { options }: { options: Pick<CreateAppOptions, 'wakeWordPreparation'> }): void {
  app.get(
    '/api/operator/usage-pulse',
    createOperatorAllowlistMiddleware(),
    (_req, res) => {
      try {
        res.json(getUsagePulse());
      } catch (error) {
        console.error('Failed to load operator usage pulse', error);
        res.status(500).json({ error: 'Failed to load operator usage pulse' });
      }
    },
  );
  app.get('/api/operator/model-invocations', createOperatorAllowlistMiddleware(), (req, res) => {
    try {
      res.json(listModelInvocations({ from: req.query.from, to: req.query.to }));
    } catch (error) {
      if (error instanceof ModelInvocationInputError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error('Failed to load model invocations', error);
      res.status(500).json({ error: 'Failed to load model invocations' });
    }
  });
  app.get('/api/operator/word-preparation/failures', createOperatorAllowlistMiddleware(), (_req, res) => {
    res.json({ failures: listWordPreparationFailures() });
  });
  app.get('/api/operator/teaching-sets', createOperatorAllowlistMiddleware(), (_req,res) => {
    try { res.json(getTeachingSetReport()); }
    catch (error) {
      console.error('Teaching set report failed',error);
      res.status(500).json({error:'Could not load teaching set costs.'});
    }
  });
  app.get('/api/operator/service-banner', createOperatorAllowlistMiddleware(), (_req, res) => {
    const banner = getActiveServiceBanner();
    res.json({ serviceBanner: banner ? toPublicServiceBanner(banner) : null });
  });
  app.put('/api/operator/service-banner', createOperatorAllowlistMiddleware(), (req, res) => {
    const { message, expiresAt, kickoffAt } = req.body ?? {};
    const planned = typeof kickoffAt === 'string' && message === undefined && expiresAt === undefined;
    const custom = kickoffAt === undefined && typeof message === 'string'
      && (expiresAt === undefined || typeof expiresAt === 'string');
    if (!planned && !custom) {
      res.status(400).json({ error: 'Expected either an ISO kickoff timestamp, or a message with optional ISO expiry timestamp.' });
      return;
    }
    try {
      const request = planned ? { kickoffAt } : { message, expiresAt };
      const banner = setServiceBanner({ ...request, actorId: res.locals.operatorSubject });
      res.json({ serviceBanner: toPublicServiceBanner(banner) });
    } catch (error) {
      if (error instanceof Error && /service banner message|service banner expiry|service banner kickoff|expires at/i.test(error.message)) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error('Failed to update operator service banner', error);
      res.status(500).json({ error: 'Failed to update service banner' });
    }
  });
  app.delete('/api/operator/service-banner', createOperatorAllowlistMiddleware(), (_req, res) => {
    res.json(clearServiceBanner({ actorId: res.locals.operatorSubject }));
  });
  app.post('/api/operator/word-preparation/:workId/retry', createOperatorAllowlistMiddleware(), (req, res) => {
    if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).length !== 0
      || !req.params.workId || req.params.workId.length > 200) {
      res.status(400).json({ error: 'Expected an empty retry request.' });
      return;
    }
    try {
      retryPreparationWithReadiness(req.params.workId, res.locals.operatorSubject);
      options.wakeWordPreparation?.();
      res.json({ queued: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'Only paused preparation can be retried') {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Could not retry word preparation.' });
    }
  });
}
