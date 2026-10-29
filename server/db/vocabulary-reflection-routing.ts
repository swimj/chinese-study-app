import { getDb } from './connection.ts';
import { isReflectionModelChoice, type ReflectionModelChoice } from '../reflection/model-arms.ts';

/** Persist before invoking so failures and restarts cannot reroll a job's model. */
export function vocabularyReflectionModelChoice(jobId: string, select: () => ReflectionModelChoice): ReflectionModelChoice {
  const db = getDb();
  const row = db.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(jobId) as {model_choice:string|null}|undefined;
  if (!row) throw new Error('Reflection routing requires a persisted job');
  if (row.model_choice !== null) {
    if (!isReflectionModelChoice(row.model_choice)) throw new Error(`Unsupported stored reflection model: ${row.model_choice}`);
    return row.model_choice;
  }
  const selected = select();
  db.prepare('UPDATE vocabulary_reflection_jobs SET model_choice=? WHERE job_id=? AND model_choice IS NULL').run(selected, jobId);
  return selected;
}
