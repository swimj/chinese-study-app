import type { ReviewItem, SessionItemWithWord, Word, WordMeaning } from '../../types';

export function getActiveWordPersonalNotes({
  word,
  overridesByWordId,
}: {
  word: Word | null;
  overridesByWordId: Record<string, string>;
}) {
  if (!word) {
    return '';
  }

  return overridesByWordId[word.id] ?? word.personalNotes;
}

export function getActiveMeaningSelection({
  word,
  meaningRowsByWordId,
}: {
  word: Word | null;
  meaningRowsByWordId: Record<string, WordMeaning[]>;
}) {
  const fallbackMeanings =
    word === null
      ? []
      : word.meanings.length > 0
        ? word.meanings
        : word.meaning.trim().length > 0
          ? [word.meaning]
          : [];
  const meaningRows =
    word
      ? [...(meaningRowsByWordId[word.id] ?? [])].sort((left, right) => left.position - right.position)
      : [];
  const allMeanings = meaningRows.length > 0 ? meaningRows.map((meaning) => meaning.text) : fallbackMeanings;
  const promptDisplayedMeanings =
    meaningRows.length > 0
      ? meaningRows.filter((meaning) => meaning.showOnProductionPrompt).map((meaning) => meaning.text)
      : fallbackMeanings;

  return {
    fallbackMeanings,
    meaningRows,
    allMeanings,
    promptDisplayedMeanings,
  };
}

export function getActivePrompt({
  reviewItem,
  word,
  promptDisplayedMeanings,
  allMeanings,
}: {
  reviewItem: ReviewItem | null;
  word: Word | null;
  promptDisplayedMeanings: string[];
  allMeanings: string[];
}) {
  if (!reviewItem || !word) {
    return null;
  }

  return reviewItem.direction === 'forward'
    ? word.hanzi
    : promptDisplayedMeanings[0] ?? allMeanings[0] ?? word.meaning;
}

export function getActiveAnswerText({
  reviewItem,
  word,
  allMeanings,
}: {
  reviewItem: ReviewItem | null;
  word: Word | null;
  allMeanings: string[];
}) {
  if (!reviewItem || !word) {
    return null;
  }

  return reviewItem.direction === 'forward'
    ? allMeanings[0] ?? word.meaning
    : word.hanzi;
}

export function getActiveAnswerPinyin(item: SessionItemWithWord | null) {
  return item ? item.word.pinyin : null;
}

export function isReviewInReinforcement({
  word,
  failureCount,
}: {
  word: Word | null;
  failureCount: number;
}) {
  return word?.status === 'review' && failureCount > 0;
}

export function getActiveReviewState({
  reviewInReinforcement,
  reinforcementStreak,
  failureCount,
}: {
  reviewInReinforcement: boolean;
  reinforcementStreak: number;
  failureCount: number;
}) {
  return reviewInReinforcement
    ? `Reinforcement ${reinforcementStreak}/3 · Forgotten recalls ${failureCount}`
    : 'Initial recall';
}

export function isProductionReviewItem(reviewItem: ReviewItem | null) {
  return reviewItem?.direction === 'reverse';
}
