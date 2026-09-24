import { Router, type Request, type Response } from 'express';
import type { AppConfig } from '../config.ts';
import { IntroductionLabError, type IntroductionLabService } from './service.ts';

export function introductionLabEnabled(
  config: Pick<AppConfig, 'mode' | 'authMode' | 'studyProfile'>,
  flag: string | undefined,
): boolean {
  return flag === '1' && config.mode === 'dev'
    && config.authMode === 'trusted_local' && config.studyProfile === 'mandarin';
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:'
      && parsed.username === '' && parsed.password === ''
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
  } catch { return false; }
}

function isAllowedHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  try {
    const parsed = new URL(`http://${host}`);
    return parsed.username === '' && parsed.password === ''
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
  } catch { return false; }
}

function respondError(error: unknown, response: Response): void {
  if (error instanceof IntroductionLabError) {
    response.status(error.status).json({ error: error.message });
  } else {
    response.status(500).json({ error: 'Introduction lab request failed.' });
  }
}

function route(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response) => void {
  return (request, response) => { void handler(request, response).catch((error) => respondError(error, response)); };
}

export function createIntroductionLabRouter(service: IntroductionLabService): Router {
  const router = Router();
  router.use((request, response, next) => {
    if (!isLoopback(request.socket.remoteAddress) || !isAllowedHost(request.get('host'))
      || !isAllowedOrigin(request.get('origin'))
      || request.get('sec-fetch-site') === 'cross-site') {
      response.status(403).json({ error: 'Introduction lab is local only.' });
      return;
    }
    next();
  });
  router.get('/status', (_request, response) => response.json(service.status()));
  router.get('/drafts', route(async (_request, response) => {
    response.json(await service.listDrafts());
  }));
  router.post('/bootstrap', route(async (request, response) => {
    response.status(201).json(await service.bootstrap(request.body));
  }));
  router.post('/drafts/:id/teaching', route(async (request, response) => {
    response.status(201).json(await service.generateTeaching(request.params.id));
  }));
  router.post('/import', route(async (request, response) => {
    response.status(201).json(await service.importDraft(request.body));
  }));
  return router;
}
