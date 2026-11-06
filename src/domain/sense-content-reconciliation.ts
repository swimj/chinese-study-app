export type SenseContentReconciliationDraft = {
  defaultSenseIds: string[];
  uses: Array<{ useId: string; decision: 'map' | 'reject' | 'unsupported'; senseId: string | null; rationale: string }>;
  rationale: string;
  unsupportedChanges: string[];
};
export type SenseContentReconciliationSave = {
  expectedVersion: number | null;
  status: 'draft' | 'resolved';
  draft: SenseContentReconciliationDraft;
  refreshSource?: boolean;
};
export type SenseContentReconciliationResolution = {
  resolutionId: string; wordId: string; version: number; status: 'draft' | 'resolved' | 'applied';
  draft: SenseContentReconciliationDraft; createdAt: string; updatedAt: string; appliedAt: string | null;
};
export type SenseContentReconciliationPlan = {
  fingerprint: string;
  blockers: Array<{ code: string; message: string; objectIds: string[] }>;
  retireContentIds: string[]; retireSourceIds: string[]; retirePackageIds: string[]; retainedContentIds: string[];
  replacementTeachingRequired: boolean; replacementPracticeRequired: boolean;
};
export type SenseContentReconciliationProgress = {
  status: 'not_required' | 'pending' | 'ready' | 'failed';
  teachingStatus: 'not_required' | 'pending' | 'ready' | 'failed';
  practiceStatus: 'not_required' | 'pending' | 'ready' | 'failed';
  errors: string[];
};
export type SenseContentReconciliationWord = { wordId: string; hanzi: string; pinyin: string; reason: string };
export type SenseContentReconciliationWorkspace = {
  wordId: string; hanzi: string; pinyin: string;
  senses: Array<{ senseId: string; version: number; label: string; notes: string[]; defaultUseful: boolean }>;
  teaching: { contentId: string; packageId: string | null; uses: Array<{ id: string; label: string; notes: string[];
    examples: Array<{ text: string; translation: string; pronunciation: string | null }> }> } | null;
  affectedContent: Array<{ contentId: string; kind: string; summary: string }>;
  resolution: SenseContentReconciliationResolution | null;
  plan: SenseContentReconciliationPlan | null;
  progress: SenseContentReconciliationProgress;
};
