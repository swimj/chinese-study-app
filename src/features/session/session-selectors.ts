import type { SessionStudyItem } from '../../domain/study-actions';
import type { Word, WordMeaning } from '../../types';

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

export function getPersonalNotesEditorTarget({
  word,
  activeWordPersonalNotes,
  frozenProductionCard,
  productionAwaitingNext,
  overridesByWordId,
}: {
  word: Word | null;
  activeWordPersonalNotes: string;
  frozenProductionCard: { targetWordId: string; personalNotes: string } | null;
  productionAwaitingNext: boolean;
  overridesByWordId: Record<string, string>;
}) {
  if (productionAwaitingNext && frozenProductionCard) {
    return {
      wordId: frozenProductionCard.targetWordId,
      personalNotes: overridesByWordId[frozenProductionCard.targetWordId] ?? frozenProductionCard.personalNotes,
    };
  }

  if (!word) {
    return null;
  }

  return {
    wordId: word.id,
    personalNotes: activeWordPersonalNotes,
  };
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
  item,
  word,
  promptDisplayedMeanings,
  allMeanings,
}: {
  item: SessionStudyItem | null;
  word: Word | null;
  promptDisplayedMeanings: string[];
  allMeanings: string[];
}) {
  if (!item || !word) {
    return null;
  }

  return item.actionKind === 'recognition'
    ? word.hanzi
    : promptDisplayedMeanings[0] ?? allMeanings[0] ?? word.meaning;
}

export function getActiveAnswerText({
  item,
  word,
  allMeanings,
}: {
  item: SessionStudyItem | null;
  word: Word | null;
  allMeanings: string[];
}) {
  if (!item || !word) {
    return null;
  }

  return item.actionKind === 'recognition'
    ? allMeanings[0] ?? word.meaning
    : word.hanzi;
}

export function getActiveAnswerPinyin(word: Word | null) {
  return word ? word.pinyin : null;
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

export function isProductionSessionItem(item: SessionStudyItem | null) {
  return item?.actionKind === 'production';
}
