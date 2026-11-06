import { createHash } from 'node:crypto';
import type { VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { validateVocabularySenseInventory } from './sense-inventory-contract.ts';

export type InventoryWord = { wordId: string; hanzi: string; traditional: string | null; pinyin: string; meanings: string[] };
export type InventorySnapshot = {
  word: InventoryWord;
  catalog: { version: number; establishedAt: string | null };
  senses: Array<{ senseId: string; version: number; status: 'active' | 'retired'; description: VocabularyJson }>;
  coverage: VocabularyJson;
  dependencies: Record<string, VocabularyJson>;
};
export type ReconciliationJudgment = {
  snapshotSha256: string;
  candidateSha256: string;
  reviewer: string;
  groups: Array<{
    existingSenseIds: string[];
    candidateIndexes: number[];
    decision: 'retain' | 'revise' | 'retire' | 'create' | 'restructure';
    rationale: string;
  }>;
};
export const inventoryHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && !!value.trim(); }

export function validateInventorySnapshot(value: unknown): InventorySnapshot {
  if (!record(value) || !record(value.word) || !record(value.catalog) || !Array.isArray(value.senses)
    || !record(value.dependencies) || !('coverage' in value)) throw new Error('Invalid inventory snapshot');
  const { word, catalog } = value;
  if (!text(word.wordId) || !text(word.hanzi) || !text(word.pinyin) || !(word.traditional === null || text(word.traditional))
    || !Array.isArray(word.meanings) || word.meanings.some(item => !text(item))
    || !Number.isSafeInteger(catalog.version) || Number(catalog.version) < 0
    || !(catalog.establishedAt === null || text(catalog.establishedAt))) throw new Error('Invalid lexical input or catalog');
  const ids = new Set<string>();
  for (const sense of value.senses) {
    if (!record(sense) || !text(sense.senseId) || ids.has(sense.senseId) || !Number.isSafeInteger(sense.version)
      || Number(sense.version) < 1 || !['active', 'retired'].includes(String(sense.status)) || !('description' in sense)) throw new Error('Invalid or duplicate sense');
    ids.add(sense.senseId);
  }
  return value as InventorySnapshot;
}

/** Check complete identity accounting; the reviewer, not this checker, owns semantic equivalence. */
export function checkInventoryReconciliation(snapshotValue: unknown, candidateValue: unknown, judgmentValue: unknown) {
  const snapshot = validateInventorySnapshot(snapshotValue);
  const candidate = validateVocabularySenseInventory(candidateValue);
  if (!record(judgmentValue) || judgmentValue.snapshotSha256 !== inventoryHash(snapshot)
    || judgmentValue.candidateSha256 !== inventoryHash(candidateValue) || !text(judgmentValue.reviewer)
    || !Array.isArray(judgmentValue.groups)) throw new Error('Judgment is missing or does not match frozen source/candidate hashes');
  const activeIds = new Set(snapshot.senses.filter(sense => sense.status === 'active').map(sense => sense.senseId));
  const seenIds = new Set<string>(), seenIndexes = new Set<number>();
  const groups: ReconciliationJudgment['groups'] = [];
  for (const group of judgmentValue.groups) {
    if (!record(group) || !Array.isArray(group.existingSenseIds) || !Array.isArray(group.candidateIndexes)
      || !text(group.rationale) || !['retain', 'revise', 'retire', 'create', 'restructure'].includes(String(group.decision))) throw new Error('Invalid semantic decision');
    for (const id of group.existingSenseIds) {
      if (typeof id !== 'string' || !activeIds.has(id) || seenIds.has(id)) throw new Error('Unknown, retired, or repeated existing sense');
      seenIds.add(id);
    }
    for (const index of group.candidateIndexes) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= candidate.senses.length || seenIndexes.has(index)) throw new Error('Invalid or repeated candidate index');
      seenIndexes.add(index);
    }
    const oldCount = group.existingSenseIds.length, newCount = group.candidateIndexes.length;
    if ((group.decision === 'retain' && (oldCount !== 1 || newCount > 1))
      || (group.decision === 'revise' && (oldCount !== 1 || newCount !== 1))
      || (group.decision === 'retire' && (oldCount !== 1 || newCount !== 0))
      || (group.decision === 'create' && (oldCount !== 0 || newCount !== 1))
      || (group.decision === 'restructure' && (oldCount < 1 || newCount < 1 || (oldCount === 1 && newCount === 1)))) throw new Error('Decision cardinality does not preserve identity boundaries');
    groups.push(group as ReconciliationJudgment['groups'][number]);
  }
  if (seenIds.size !== activeIds.size || seenIndexes.size !== candidate.senses.length) throw new Error('Every active existing sense and candidate must be accounted for exactly once');
  return {
    wordId: snapshot.word.wordId, snapshotSha256: inventoryHash(snapshot), candidateSha256: inventoryHash(candidateValue),
    reviewer: judgmentValue.reviewer, structurallyValid: true, semanticJudgmentVerified: false, applyReady: false,
    emptyInventory: groups.every(group => group.decision === 'retire'),
    groups, dependencies: snapshot.dependencies, currentCoverage: snapshot.coverage,
    requiredBeforeApply: [
      'Review semantic judgments and candidate default-useful choices.',
      'Re-export under stopped writers and verify the exact snapshot hash.',
      'Resolve content, coverage, imports, learner-sense, and pending-work dependencies; preserve historical evidence and learner progress.',
      ...(groups.some(group => group.decision === 'restructure') ? ['Explicitly resolve split/merge identity and dependent mapping decisions.'] : []),
      'Use a separately reviewed transactional apply operation with restore and integrity verification.',
    ],
  };
}
