import type { Express } from 'express';
import { performance } from 'node:perf_hooks';
import { computeVocabularyProgress, loadVocabularyProgressInput } from '../db/vocabulary-progress.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { parseVocabularyTimeZone } from './study-routes.ts';
import { VocabularySessionInputError } from '../db/vocabulary-sessions.ts';

export type VocabularyProgressCost = { event: 'vocabulary.progress.computed'; completions: number; reportBytes: number; loadMs: number; computeMs: number };
/** Computed on request from the learner's whole closed history; the cost line keeps that visible in hosted logs. */
export function registerVocabularyProgressRoutes(app: Express, logCost: (cost: VocabularyProgressCost) => void = cost => console.log(JSON.stringify(cost))): void {
  app.get('/api/vocabulary/progress', (req, res) => {
    let timeZone: string | undefined;
    try { timeZone = parseVocabularyTimeZone(req.query.timeZone); } catch (error) { if (error instanceof VocabularySessionInputError) { res.status(400).json({ error: error.message }); return; } throw error; }
    try {
      const started = performance.now();
      const { input, stats } = loadVocabularyProgressInput(requireLearnerId());
      const loaded = performance.now();
      const progress = computeVocabularyProgress(input, new Date(), timeZone);
      const round = (ms: number) => Math.round(ms * 10) / 10;
      logCost({ event: 'vocabulary.progress.computed', ...stats, loadMs: round(loaded - started), computeMs: round(performance.now() - loaded) });
      res.json(progress);
    } catch (error) { console.error('Vocabulary progress failed', error); res.status(500).json({ error: 'Progress could not be loaded.' }); }
  });
}
