import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve(process.cwd(), 'data');
const dbPath = path.resolve(dataDir, 'app.db');
const legacyJsonPath = path.resolve(dataDir, 'app.json');

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

type DatabaseSchema = {
  words: Word[];
  reviewItems: ReviewItem[];
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

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS words (
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

  CREATE TABLE IF NOT EXISTS review_items (
    id TEXT PRIMARY KEY,
    word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    interval_days INTEGER NOT NULL,
    last_reviewed_at TEXT,
    next_due_at TEXT,
    ease_factor REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_words_priority ON words(priority DESC, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_review_items_due ON review_items(next_due_at ASC);
`);

initializeDatabase();

export type { ReviewItem, Word };

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

function initializeDatabase() {
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

  return [
    {
      id: 'word-1',
      hanzi: '你好',
      pinyin: 'nǐ hǎo',
      meaning: 'hello',
      examples: ['你好！你今天怎么样？'],
      status: 'learning',
      availableAt: now,
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
      availableAt: now,
      priority: 99,
      createdAt: now,
    },
    {
      id: 'word-3',
      hanzi: '学习',
      pinyin: 'xué xí',
      meaning: 'to study',
      examples: ['我每天学习汉语。'],
      status: 'learning',
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
      status: 'learning',
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
      status: 'learning',
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
      status: 'learning',
      intervalDays: 1,
      lastReviewedAt: null,
      nextDueAt: word.availableAt,
      easeFactor: 2.5,
    },
    {
      id: `${word.id}-reverse`,
      wordId: word.id,
      direction: 'reverse',
      status: 'learning',
      intervalDays: 1,
      lastReviewedAt: null,
      nextDueAt: word.availableAt,
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
