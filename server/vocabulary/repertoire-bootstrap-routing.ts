import { createHash } from 'node:crypto';

export const LUNA_REPERTOIRE_MODEL = 'gpt-6-luna';
export type RepertoireBootstrapModel = typeof LUNA_REPERTOIRE_MODEL | 'gpt-6-sol';

/** Assign a word to one arm across automatic entry points and retries. */
export function repertoireBootstrapModel(wordId: string): RepertoireBootstrapModel {
  const bucket = createHash('sha256').update('vocabulary-repertoire-bootstrap-v1\0').update(wordId).digest().readUInt32BE(0) % 3;
  return bucket === 0 ? LUNA_REPERTOIRE_MODEL : 'gpt-6-sol';
}
