import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { backfillVocabularyCaseReviews } from '../../server/db/vocabulary-case-review-migration.ts';
/** Bring focused historical fixtures through the real case-review migration. */
export function installCaseReviewSchema(db:DatabaseSync):void {
  const columns=db.prepare('PRAGMA table_info(vocabulary_reflection_jobs)').all() as {name:string}[];
  if(!columns.some(c=>c.name==='model_choice'))db.exec('ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT');
  if(!columns.some(c=>c.name==='second_opinion_json'))db.exec('ALTER TABLE vocabulary_reflection_jobs ADD COLUMN second_opinion_json TEXT');
  db.exec('PRAGMA foreign_keys=OFF');
  try{db.exec(fs.readFileSync(new URL('../../server/db/migrations/0066_vocabulary_case_reviews.sql',import.meta.url),'utf8'));backfillVocabularyCaseReviews(db);}finally{db.exec('PRAGMA foreign_keys=ON');}
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Case review fixture foreign keys failed');
}
