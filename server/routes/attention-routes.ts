import { getAttentionBadges, markReflectionInboxSeen, markFailedReflectionRunsSeen } from '../db.ts';
import type { MarkReflectionInboxSeenRequest } from '../../src/domain/reflection.ts';
import { isReflectionNotFoundError, isReflectionQualityClientError, isAttentionClientError, isPlainObject } from './request-helpers.ts';
import type { Express } from 'express';

/** Navigation attention badges and their seen cursors. */
export function registerAttentionRoutes(app: Express): void {
  app.get('/api/attention-badges', (_req, res) => {
    try {
      res.json(getAttentionBadges());
    } catch {
      res.status(500).json({ error: 'Failed to load attention badges' });
    }
  });
  app.post('/api/reflection-inbox-seen', (req, res) => {
    const request = readMarkReflectionInboxSeenRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection inbox seen request' });
      return;
    }
    try {
      res.json(markReflectionInboxSeen(request));
    } catch (error) {
      if (isReflectionNotFoundError(error, 'Reflection proposal not found.')) {
        res.status(404).json({ error: 'Reflection proposal not found' });
        return;
      }
      if (isReflectionQualityClientError(error) || isAttentionClientError(error)) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
        return;
      }
      res.status(500).json({ error: 'Failed to mark reflection inbox item seen' });
    }
  });
  app.post('/api/failed-reflection-runs-seen', (req, res) => {
    const request = readFailedReflectionRunsSeenRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid failed-reflection-runs seen request' });
      return;
    }
    try {
      res.json(markFailedReflectionRunsSeen(request.seenThroughAt));
    } catch (error) {
      if (isAttentionClientError(error)) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
        return;
      }
      res.status(500).json({ error: 'Failed to acknowledge failed reflection runs' });
    }
  });
}

function readMarkReflectionInboxSeenRequest(
  value: unknown,
): MarkReflectionInboxSeenRequest | null {
  if (!isPlainObject(value) || typeof value.kind !== 'string') return null;
  const keys = Object.keys(value).sort();
  if (value.kind === 'proposal') {
    if (
      keys.length !== 2
      || keys[0] !== 'kind'
      || keys[1] !== 'proposalId'
      || typeof value.proposalId !== 'string'
      || value.proposalId.trim().length === 0
    ) {
      return null;
    }
    return { kind: 'proposal', proposalId: value.proposalId.trim() };
  }
  if (value.kind === 'explanation') {
    if (
      keys.length !== 3
      || keys[0] !== 'artifactId'
      || keys[1] !== 'itemId'
      || keys[2] !== 'kind'
      || typeof value.artifactId !== 'string'
      || value.artifactId.trim().length === 0
      || typeof value.itemId !== 'string'
      || value.itemId.trim().length === 0
    ) {
      return null;
    }
    return {
      kind: 'explanation',
      artifactId: value.artifactId.trim(),
      itemId: value.itemId.trim(),
    };
  }
  return null;
}

function readFailedReflectionRunsSeenRequest(
  value: unknown,
): { seenThroughAt?: string } | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0) return {};
  if (
    keys.length !== 1
    || keys[0] !== 'seenThroughAt'
    || typeof value.seenThroughAt !== 'string'
  ) {
    return null;
  }
  return { seenThroughAt: value.seenThroughAt };
}
