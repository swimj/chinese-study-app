import { getContentQualityRatingLedger } from '../db/content-quality.ts';
import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import { getContentReactionSummary, listContentReactions, setContentReaction, ContentReactionNotFoundError, getSavedCollection } from '../db/content-reactions.ts';
import { getContentSharingDigest, ContentSharingInputError } from '../db/content-sharing.ts';
import { parseContentReactionInput, ContentReactionInputError } from '../../src/domain/content-reactions.ts';
import type { Express } from 'express';

/** Historical content ratings, content reactions, sharing, and the saved collection. */
export function registerContentQualityRoutes(app: Express): void {
  app.get('/api/operator/content-quality/ratings', createOperatorAllowlistMiddleware(), (_req, res) => {
    try { res.json(getContentQualityRatingLedger()); }
    catch (error) {
      console.error('Content quality rating ledger failed', error);
      res.status(500).json({ error: 'Failed to load content quality rating ledger' });
    }
  });
  app.get('/api/operator/content-reactions', createOperatorAllowlistMiddleware(), (_req, res) => {
    try { res.json(getContentReactionSummary()); }
    catch (error) {
      console.error('Failed to load content reaction summary', error);
      res.status(500).json({ error: 'Failed to load content reaction summary' });
    }
  });
  app.get('/api/operator/content-sharing', createOperatorAllowlistMiddleware(), (req, res) => {
    try {
      res.json(getContentSharingDigest(req.query.weekStart));
    } catch (error) {
      if (error instanceof ContentSharingInputError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error('Failed to load content sharing digest', error);
      res.status(500).json({ error: 'Failed to load content sharing digest' });
    }
  });
  app.get('/api/content-reactions', (_req, res) => {
    res.json({ reactions: listContentReactions() });
  });
  app.put('/api/content-reactions', (req, res) => {
    try { res.json({ reaction: setContentReaction(parseContentReactionInput(req.body)) }); }
    catch (error) {
      if (error instanceof ContentReactionInputError) { res.status(400).json({ error: error.message }); return; }
      if (error instanceof ContentReactionNotFoundError) { res.status(404).json({ error: error.message }); return; }
      console.error('Failed to save content reaction', error);
      res.status(500).json({ error: 'Failed to save reaction' });
    }
  });
  app.get('/api/saved-collection', (_req, res) => {
    res.json(getSavedCollection());
  });
}
