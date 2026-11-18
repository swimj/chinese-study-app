import type { Express } from 'express';
import { getVocabularyStatistics, getVocabularyStudyDays } from '../db/vocabulary-statistics.ts';
import { parseVocabularyTimeZone } from './study-routes.ts';
import { VocabularySessionInputError } from '../db/vocabulary-sessions.ts';
/** Registered beneath the existing authenticated learner middleware. */
export function registerVocabularyStatisticsRoutes(app: Express): void {
  for (const [path, load] of [['statistics', getVocabularyStatistics], ['study-days', getVocabularyStudyDays]] as const) {
    app.get(`/api/vocabulary/${path}`, (req, res) => {
      let timeZone: string | undefined;
      try {
        timeZone = parseVocabularyTimeZone(req.query.timeZone);
      } catch (error) {
        if (!(error instanceof VocabularySessionInputError)) throw error;
        res.status(400).json({ error: error.message });
        return;
      }
      try {
        res.json(load(new Date(), timeZone));
      } catch (error) {
        console.error(`Vocabulary ${path} failed`, error);
        res.status(500).json({ error: 'Statistics could not be loaded.' });
      }
    });
  }
}
