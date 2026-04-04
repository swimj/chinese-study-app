export type Word = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  examples: string[];
  status: 'unstudied' | 'learning' | 'review' | 'mature';
  availableAt: string;
  priority: number;
  createdAt: string;
};

export type ReviewItem = {
  id: string;
  wordId: string;
  direction: 'forward' | 'reverse';
  status: 'unstudied' | 'learning' | 'review' | 'mature';
  intervalDays: number;
  lastReviewedAt: string | null;
  nextDueAt: string | null;
  easeFactor: number;
};

export type ReviewRating = 'forgot' | 'hard' | 'good' | 'easy';

export type WordItem = {
  id: string;
  english: string;
  chinese: string;
  pinyin: string;
  category: string;
  example: string;
};
