import type { Express } from 'express';
import { getVocabularyStatistics } from '../db/vocabulary-statistics.ts';
import { parseVocabularyTimeZone } from './study-routes.ts';
import { VocabularySessionInputError } from '../db/vocabulary-sessions.ts';
/** Registered beneath the existing authenticated learner middleware. */
export function registerVocabularyStatisticsRoutes(app:Express):void {
  app.get('/api/vocabulary/statistics',(req,res)=>{
    let timeZone:string|undefined;
    try{timeZone=parseVocabularyTimeZone(req.query.timeZone);}catch(error){if(error instanceof VocabularySessionInputError){res.status(400).json({error:error.message});return;}throw error;}
    try{res.json(getVocabularyStatistics(new Date(),timeZone));}catch(error){console.error('Vocabulary statistics failed',error);res.status(500).json({error:'Statistics could not be loaded.'});}
  });
}
