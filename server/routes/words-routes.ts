import { getMyWords, searchWords, getWordMeanings, getPrioritizedUnstudiedWords, listUnstudiedPriorityMatchesByTarget, nudgeDietProfile, DietManifestUnavailableError, updateWordPersonalNotes, updateWordMeaningVisibility } from '../db.ts';
import { addVocabularyStashByHanzi, updateVocabularyStashPriority } from '../db/vocabulary-stash.ts';
import { type MyWordsStatus, isMyWordsStatus } from '../../src/domain/my-words.ts';
import { readPositiveIntegerFromQuery } from './request-helpers.ts';
import type { CreateAppOptions } from '../index.ts';
import type { Express } from 'express';

/** My Words, word search and meanings, unstudied priority, diet nudges, and per-word learner edits. */
export function registerWordsRoutes(app: Express, { options }: { options: Pick<CreateAppOptions, 'wakeWordPreparation'> }): void {
  app.get('/api/my-words', (req, res) => {
    const view = req.query.view ?? 'recent';
    const query = req.query.q ?? '';
    const limitText = req.query.limit ?? '50';
    const offsetText = req.query.offset ?? '0';
    const statuses = parseMyWordsStatusQuery(req.query.status);
    const recentLapses = parseMyWordsLapsesQuery(req.query.lapses);
    if ((view !== 'recent' && view !== 'personal' && view !== 'deck') || typeof query !== 'string'
      || typeof limitText !== 'string' || !/^\d+$/.test(limitText)
      || typeof offsetText !== 'string' || !/^\d+$/.test(offsetText)
      || statuses === 'invalid' || recentLapses === 'invalid') {
      res.status(400).json({ error: 'Expected recent, personal or deck view, string q, valid status, and integer pagination' });
      return;
    }
    const limit = Number(limitText);
    const offset = Number(offsetText);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
      res.status(400).json({ error: 'Expected limit from 1 to 100 and non-negative integer offset' });
      return;
    }
    try {
      res.json(getMyWords({ view, query, statuses, recentLapses, limit, offset }));
    } catch {
      res.status(500).json({ error: 'Failed to load my words' });
    }
  });
  app.get('/api/words/search', (req, res) => {
    const query = req.query?.q;
    const limit = readPositiveIntegerFromQuery(req.query?.limit, 20);

    if (typeof query !== 'string') {
      res.status(400).json({ error: 'Expected string q query parameter' });
      return;
    }

    if (limit === null) {
      res.status(400).json({ error: 'Expected positive integer limit query parameter' });
      return;
    }

    try {
      res.json({ words: searchWords(query, limit) });
    } catch {
      res.status(500).json({ error: 'Failed to search words' });
    }
  });
  app.get('/api/words/:id/meanings', (req, res) => {
    try {
      const meanings = getWordMeanings(req.params.id);
      res.json(meanings);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to load word meanings' });
    }
  });
  app.get('/api/priority/unstudied', (req, res) => {
    res.json(getPrioritizedUnstudiedWords());
  });
  app.post('/api/priority/unstudied/add-by-hanzi', (req, res) => {
    const hanzi = req.body?.hanzi;
    const requiredForNextSession = req.body?.requiredForNextSession;
    const wordIds = req.body?.wordIds;

    if (typeof hanzi !== 'string') {
      res.status(400).json({ error: 'Expected string hanzi' });
      return;
    }

    if (requiredForNextSession !== undefined && typeof requiredForNextSession !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean requiredForNextSession when provided' });
      return;
    }

    if (wordIds !== undefined) {
      if (!Array.isArray(wordIds) || wordIds.some((wordId) => typeof wordId !== 'string')) {
        res.status(400).json({ error: 'Expected wordIds to be an array of strings when provided' });
        return;
      }
    }

    const normalizedHanzi = hanzi.trim();
    if (normalizedHanzi.length === 0) {
      res.status(400).json({ error: 'Expected non-empty hanzi' });
      return;
    }

    try {
      const matches = listUnstudiedPriorityMatchesByTarget(normalizedHanzi);
      if (matches.length === 0) {
        res.status(404).json({ error: 'No matching unstudied words found' });
        return;
      }

      if (wordIds === undefined && matches.length > 1) {
        res.json({
          needsSelection: true,
          query: normalizedHanzi,
          matches,
        });
        return;
      }

      const addedWords = addVocabularyStashByHanzi(
        normalizedHanzi,
        requiredForNextSession === true,
        wordIds,
      );
      options.wakeWordPreparation?.();
      res.json({
        addedCount: addedWords.length,
        words: addedWords,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'No matching unstudied words found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (
        error instanceof Error
        && (
          error.message === 'Expected wordIds to be an array of strings when provided'
          || error.message === 'Expected non-empty wordIds when provided'
          || error.message === 'wordIds must match the submitted target'
        )
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to add priority words by hanzi' });
    }
  });
  // Diet profile (SPECS/diet-deck-distribution.md). Deck machinery is never
  // user-visible; nudges are the learner's coarse steering signal and operator
  // jumps go through scripts/set-diet-deck.ts (no HTTP endpoint).
  app.post('/api/diet/nudge', (req, res) => {
    const direction = req.body?.direction;
    if (direction !== 'easier' && direction !== 'harder') {
      res.status(400).json({ error: "Expected direction to be 'easier' or 'harder'" });
      return;
    }

    try {
      const result = nudgeDietProfile(direction);
      res.json(result);
    } catch (error) {
      if (error instanceof DietManifestUnavailableError) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to nudge the diet profile' });
    }
  });
  app.patch('/api/words/:id/personal-notes', (req, res) => {
    const personalNotes = req.body?.personalNotes;

    if (typeof personalNotes !== 'string') {
      res.status(400).json({ error: 'Expected string personalNotes' });
      return;
    }

    try {
      const updatedWord = updateWordPersonalNotes(req.params.id, personalNotes.trim());
      res.json(updatedWord);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update personal notes' });
    }
  });
  app.patch('/api/words/:id/user-priority', (req, res) => {
    const bumpDelta = req.body?.bumpDelta;
    const forceTop = req.body?.forceTop;
    const reset = req.body?.reset;
    const requiredForNextSession = req.body?.requiredForNextSession;

    if (bumpDelta !== undefined && !Number.isInteger(bumpDelta)) {
      res.status(400).json({ error: 'Expected integer bumpDelta when provided' });
      return;
    }

    if (forceTop !== undefined && typeof forceTop !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean forceTop when provided' });
      return;
    }

    if (reset !== undefined && typeof reset !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean reset when provided' });
      return;
    }

    if (requiredForNextSession !== undefined && typeof requiredForNextSession !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean requiredForNextSession when provided' });
      return;
    }

    if (
      bumpDelta === undefined &&
      forceTop === undefined &&
      reset === undefined &&
      requiredForNextSession === undefined
    ) {
      res.status(400).json({ error: 'Expected at least one user-priority field to update' });
      return;
    }

    try {
      const updatedWord = updateVocabularyStashPriority(req.params.id, { bumpDelta, forceTop, reset, requiredForNextSession });
      options.wakeWordPreparation?.();
      res.json(updatedWord);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (error instanceof Error && error.message === 'Expected unstudied word') {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update user priority' });
    }
  });
  app.patch('/api/words/:wordId/meanings/:meaningId', (req, res) => {
    const showOnProductionPrompt = req.body?.showOnProductionPrompt;

    if (typeof showOnProductionPrompt !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean showOnProductionPrompt' });
      return;
    }

    try {
      const updatedMeanings = updateWordMeaningVisibility(
        req.params.wordId,
        req.params.meaningId,
        showOnProductionPrompt,
      );
      res.json(updatedMeanings);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word meaning not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update word meaning visibility' });
    }
  });
}

function parseMyWordsStatusQuery(value: unknown): MyWordsStatus[] | undefined | 'invalid' {
  if (value === undefined) return undefined;
  const tokens = (Array.isArray(value) ? value : [value]).flatMap((entry) => {
    if (typeof entry !== 'string') return ['invalid' as const];
    return entry.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  });
  if (tokens.some((token) => token === 'invalid' || !isMyWordsStatus(token))) return 'invalid';
  const selected = new Set(tokens.filter((token): token is MyWordsStatus => isMyWordsStatus(token)));
  return selected.size === 0 ? undefined : [...selected];
}

function parseMyWordsLapsesQuery(value: unknown): boolean | 'invalid' {
  if (value === undefined) return false;
  if (Array.isArray(value) || typeof value !== 'string') return 'invalid';
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false' || value === '') return false;
  return 'invalid';
}
