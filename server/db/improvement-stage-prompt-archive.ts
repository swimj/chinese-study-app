import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../llm/types.ts';
import { readArchivedPrompt, retainInvocationPrompts } from './invocation-prompt-archive.ts';

function stageContract(input: JsonValue): { [key: string]: JsonValue } | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const contract = input.contract;
  return contract !== null && typeof contract === 'object' && !Array.isArray(contract) ? contract : null;
}

function verifyStageHash(inputJson: string, inputHash: string): void {
  if (createHash('sha256').update(inputJson).digest('hex') !== inputHash) {
    throw new Error('Improvement stage input hash does not match its original evidence');
  }
}

/** Keep the full logical input as the cache identity. The reference is out of band so custom inputs cannot imitate it. */
export function retainImprovementStageInput(db: DatabaseSync, inputJson: string, inputHash: string) {
  const input: JsonValue = JSON.parse(inputJson);
  const contract = stageContract(input);
  if (!contract || typeof contract.systemPrompt !== 'string') return { inputJson, systemPromptBlobHash: null };
  verifyStageHash(inputJson, inputHash);
  if (JSON.stringify(input) !== inputJson) throw new Error('Cannot archive a noncanonical improvement stage input losslessly');
  const { templateHash } = retainInvocationPrompts(db, contract.systemPrompt, null);
  contract.systemPrompt = null;
  return { inputJson: JSON.stringify(input), systemPromptBlobHash: templateHash };
}

export function restoreImprovementStageInput(db: DatabaseSync, inputJson: string, inputHash: string,
  systemPromptBlobHash: string | null, archiveDir?: string): string {
  if (systemPromptBlobHash === null) return inputJson;
  const input: JsonValue = JSON.parse(inputJson);
  const contract = stageContract(input);
  if (!contract || contract.systemPrompt !== null) throw new Error('Invalid archived improvement stage input');
  contract.systemPrompt = readArchivedPrompt(db, systemPromptBlobHash, archiveDir);
  const original = JSON.stringify(input);
  verifyStageHash(original, inputHash);
  return original;
}

export function stageImprovementPromptReferences(db: DatabaseSync): void {
  db.exec(`CREATE TEMP TABLE improvement_stage_prompt_updates (
    job_id TEXT NOT NULL, stage TEXT NOT NULL, input_hash TEXT NOT NULL, input_json TEXT NOT NULL,
    blob_hash TEXT NOT NULL, PRIMARY KEY(job_id,stage,input_hash)
  )`);
  const insert = db.prepare('INSERT INTO improvement_stage_prompt_updates VALUES (?,?,?,?,?)');
  const rows = db.prepare(`SELECT job_id,stage,input_hash,input_json FROM vocabulary_improvement_stages
    WHERE json_type(input_json,'$.contract.systemPrompt')='text'`).iterate();
  for (const row of rows) {
    const archived = retainImprovementStageInput(db, String(row.input_json), String(row.input_hash));
    insert.run(row.job_id, row.stage, row.input_hash, archived.inputJson, archived.systemPromptBlobHash);
  }
}
