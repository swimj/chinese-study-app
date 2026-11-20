import { searchWords, getWordMeanings, getPrioritizedUnstudiedWords, listUnstudiedPriorityMatchesByTarget, updateWordPersonalNotes, updateWordMeaningVisibility } from '../db.ts';
import { addVocabularyStashByHanzi, updateVocabularyStashPriority } from '../db/vocabulary-stash.ts';
import { readPositiveIntegerFromQuery } from './request-helpers.ts';
import type { CreateAppOptions } from '../index.ts';
import type { Express } from 'express';

/** Word search and meanings, unstudied priority, and per-word learner edits. */
export function registerWordsRoutes(app: Express, { options }: { options: Pick<CreateAppOptions, 'wakeWordPreparation'> }): void {
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
