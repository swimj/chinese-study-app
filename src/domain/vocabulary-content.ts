/** Current authored vocabulary objects. Sense mapping and curation evolve independently. */
export type VocabularyJson = null | boolean | number | string | VocabularyJson[] | { [key: string]: VocabularyJson };
export type VocabularyMode = 'solidify' | 'practice' | 'maintain';
export type VocabularyActor = { kind: 'operator' | 'service'; id: string; reason?: VocabularyJson };
export type VocabularyWordRelationship = {
  wordId: string;
  relation: 'target' | 'context';
  senseId?: string | null;
  senseMappingEstablishedAt?: string | null;
};
export type VocabularyAnswerWord = { wordId: string; acceptedForms: string[] };
export type VocabularyTeachingBinding = { exerciseId: string; exerciseVersion: number };
type CommonDraft = {
  contentId?: string;
  payloadVersion: number;
  body: VocabularyJson;
  accessScope: 'shared' | 'private';
  ownerLearnerId?: string | null;
  availability: 'active' | 'quarantined' | 'retired';
  originKind: 'model' | 'human' | 'import';
  authorKind?: string | null;
  authorId?: string | null;
  words: VocabularyWordRelationship[];
};
export type VocabularyContentDraft = CommonDraft & (
  | { kind: 'exercise'; exerciseType: string; skill: string; exerciseRole: 'teaching' | 'general'; assessment: VocabularyJson;
      answers: VocabularyAnswerWord[]; teachingExercises?: never }
  | { kind: 'introduction'; exerciseType?: never; skill?: never; exerciseRole?: never; assessment?: never;
      answers?: never; teachingExercises: VocabularyTeachingBinding[] }
);
export type VocabularyContent = VocabularyContentDraft & {
  contentId: string; version: number; createdAt: string; updatedAt: string;
};
export type VocabularySense = {
  senseId: string; wordId: string; description: VocabularyJson; status: 'active' | 'retired';
  version: number; createdAt: string; updatedAt: string;
};
export type VocabularySenseCatalog = { wordId: string; version: number; establishedAt: string | null };
export type VocabularyBackendEvent = {
  name: string; data: VocabularyJson; payloadVersion?: number; occurredAt?: string;
  actorKind?: string; actorId?: string; learnerId?: string; sessionId?: string; jobId?: string;
  causalEventId?: string; entityKind?: string; entityId?: string;
};
