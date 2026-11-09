export const BULK_REPERTOIRE_APPLIED = 'vocabulary.bulk_repertoire.applied';
export type BulkRepertoireReceipt = {
  operationId: string; resultHash: string; wordId: string; actorId: string; appliedAt: string;
  catalogVersion: number; coverageFingerprint: string; contentIds: string[]; invocationIds: string[]; retiredFallbackIds: string[];
};
