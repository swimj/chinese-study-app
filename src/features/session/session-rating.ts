import type { ReviewRating, Word } from '../../types';
import type { SessionStudyItem } from '../../domain/study-actions';

export type RatingShortcutKey = '1' | '2' | '3' | '4';

export type RatingOption = {
  value: ReviewRating;
  label: string;
  note: string;
  shortcutKey: RatingShortcutKey;
  isDefault: boolean;
};

const REVIEW_RATING_OPTIONS: RatingOption[] = [
  { value: 'forgot', label: 'Forgot', note: 'Counts as a failure and may trigger same-session reinforcement.', shortcutKey: '1', isDefault: false },
  { value: 'hard', label: 'Hard', note: 'Successful recall with effort.', shortcutKey: '2', isDefault: false },
  { value: 'good', label: 'Good', note: 'Successful recall with normal confidence.', shortcutKey: '3', isDefault: true },
  { value: 'easy', label: 'Easy', note: 'Successful recall with strong confidence.', shortcutKey: '4', isDefault: false },
];

const REVIEW_REINFORCEMENT_OPTIONS: RatingOption[] = [
  { value: 'forgot', label: 'Still missed', note: 'Still missed recall. Increments lapse count.', shortcutKey: '1', isDefault: false },
  { value: 'good', label: 'Recalled it', note: 'Correct recall. Advances reinforcement streak.', shortcutKey: '2', isDefault: true },
];

const CONTRAST_SELECTION_OPTIONS: RatingOption[] = [
  { value: 'hard', label: 'Hard', note: 'I had to work for the distinction.', shortcutKey: '2', isDefault: false },
  { value: 'good', label: 'Good', note: 'The distinction felt usable.', shortcutKey: '3', isDefault: true },
  { value: 'easy', label: 'Easy', note: 'The right choice felt obvious.', shortcutKey: '4', isDefault: false },
];

const BINARY_RECALL_OPTIONS: RatingOption[] = [
  { value: 'forgot', label: 'Forgot', note: 'Did not recall it correctly.', shortcutKey: '1', isDefault: false },
  { value: 'good', label: 'Good', note: 'Correct recall.', shortcutKey: '2', isDefault: true },
];

export function getActiveRatingOptions({
  actionKind,
  wordStatus,
  reviewInReinforcement,
}: {
  actionKind?: SessionStudyItem['actionKind'] | null;
  wordStatus: Word['status'] | undefined;
  reviewInReinforcement: boolean;
}): RatingOption[] {
  if (actionKind === 'contrast_selection') {
    return CONTRAST_SELECTION_OPTIONS;
  }

  if (wordStatus !== 'review') {
    return BINARY_RECALL_OPTIONS;
  }

  return reviewInReinforcement ? REVIEW_REINFORCEMENT_OPTIONS : REVIEW_RATING_OPTIONS;
}

export function getDefaultRating(ratingOptions: RatingOption[]): ReviewRating | null {
  return ratingOptions.find((option) => option.isDefault)?.value ?? null;
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
