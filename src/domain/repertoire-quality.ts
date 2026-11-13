export type RepertoireModel = 'sol' | 'luna';
export type RepertoirePath = 'practice' | 'reflection' | 'bulk';
export type RepertoireQualityView = 'cues' | 'repairs';

export type RepertoireOutcomes = {
  served: number;
  answered: number;
  acceptedFirst: number;
  unfairFirstMisses: number;
  unclassifiedFirstMisses: number;
  skipped: number;
  negative: number;
  comments: number;
};

export type RepertoireCohort = RepertoireOutcomes & {
  model: RepertoireModel;
  exercises: number;
  exercisesServed: number;
  wordsPublished: number;
  authoringSpendUsd: number | null;
  pricedCalls: number;
  calls: number;
};

export type RepertoireCueRow = {
  id: string;
  prompt: string;
  target: string;
  model: RepertoireModel;
  path: RepertoirePath;
  promptVersion: string | null;
  outcomes: RepertoireOutcomes;
  laterChanges: number;
};

export type RepertoireRepairRow = {
  id: string;
  prompt: string;
  target: string;
  appliedAt: string;
  kind: 'edit' | 'replacement' | 'retirement';
  before: RepertoireOutcomes;
  after: RepertoireOutcomes | null;
  laterChanges: number;
};

export type RepertoireRepairTotals = {
  applied: number;
  retired: number;
  servedAfter: number;
  firstMissAfter: number;
  unfairAfter: number;
  changedAgain: number;
};

export type RepertoireQualityPage = {
  capturedAt: string;
  cohorts: RepertoireCohort[];
  repairTotals: RepertoireRepairTotals;
  cueRows: RepertoireCueRow[];
  repairRows: RepertoireRepairRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type RepertoireCueVersion = {
  contentId: string;
  version: number;
  prompt: string;
  availability: 'active' | 'quarantined' | 'retired';
  recordedAt: string;
  change: 'published' | 'source' | 'edit' | 'replacement' | 'retirement' | 'metadata';
  outcomes: RepertoireOutcomes;
};

export type RepertoireQualityDetail = {
  target: string;
  generatedPrompt: string | null;
  publication: 'automatic' | 'operator' | null;
  versions: RepertoireCueVersion[];
};
