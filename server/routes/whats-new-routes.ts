import { listWhatsNewPosts, saveWhatsNewPost, WhatsNewConflictError } from '../db/whats-new.ts';
import { getWhatsNewAttention, updateWhatsNewAttention } from '../db/whats-new-attention.ts';
import { WhatsNewInputError, parseWhatsNewWriteRequest } from '../../src/domain/whats-new.ts';
import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import { updateWhatsNewSeenThroughSequence } from '../db/attention.ts';
import { ensureWhatsNewSeenThroughDate, markWhatsNewSeenThroughDate } from '../db.ts';
import { isAttentionClientError, isPlainObject } from './request-helpers.ts';
import type { Express } from 'express';

/** What's New posts, operator editing, badge attention, and seen cursors. */
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
  app.post('/api/whats-new-seen-sequence', (req, res) => {
    try {
      res.json({ whatsNewSeenThroughSequence: updateWhatsNewSeenThroughSequence(req.body?.throughSequence, req.body?.mode) });
    } catch (error) {
      if (error instanceof WhatsNewInputError) { res.status(400).json({ error: error.message }); return; }
      res.status(500).json({ error: 'Failed to update blog seen sequence' });
    }
  });
  app.post('/api/whats-new-seen', (req, res) => {
    const request = readWhatsNewSeenRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid whats-new seen request' });
      return;
    }
    try {
      const whatsNewSeenThroughDate = request.mode === 'ensure'
        ? ensureWhatsNewSeenThroughDate(request.throughDate)
        : markWhatsNewSeenThroughDate(request.throughDate);
      res.json({ whatsNewSeenThroughDate });
    } catch (error) {
      if (isAttentionClientError(error)) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
        return;
      }
      res.status(500).json({ error: 'Failed to update whats-new seen date' });
    }
  });
}

function readWhatsNewSeenRequest(
  value: unknown,
): { throughDate: string; mode: 'ensure' | 'seen' } | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2
    || keys[0] !== 'mode'
    || keys[1] !== 'throughDate'
    || (value.mode !== 'ensure' && value.mode !== 'seen')
    || typeof value.throughDate !== 'string'
  ) {
    return null;
  }
  return { throughDate: value.throughDate, mode: value.mode };
}
