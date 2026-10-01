import { Router, type Request, type Response } from 'express';
import { HostedProviderWorkUnavailableError } from '../hosted-runtime-controls.ts';
import { WordIntroductionError } from '../db/word-introductions.ts';
import { WordIntroductionServiceError, type WordIntroductionService } from './service.ts';

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function createWordIntroductionRouter(service: WordIntroductionService): Router {
  const router = Router();
  const handle = (operation: (request: Request, response: Response) => void | Promise<void>) => (
    request: Request, response: Response,
  ) => {
    void Promise.resolve().then(() => operation(request, response)).catch((error: unknown) => {
      if (error instanceof HostedProviderWorkUnavailableError) {
        response.status(503).json({ error: error.message, code: error.code });
      } else if (error instanceof WordIntroductionServiceError) {
        response.status(error.status).json({ error: error.message });
      } else if (error instanceof WordIntroductionError) {
        response.status(error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400)
          .json({ error: 'That introduction is unavailable or no longer matches this word. Please reopen it.' });
      } else {
        response.status(500).json({ error: 'The introduction could not be loaded. Please try again.' });
      }
    });
  };
  router.get('/:wordId/introduction', handle((request, response) => {
    response.json(service.get(request.params.wordId));
  }));
  router.post('/:wordId/introduction/prepare', handle(async (request, response) => {
    const body = bodyRecord(request.body ?? {});
    if (body === null || Object.keys(body).length > 0) {
      response.status(400).json({ error: 'Preparation uses the stored word; no lexical or learner overrides are accepted.' });
      return;
    }
    response.json(await service.prepare(request.params.wordId));
  }));
  router.post('/:wordId/introduction/complete', handle((request, response) => {
    const body = bodyRecord(request.body);
    if (body === null || Object.keys(body).length !== 1 || typeof body.packageId !== 'string'
      || body.packageId.length === 0 || body.packageId.length > 200) {
      response.status(400).json({ error: 'An exact introduction package ID is required.' });
      return;
    }
    response.json(service.complete(request.params.wordId, body.packageId));
  }));
  return router;
}
