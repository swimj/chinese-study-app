import { getDb } from './connection.ts';
import { LUNA_REFLECTION_MODEL_CHOICE, reflectionChoiceForStoredModel, type ReflectionModelChoice } from '../reflection/model-arms.ts';
import { reflectionConfigForChoice } from '../reflection/model-routing.ts';

/** Persist before invoking; retired feedback routes resolve without rewriting historical choices. */
export function vocabularyReflectionModelChoice(jobId: string, select: () => ReflectionModelChoice): ReflectionModelChoice {
  const db = getDb();
  const row = db.prepare('SELECT kind,model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(jobId) as {kind:string;model_choice:string|null}|undefined;
  if (!row) throw new Error('Reflection routing requires a persisted job');
  if (row.model_choice !== null) {
    const choice = reflectionChoiceForStoredModel(row.model_choice);
    if (choice === null) throw new Error(`Unsupported stored reflection model: ${row.model_choice}`);
    if (row.kind === 'learner_feedback' && reflectionConfigForChoice(choice).provider === 'zai') return LUNA_REFLECTION_MODEL_CHOICE;
    return choice;
  }
  const selected = select();
  db.prepare('UPDATE vocabulary_reflection_jobs SET model_choice=? WHERE job_id=? AND model_choice IS NULL').run(selected, jobId);
  return selected;
}

/** Availability failures belong to mapping, never to prerequisite/job claim counts. */
export function vocabularySenseMappingAvailabilityFailures(jobId: string): number {
  const row = getDb().prepare('SELECT sense_mapping_availability_failures AS failures FROM vocabulary_reflection_jobs WHERE job_id=?')
    .get(jobId) as {failures:number}|undefined;
  if (!row) throw new Error('Sense mapping routing requires a persisted job');
  return row.failures;
}
