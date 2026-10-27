import type { Express } from 'express';
import { getVocabularyStatistics } from '../db/vocabulary-statistics.ts';
/** Registered beneath the existing authenticated learner middleware. */
export function registerVocabularyStatisticsRoutes(app:Express):void {
  app.get('/api/vocabulary/statistics',(_req,res)=>{
    try{res.json(getVocabularyStatistics());}catch(error){console.error('Vocabulary statistics failed',error);res.status(500).json({error:'Statistics could not be loaded.'});}
  });
}
