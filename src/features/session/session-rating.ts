import type { ReviewRating, Word } from '../../types';

export type RatingOption = {
  value: ReviewRating;
  label: string;
  note: string;
};

const REVIEW_RATING_OPTIONS: RatingOption[] = [
  { value: 'forgot', label: 'Forgot', note: 'Counts as a failure and may trigger same-session reinforcement.' },
  { value: 'hard', label: 'Hard', note: 'Successful recall with effort.' },
  { value: 'good', label: 'Good', note: 'Successful recall with normal confidence.' },
  { value: 'easy', label: 'Easy', note: 'Successful recall with strong confidence.' },
];

const REVIEW_REINFORCEMENT_OPTIONS: RatingOption[] = [
  { value: 'forgot', label: 'No', note: 'Still missed recall. Increments lapse count.' },
  { value: 'good', label: 'Yes', note: 'Correct recall. Advances reinforcement streak.' },
];

const BINARY_RECALL_OPTIONS: RatingOption[] = [
  { value: 'forgot', label: 'Forgot', note: 'Did not recall it correctly.' },
  { value: 'good', label: 'Good', note: 'Correct recall.' },
];

export function getActiveRatingOptions({
  wordStatus,
  reviewInReinforcement,
}: {
  wordStatus: Word['status'] | undefined;
  reviewInReinforcement: boolean;
}): RatingOption[] {
  if (wordStatus !== 'review') {
    return BINARY_RECALL_OPTIONS;
  }

  return reviewInReinforcement ? REVIEW_REINFORCEMENT_OPTIONS : REVIEW_RATING_OPTIONS;
}

export function getRatingForKey(key: string, ratingOptions: RatingOption[]) {
  const availableRatings = new Set(ratingOptions.map((option) => option.value));
  const binaryRecall =
    availableRatings.size === 2 && availableRatings.has('forgot') && availableRatings.has('good');

  if (binaryRecall) {
    if (key === '1') {
      return 'forgot' as const;
    }

    if (key === '2' || key === '3') {
      return 'good' as const;
    }

    return null;
  }

  const ratingByKey: Partial<Record<string, ReviewRating>> = {
    '1': 'forgot',
    '2': 'hard',
    '3': 'good',
    '4': 'easy',
  };

  return ratingByKey[key] ?? null;
}
