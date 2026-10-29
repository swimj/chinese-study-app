import type { Express, Request, Response } from 'express';
import { createOperatorAllowlistMiddleware } from './operator-access.ts';
import { ImprovementInputError, ImprovementConflictError, ImprovementAccessError } from '../src/domain/content-improvement.ts';
import { listImprovementCases, createImprovementCase, getImprovementCase, saveImprovementCase,
  validateImprovementCase, applyImprovementCase, closeImprovementCase, getImprovementHistory } from './db/content-improvements.ts';

export function registerContentImprovementRoutes(app: Express): void {
  const root = '/api/operator/content-improvements';
  const gate = createOperatorAllowlistMiddleware();
  const handle = (operation: (req: Request, actor: string) => unknown) => (req: Request, res: Response) => {
    try { res.json(operation(req,res.locals.operatorSubject as string)); }
    catch (error) {
      const status = error instanceof ImprovementInputError ? 400 : error instanceof ImprovementConflictError ? 409 : error instanceof ImprovementAccessError ? 403 : 500;
      if (status === 500) console.error('Content improvement operation failed',error);
      res.status(status).json({error:status === 500 ? 'Content improvement operation failed.' : (error as Error).message});
    }
  };
  app.get(root,gate,handle((req,actor) => listImprovementCases(req.query,actor)));
  app.post(root,gate,handle((req,actor) => createImprovementCase(req.body,actor)));
  app.get(`${root}/:id`,gate,handle((req,actor) => getImprovementCase(req.params.id,actor)));
  app.put(`${root}/:id`,gate,handle((req,actor) => saveImprovementCase(req.params.id,req.body,actor)));
  app.get(`${root}/:id/history`,gate,handle((req,actor) => getImprovementHistory(req.params.id,actor)));
  app.post(`${root}/:id/validate`,gate,handle((req,actor) => validateImprovementCase(req.params.id,req.body,actor)));
  app.post(`${root}/:id/apply`,gate,handle((req,actor) => applyImprovementCase(req.params.id,req.body,actor)));
  app.post(`${root}/:id/close`,gate,handle((req,actor) => closeImprovementCase(req.params.id,req.body,actor)));
}
