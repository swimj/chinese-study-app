/** Descriptive content feedback, deliberately independent of learning events. */
export const CONTENT_QUALITY_KINDS = [
  'production_cue', 'pure_cue', 'contrast_prompt', 'teaching_package', 'rehearsal', 'supplement'
] as const;
export type ContentQualityKind = typeof CONTENT_QUALITY_KINDS[number];
export type ContentQualityRating = 'up' | 'down' | null;
export type ContentQualityTarget = {
  kind: 'production_cue' | 'supplement';
  id: string;
} | {
  kind: 'contrast_prompt';
  id: string;
  expected: { promptText: string; explanation: string; targetWordId: string };
} | {
  kind: 'pure_cue';
  snapshotId: string;
} | {
  kind: 'teaching_package';
  packageId: string;
} | {
  kind: 'rehearsal';
  packageId: string;
  rehearsalId: string;
};

export type ContentQualityState = {
  contentKey: string;
  rating: ContentQualityRating;
};

export type ContentQualityFilters = {
  kind?: ContentQualityKind;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

export type ContentQualityTotals = {
  exposures: number;
  learnerContentPairs: number;
  up: number;
  down: number;
  ratedLearners: number;
  coverage: number;
};

export type ContentQualityItem = {
  contentKey: string;
  kind: ContentQualityKind;
  sourceId: string;
  wordId: string | null;
  title: string;
  content: unknown;
  provenance: {
    source: string;
    model: string | null;
  };
  exposures: number;
  learnersExposed: number;
  up: number;
  down: number;
  ratedLearners: number;
  coverage: number;
  lastSeenAt: string;
};

export type ContentQualityBreakdown = {
  kind: ContentQualityKind;
  source: string;
  model: string | null;
  totals: ContentQualityTotals;
};

export type ContentQualityAnalytics = {
  items: ContentQualityItem[];
  breakdowns: ContentQualityBreakdown[];
  totals: ContentQualityTotals;
  totalItems: number;
};
