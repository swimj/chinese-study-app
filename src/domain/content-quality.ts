/** Descriptive content feedback, deliberately independent of learning events. */
export const CONTENT_QUALITY_KINDS = [
  'production_cue', 'definition_fallback', 'pure_cue', 'contrast_prompt', 'teaching_package', 'rehearsal', 'supplement'
] as const;
export type ContentQualityKind = typeof CONTENT_QUALITY_KINDS[number];
export type ContentQualityRating = 'up' | 'down' | null;
/** Current non-null learner votes, with exact snapshots aggregated for triage. */
export type ContentQualityRatingLedger = {
  ratings: ContentQualityRatingEntry[];
  totalRatings: number;
};

export type ContentQualityRatingEntry = {
  contentKey: string;
  kind: ContentQualityKind;
  sourceId: string;
  title: string;
  content: unknown;
  rating: Exclude<ContentQualityRating, null>;
  updatedAt: string;
};

export type ContentQualityRatedSnapshot = {
  contentKey: string;
  kind: ContentQualityKind;
  sourceId: string;
  title: string;
  content: unknown;
  up: number;
  down: number;
  totalRatings: number;
  updatedAt: string;
};
