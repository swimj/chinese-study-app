import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getAppConfig } from './config.ts';

const config = getAppConfig();
const dataDir = config.dataDir;
const dbPath = config.dbPath;
const legacyJsonPath = path.resolve(dataDir, 'app.json');
const dbExists = fs.existsSync(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

type Word = {
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

type ReviewItem = {
  id: string;
  wordId: string;
  direction: 'forward' | 'reverse';
  status: 'unstudied' | 'learning' | 'review' | 'mature';
  intervalDays: number;
  lastReviewedAt: string | null;
  nextDueAt: string | null;
  easeFactor: number;
};

type ReviewRating = 'forgot' | 'hard' | 'good' | 'easy';
type IntroduceWordsResult = {
  introducedWords: Word[];
  introducedCount: number;
  introducedToday: number;
  remainingToday: number;
};

type WordRow = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  examples_json: string;
  status: Word['status'];
  available_at: string;
  priority: number;
  created_at: string;
};

type ReviewItemRow = {
  id: string;
  word_id: string;
  direction: ReviewItem['direction'];
  status: ReviewItem['status'];
  interval_days: number;
  last_reviewed_at: string | null;
  next_due_at: string | null;
  ease_factor: number;
};

const db = new DatabaseSync(dbPath);
const DAILY_NEW_WORD_LIMIT = 3;

db.exec('PRAGMA foreign_keys = ON;');

initializeDatabase();

export type { IntroduceWordsResult, ReviewItem, ReviewRating, Word };
export { config as dbConfig };

export function getWords(): Word[] {
  const rows = db
    .prepare(`
      SELECT id, hanzi, pinyin, meaning, examples_json, status, available_at, priority, created_at
      FROM words
      ORDER BY priority DESC, created_at ASC
    `)
    .all() as WordRow[];

  return rows.map(mapWordRow);
}

export function getDueReviewItems(): ReviewItem[] {
  const now = new Date().toISOString();
  const rows = db
    .prepare(`
      SELECT id, word_id, direction, status, interval_days, last_reviewed_at, next_due_at, ease_factor
      FROM review_items
      WHERE next_due_at IS NOT NULL AND next_due_at <= ?
      ORDER BY next_due_at ASC
    `)
    .all(now) as ReviewItemRow[];

  return rows.map(mapReviewItemRow);
}

export function getReviewItems(): ReviewItem[] {
  const rows = db
    .prepare(`
      SELECT id, word_id, direction, status, interval_days, last_reviewed_at, next_due_at, ease_factor
      FROM review_items
      ORDER BY next_due_at ASC
    `)
    .all() as ReviewItemRow[];

  return rows.map(mapReviewItemRow);
}

export function getWordStatusCounts(): Record<Word['status'], number> {
  const rows = db
    .prepare(`
      SELECT status, COUNT(*) as count
      FROM words
      GROUP BY status
    `)
    .all() as Array<{ status: Word['status']; count: number }>;

  const counts: Record<Word['status'], number> = {
    unstudied: 0,
    learning: 0,
    review: 0,
    mature: 0,
  };

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return counts;
}

export function getDailyIntroductionStats() {
  const introducedToday = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM words
      WHERE status != 'unstudied' AND substr(available_at, 1, 10) = ?
    `)
    .get(getTodayKey()) as { count: number };

  return {
    dailyNewWordLimit: DAILY_NEW_WORD_LIMIT,
    introducedToday: introducedToday.count,
    remainingToday: Math.max(0, DAILY_NEW_WORD_LIMIT - introducedToday.count),
  };
}

export function introduceNewWords(requestedCount = DAILY_NEW_WORD_LIMIT): IntroduceWordsResult {
  const stats = getDailyIntroductionStats();
  const count = Math.max(0, Math.min(requestedCount, stats.remainingToday));

  if (count === 0) {
    return {
      introducedWords: [],
      introducedCount: 0,
      introducedToday: stats.introducedToday,
      remainingToday: stats.remainingToday,
    };
  }

  const wordsToIntroduce = db
    .prepare(`
      SELECT id, hanzi, pinyin, meaning, examples_json, status, available_at, priority, created_at
      FROM words
      WHERE status = 'unstudied'
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `)
    .all(count) as WordRow[];

  if (wordsToIntroduce.length === 0) {
    return {
      introducedWords: [],
      introducedCount: 0,
      introducedToday: stats.introducedToday,
      remainingToday: stats.remainingToday,
    };
  }

  const now = new Date().toISOString();
  const updateWord = db.prepare(`
    UPDATE words
    SET status = 'learning',
        available_at = ?
    WHERE id = ?
  `);
  const updateReviewItems = db.prepare(`
    UPDATE review_items
    SET status = 'learning',
        interval_days = 1,
        last_reviewed_at = NULL,
        next_due_at = ?,
        ease_factor = 2.5
    WHERE word_id = ?
  `);

  db.exec('BEGIN');

  try {
    for (const row of wordsToIntroduce) {
      updateWord.run(now, row.id);
      updateReviewItems.run(now, row.id);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const refreshedStats = getDailyIntroductionStats();

  return {
    introducedWords: wordsToIntroduce.map((row) =>
      mapWordRow({
        ...row,
        status: 'learning',
        available_at: now,
      }),
    ),
    introducedCount: wordsToIntroduce.length,
    introducedToday: refreshedStats.introducedToday,
    remainingToday: refreshedStats.remainingToday,
  };
}

export function submitReviewAnswer(reviewItemId: string, rating: ReviewRating): ReviewItem {
  const existingRow = db
    .prepare(`
      SELECT id, word_id, direction, status, interval_days, last_reviewed_at, next_due_at, ease_factor
      FROM review_items
      WHERE id = ?
    `)
    .get(reviewItemId) as ReviewItemRow | undefined;

  if (!existingRow) {
    throw new Error('Review item not found');
  }

  const currentItem = mapReviewItemRow(existingRow);
  const now = new Date().toISOString();
  const updatedItem = scheduleReviewItem(currentItem, rating, now);

  db.prepare(`
    UPDATE review_items
    SET status = ?,
        interval_days = ?,
        last_reviewed_at = ?,
        next_due_at = ?,
        ease_factor = ?
    WHERE id = ?
  `).run(
    updatedItem.status,
    updatedItem.intervalDays,
    updatedItem.lastReviewedAt,
    updatedItem.nextDueAt,
    updatedItem.easeFactor,
    updatedItem.id,
  );

  syncWordStatus(updatedItem.wordId);

  return updatedItem;
}

function initializeDatabase() {
  if (!dbExists) {
    createSchema();
    seedDatabase();
    return;
  }

  validateSchema();
  ensureIndexes();
}

function createSchema() {
  db.exec(`
    CREATE TABLE words (
      id TEXT PRIMARY KEY,
      hanzi TEXT NOT NULL,
      pinyin TEXT NOT NULL,
      meaning TEXT NOT NULL,
      examples_json TEXT NOT NULL,
      status TEXT NOT NULL,
      available_at TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE review_items (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      interval_days INTEGER NOT NULL,
      last_reviewed_at TEXT,
      next_due_at TEXT,
      ease_factor REAL NOT NULL
    );
  `);

  ensureIndexes();
}

function ensureIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_words_priority ON words(priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_review_items_due ON review_items(next_due_at ASC);
  `);
}

function validateSchema() {
  assertTableColumns('words', [
    'id',
    'hanzi',
    'pinyin',
    'meaning',
    'examples_json',
    'status',
    'available_at',
    'priority',
    'created_at',
  ]);
  assertTableColumns('review_items', [
    'id',
    'word_id',
    'direction',
    'status',
    'interval_days',
    'last_reviewed_at',
    'next_due_at',
    'ease_factor',
  ]);
}

function assertTableColumns(tableName: string, expectedColumns: string[]) {
  const pragmaQuery = `PRAGMA table_info(${tableName})`;
  const rows = db.prepare(pragmaQuery).all() as Array<{ name: string }>;
  const availableColumns = new Set(rows.map((row) => row.name));

  if (availableColumns.size === 0) {
    throw new Error(`Database at ${dbPath} is missing the required "${tableName}" table.`);
  }

  for (const column of expectedColumns) {
    if (!availableColumns.has(column)) {
      throw new Error(
        `Database at ${dbPath} has an incompatible "${tableName}" table. Missing column "${column}".`,
      );
    }
  }
}

function seedDatabase() {
  if (!config.seedSampleData) {
    return;
  }

  const wordCount = db.prepare('SELECT COUNT(*) as count FROM words').get() as { count: number };
  if (wordCount.count > 0) {
    return;
  }

  const legacyData = readLegacyJson();
  if (legacyData) {
    insertSeedData(legacyData.words, legacyData.reviewItems);
    return;
  }

  const sampleWords = buildSampleWords();
  const sampleReviewItems = buildSampleReviewItems(sampleWords);
  insertSeedData(sampleWords, sampleReviewItems);
}

function readLegacyJson(): DatabaseSchema | null {
  if (!fs.existsSync(legacyJsonPath)) {
    return null;
  }

  const raw = fs.readFileSync(legacyJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;

  if (!Array.isArray(parsed.words) || !Array.isArray(parsed.reviewItems)) {
    return null;
  }

  return {
    words: parsed.words as Word[],
    reviewItems: parsed.reviewItems as ReviewItem[],
  };
}

type DatabaseSchema = {
  words: Word[];
  reviewItems: ReviewItem[];
};

function insertSeedData(words: Word[], reviewItems: ReviewItem[]) {
  const insertWord = db.prepare(`
    INSERT INTO words (id, hanzi, pinyin, meaning, examples_json, status, available_at, priority, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertReviewItem = db.prepare(`
    INSERT INTO review_items (
      id,
      word_id,
      direction,
      status,
      interval_days,
      last_reviewed_at,
      next_due_at,
      ease_factor
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');

  try {
    for (const word of words) {
      insertWord.run(
        word.id,
        word.hanzi,
        word.pinyin,
        word.meaning,
        JSON.stringify(word.examples),
        word.status,
        word.availableAt,
        word.priority,
        word.createdAt,
      );
    }

    for (const reviewItem of reviewItems) {
      insertReviewItem.run(
        reviewItem.id,
        reviewItem.wordId,
        reviewItem.direction,
        reviewItem.status,
        reviewItem.intervalDays,
        reviewItem.lastReviewedAt,
        reviewItem.nextDueAt,
        reviewItem.easeFactor,
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function buildSampleWords(): Word[] {
  const now = new Date().toISOString();
  const seededLearningAvailableAt = addDays(now, -1);

  return [
    {
      id: 'word-1',
      hanzi: '你好',
      pinyin: 'nǐ hǎo',
      meaning: 'hello',
      examples: ['你好！你今天怎么样？'],
      status: 'learning',
      availableAt: seededLearningAvailableAt,
      priority: 100,
      createdAt: now,
    },
    {
      id: 'word-2',
      hanzi: '谢谢',
      pinyin: 'xiè xie',
      meaning: 'thank you',
      examples: ['谢谢你的帮助。'],
      status: 'learning',
      availableAt: seededLearningAvailableAt,
      priority: 99,
      createdAt: now,
    },
    {
      id: 'word-3',
      hanzi: '学习',
      pinyin: 'xué xí',
      meaning: 'to study',
      examples: ['我每天学习汉语。'],
      status: 'unstudied',
      availableAt: now,
      priority: 98,
      createdAt: now,
    },
    {
      id: 'word-4',
      hanzi: '朋友',
      pinyin: 'péng you',
      meaning: 'friend',
      examples: ['她是我的好朋友。'],
      status: 'unstudied',
      availableAt: now,
      priority: 97,
      createdAt: now,
    },
    {
      id: 'word-5',
      hanzi: '说',
      pinyin: 'shuō',
      meaning: 'to speak',
      examples: ['你会说中文吗？'],
      status: 'unstudied',
      availableAt: now,
      priority: 96,
      createdAt: now,
    },
  ];
}

function buildSampleReviewItems(words: Word[]): ReviewItem[] {
  return words.flatMap((word) => [
    {
      id: `${word.id}-forward`,
      wordId: word.id,
      direction: 'forward',
      status: word.status === 'unstudied' ? 'unstudied' : 'learning',
      intervalDays: 1,
      lastReviewedAt: null,
      nextDueAt: word.status === 'unstudied' ? null : word.availableAt,
      easeFactor: 2.5,
    },
    {
      id: `${word.id}-reverse`,
      wordId: word.id,
      direction: 'reverse',
      status: word.status === 'unstudied' ? 'unstudied' : 'learning',
      intervalDays: 1,
      lastReviewedAt: null,
      nextDueAt: word.status === 'unstudied' ? null : word.availableAt,
      easeFactor: 2.5,
    },
  ]);
}

function mapWordRow(row: WordRow): Word {
  return {
    id: row.id,
    hanzi: row.hanzi,
    pinyin: row.pinyin,
    meaning: row.meaning,
    examples: JSON.parse(row.examples_json) as string[],
    status: row.status,
    availableAt: row.available_at,
    priority: row.priority,
    createdAt: row.created_at,
  };
}

function mapReviewItemRow(row: ReviewItemRow): ReviewItem {
  return {
    id: row.id,
    wordId: row.word_id,
    direction: row.direction,
    status: row.status,
    intervalDays: row.interval_days,
    lastReviewedAt: row.last_reviewed_at,
    nextDueAt: row.next_due_at,
    easeFactor: row.ease_factor,
  };
}

function scheduleReviewItem(item: ReviewItem, rating: ReviewRating, reviewedAt: string): ReviewItem {
  if (rating === 'forgot') {
    return {
      ...item,
      status: 'learning',
      intervalDays: 1,
      lastReviewedAt: reviewedAt,
      nextDueAt: reviewedAt,
      easeFactor: 2.1,
    };
  }

  if (rating === 'hard') {
    const nextInterval = Math.max(1, Math.ceil(item.intervalDays * 1.5));

    return {
      ...item,
      status: nextInterval >= 7 ? 'review' : 'learning',
      intervalDays: nextInterval,
      lastReviewedAt: reviewedAt,
      nextDueAt: addDays(reviewedAt, nextInterval),
      easeFactor: Math.max(1.8, Number((item.easeFactor - 0.15).toFixed(2))),
    };
  }

  if (rating === 'good') {
    const baseInterval = item.intervalDays <= 1 ? 3 : Math.ceil(item.intervalDays * item.easeFactor);

    return {
      ...item,
      status: baseInterval >= 21 ? 'mature' : 'review',
      intervalDays: baseInterval,
      lastReviewedAt: reviewedAt,
      nextDueAt: addDays(reviewedAt, baseInterval),
      easeFactor: Number(item.easeFactor.toFixed(2)),
    };
  }

  const nextInterval = item.intervalDays <= 1 ? 4 : Math.ceil(item.intervalDays * (item.easeFactor + 0.35));

  return {
    ...item,
    status: nextInterval >= 21 ? 'mature' : 'review',
    intervalDays: nextInterval,
    lastReviewedAt: reviewedAt,
    nextDueAt: addDays(reviewedAt, nextInterval),
    easeFactor: Number((item.easeFactor + 0.15).toFixed(2)),
  };
}

function addDays(isoTimestamp: string, days: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function syncWordStatus(wordId: string) {
  const rows = db
    .prepare(`
      SELECT status
      FROM review_items
      WHERE word_id = ?
    `)
    .all(wordId) as Array<{ status: ReviewItem['status'] }>;

  const nextStatus = summarizeWordStatus(rows.map((row) => row.status));

  db.prepare(`
    UPDATE words
    SET status = ?
    WHERE id = ?
  `).run(nextStatus, wordId);
}

function summarizeWordStatus(statuses: ReviewItem['status'][]): Word['status'] {
  if (statuses.every((status) => status === 'unstudied')) {
    return 'unstudied';
  }

  if (statuses.every((status) => status === 'mature')) {
    return 'mature';
  }

  if (statuses.some((status) => status === 'review' || status === 'mature')) {
    return 'review';
  }

  return 'learning';
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}
