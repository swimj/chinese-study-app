import { listWhatsNewPosts, saveWhatsNewPost, WhatsNewConflictError } from '../db/whats-new.ts';
import { getWhatsNewAttention, updateWhatsNewAttention } from '../db/whats-new-attention.ts';
import { WhatsNewInputError, parseWhatsNewWriteRequest } from '../../src/domain/whats-new.ts';
import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import type { Express } from 'express';

/** What's New posts, operator editing, and per-post attention. */
export function registerWhatsNewRoutes(app: Express): void {
  app.get('/api/whats-new', (_req, res) => {
    res.json({ posts: listWhatsNewPosts() });
  });
  app.get('/api/whats-new-attention', (_req, res) => {
    res.json(getWhatsNewAttention());
  });
  app.post('/api/whats-new-attention', (req, res) => {
    try {
      res.json(updateWhatsNewAttention(req.body));
    } catch (error) {
      if (error instanceof WhatsNewInputError) { res.status(400).json({ error: error.message }); return; }
      console.error('Failed to update blog attention', error);
      res.status(500).json({ error: 'Failed to update blog attention' });
    }
  });
  app.get('/api/operator/whats-new', createOperatorAllowlistMiddleware(), (_req, res) => {
    res.json({ posts: listWhatsNewPosts({ includeDrafts: true }) });
  });
  app.put('/api/operator/whats-new', createOperatorAllowlistMiddleware(), (req, res) => {
    try {
      res.json(saveWhatsNewPost(parseWhatsNewWriteRequest(req.body), res.locals.operatorSubject as string));
    } catch (error) {
      if (error instanceof WhatsNewInputError) { res.status(400).json({ error: error.message }); return; }
      if (error instanceof WhatsNewConflictError) { res.status(409).json({ error: error.message }); return; }
      console.error('Failed to save blog post', error);
      res.status(500).json({ error: 'Failed to save blog post' });
    }
  });
}
