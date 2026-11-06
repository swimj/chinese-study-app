import type { VocabularyGenerationScope } from '../../src/domain/vocabulary-reflection.ts';
import { getDb } from './connection.ts';

const captureKey = 'operator-repertoire-selection-v1';
export type VocabularyRepertoireSelection = {
  wordId: string;
  catalogVersion: number;
  generationScope: VocabularyGenerationScope;
};

/** Queue-time instruction, separate from the worker's later admission/cache entries. */
export function captureVocabularyRepertoireSelection(jobId: string, value: VocabularyRepertoireSelection): void {
  const json = JSON.stringify(value);
  getDb().prepare("INSERT INTO vocabulary_improvement_stages(job_id,stage,input_hash,input_json,result_json,invocation_id,recorded_at) VALUES (?,'sense_mapping',?,?,?,NULL,?)")
    .run(jobId, captureKey, json, json, new Date().toISOString());
}

export function getVocabularyRepertoireSelection(jobId: string): VocabularyRepertoireSelection | null {
  const row = getDb().prepare("SELECT result_json FROM vocabulary_improvement_stages WHERE job_id=? AND stage='sense_mapping' AND input_hash=?")
    .get(jobId, captureKey) as {result_json: string} | undefined;
  return row ? JSON.parse(row.result_json) as VocabularyRepertoireSelection : null;
}
