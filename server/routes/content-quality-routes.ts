import { recordContentQualityEncounter, parseContentQualityTarget, ContentQualityInputError, setContentQualityRating, getContentQualityAnalytics, getContentQualityRatingLedger } from '../db/content-quality.ts';
import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import type { ContentQualityKind } from '../../src/domain/content-quality.ts';
import { getContentReactionSummary, listContentReactions, setContentReaction, ContentReactionNotFoundError, getSavedCollection } from '../db/content-reactions.ts';
import { getContentSharingDigest, ContentSharingInputError } from '../db/content-sharing.ts';
import { parseContentReactionInput, ContentReactionInputError } from '../../src/domain/content-reactions.ts';
import type { Express } from 'express';

/** Content-quality encounters, ratings, reactions, the saved collection, and their operator reads. */
export function registerContentQualityRoutes(app: Express): void {
  app.post('/api/content-quality/encounters', (req, res) => {
    try {
      res.json(recordContentQualityEncounter(parseContentQualityTarget(req.body?.target), req.body?.encounterId));
    } catch (error) {
      if (error instanceof ContentQualityInputError) { res.status(400).json({ error: error.message }); return; }
      console.error('Content quality encounter failed', error);
      res.status(500).json({ error: 'Failed to record content quality encounter' });
    }
  });
  app.put('/api/content-quality/ratings', (req, res) => {
    try { res.json(setContentQualityRating(req.body?.contentKey, req.body?.rating)); }
    catch (error) {
      if (error instanceof ContentQualityInputError) { res.status(400).json({ error: error.message }); return; }
      console.error('Content quality rating failed', error);
      res.status(500).json({ error: 'Failed to save content quality rating' });
    }
  });
  app.get('/api/operator/content-quality', createOperatorAllowlistMiddleware(), (req, res) => {
    if (Object.values(req.query).some(value => typeof value !== 'string')) {
      res.status(400).json({ error: 'Expected string quality filters' }); return;
    }
    try {
      res.json(getContentQualityAnalytics({ kind: req.query.kind as ContentQualityKind | undefined,
        since: req.query.since as string | undefined, until: req.query.until as string | undefined,
        limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
        offset: req.query.offset === undefined ? undefined : Number(req.query.offset) }));
    } catch (error) {
      if (error instanceof ContentQualityInputError) { res.status(400).json({ error: error.message }); return; }
      console.error('Content quality analytics failed', error);
      res.status(500).json({ error: 'Failed to load content quality analytics' });
    }
  });
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
