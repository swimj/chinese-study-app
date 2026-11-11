import { setDebriefInterests, getLatestSessionDebrief, getSessionDebrief, retrySessionDebrief, SessionDebriefNotFoundError, SessionDebriefRetryConflictError } from '../db/session-debrief.ts';
import { SessionDebriefInputError } from '../../src/domain/session-debrief.ts';
import type { CreateAppOptions } from '../index.ts';
import type { Express } from 'express';

/** Session debrief interests, results, and retry. */
export function registerSessionDebriefRoutes(app: Express, { options }: { options: Pick<CreateAppOptions, 'wakeSessionDebriefs'> }): void {
  app.patch('/api/learner-settings/debrief-interests', (req, res) => {
    try { res.json(setDebriefInterests(req.body?.debriefInterests)); }
    catch (error) {
      res.status(error instanceof SessionDebriefInputError ? 400 : 500).json({ error: error instanceof SessionDebriefInputError ? error.message : 'Failed to update interests' });
    }
  });
  app.get('/api/session-debriefs/latest', (_req, res) => {
    res.json({ debrief: getLatestSessionDebrief() });
  });
  app.get('/api/session-debriefs/:sessionId', (req, res) => {
    const debrief = getSessionDebrief(req.params.sessionId);
    if (!debrief) { res.status(404).json({ error: 'Session debrief not found' }); return; }
    res.json({ debrief });
  });
  app.post('/api/session-debriefs/:sessionId/retry', (req, res) => {
    try {
      const debrief = retrySessionDebrief(req.params.sessionId);
      if (debrief.status === 'queued') {
        try { options.wakeSessionDebriefs?.(); } catch { /* A durable retry survives a missed wake. */ }
      }
      res.json({ debrief });
    } catch (error) {
      res.status(error instanceof SessionDebriefNotFoundError ? 404 : error instanceof SessionDebriefRetryConflictError ? 409 : 500)
        .json({ error: error instanceof SessionDebriefNotFoundError || error instanceof SessionDebriefRetryConflictError ? error.message : 'Failed to retry session debrief' });
    }
  });
}
