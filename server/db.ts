import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getAppConfig } from './config.ts';

const config = getAppConfig();
const dbPath = config.dbPath;
const appJsonPath = path.join(config.dataDir, 'app.json');
const dbExistedOnStartup = fs.existsSync(dbPath);

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

type WordStatus = 'unstudied' | 'learning' | 'review';

type Word = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings: string[];
  personalNotes: string;
  examples: string[];
  status: WordStatus;
  priority: number;
  createdAt: string;
  learningStreak: number;
  lastLearningSuccessOn: string | null;
  lastLearningCoveredOn: string | null;
};

type ReviewItem = {
  id: string;
  wordId: string;
  direction: 'forward' | 'reverse';
  intervalHours: number;
  lastReviewedAt: string | null;
  nextDueAt: string | null;
  easeFactor: number;
};

type SessionItemWithWord = {
  reviewItem: ReviewItem;
  word: Word;
};

type ReviewRating = 'forgot' | 'hard' | 'good' | 'easy';
type ReviewPassRating = 'hard' | 'good' | 'easy';

type WordRow = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings_json: string;
  personal_notes: string;
  examples_json: string;
  status: WordStatus;
  priority: number;
  created_at: string;
  learning_streak: number;
  last_learning_success_on: string | null;
  last_learning_covered_on: string | null;
};

type ReviewItemRow = {
  id: string;
  word_id: string;
  direction: ReviewItem['direction'];
  interval_hours: number;
  last_reviewed_at: string | null;
  next_due_at: string | null;
  ease_factor: number;
};

type SeedData = {
  words: Word[];
  reviewItems: ReviewItem[];
};

type HomeOverview = {
  dueReviewItemCount: number;
  pendingLearningWordCount: number;
  newWordIntroCount: number;
  hasSessionWork: boolean;
};

type SessionPayload = {
  items: SessionItemWithWord[];
};

type SessionItemWithWordRow = {
  id: string;
  word_id: string;
  direction: ReviewItem['direction'];
  interval_hours: number;
  last_reviewed_at: string | null;
  next_due_at: string | null;
  ease_factor: number;
  word_hanzi: string;
  word_traditional: string | null;
  word_pinyin: string;
  word_meaning: string;
  word_meanings_json: string;
  word_personal_notes: string;
  word_examples_json: string;
  word_status: WordStatus;
  word_priority: number;
  word_created_at: string;
  word_learning_streak: number;
  word_last_learning_success_on: string | null;
  word_last_learning_covered_on: string | null;
};

let db = openDatabase(dbPath);
const DAILY_NEW_WORD_LIMIT = 2;
const INITIAL_REVIEW_EASE_FACTOR = 2.5;

initializeDatabase();

export type {
  HomeOverview,
  ReviewItem,
  ReviewPassRating,
  ReviewRating,
  SessionItemWithWord,
  SessionPayload,
  Word,
  WordStatus,
};
export { config as dbConfig };

export function getWords(): Word[] {
  const rows = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      ORDER BY priority DESC, created_at ASC
    `)
    .all() as WordRow[];

  return rows.map(mapWordRow);
}

export function updateWordPersonalNotes(wordId: string, personalNotes: string): Word {
  const existingWord = db
    .prepare(`
      SELECT
        id
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as { id: string } | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  db.prepare(`
    UPDATE words
    SET personal_notes = ?
    WHERE id = ?
  `).run(personalNotes, wordId);

  const updatedWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow;

  return mapWordRow(updatedWord);
}

export function getSessionItems(): ReviewItem[] {
  return getSessionItemsWithWords().map((item) => item.reviewItem);
}

export function getSessionPayload(): SessionPayload {
  return {
    items: getSessionItemsWithWords(),
  };
}

export function getReviewItems(): ReviewItem[] {
  const rows = db
    .prepare(`
      SELECT
        id,
        word_id,
        direction,
        interval_hours,
        last_reviewed_at,
        next_due_at,
        ease_factor
      FROM review_items
      ORDER BY next_due_at ASC
    `)
    .all() as ReviewItemRow[];

  return rows.map(mapReviewItemRow);
}

export function getWordStatusCounts(): Record<WordStatus, number> {
  const rows = db
    .prepare(`
      SELECT status, COUNT(*) as count
      FROM words
      GROUP BY status
    `)
    .all() as Array<{ status: WordStatus; count: number }>;

  const counts: Record<WordStatus, number> = {
    unstudied: 0,
    learning: 0,
    review: 0,
  };

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return counts;
}

export function getHomeOverview(): HomeOverview {
  const dueReviewItemCount = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'review'
        AND review_items.next_due_at IS NOT NULL
        AND review_items.next_due_at <= ?
    `)
    .get(new Date().toISOString()) as { count: number };

  const pendingLearningWordCount = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM words
      WHERE status = 'learning'
        AND (last_learning_covered_on IS NULL OR last_learning_covered_on != ?)
    `)
    .get(getTodayKey()) as { count: number };

  const newWordIntroCount = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM (
        SELECT id
        FROM words
        WHERE status = 'unstudied'
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      )
    `)
    .get(DAILY_NEW_WORD_LIMIT) as { count: number };

  return {
    dueReviewItemCount: dueReviewItemCount.count,
    pendingLearningWordCount: pendingLearningWordCount.count,
    newWordIntroCount: newWordIntroCount.count,
    hasSessionWork:
      dueReviewItemCount.count > 0 ||
      pendingLearningWordCount.count > 0 ||
      newWordIntroCount.count > 0,
  };
}

// what is this used for / when was it added?
export function getLearningPolicy() {
  return {
    dailyNewWordLimit: DAILY_NEW_WORD_LIMIT,
    learningCoverageDate: getTodayKey(),
  };
}

export function completeUnstudiedWordSession(wordId: string): Word {
  const existingWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  if (existingWord.status !== 'unstudied') {
    throw new Error('Expected unstudied word');
  }

  if (
    existingWord.learning_streak !== 0 ||
    existingWord.last_learning_success_on !== null ||
    existingWord.last_learning_covered_on !== null
  ) {
    throw new Error('Unstudied word has unexpected learning progress');
  }

  const today = getTodayKey();

  db.prepare(`
    UPDATE words
    SET status = 'learning',
        learning_streak = 0,
        last_learning_success_on = NULL,
        last_learning_covered_on = ?
    WHERE id = ?
  `).run(today, wordId);

  const updatedWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow;

  return mapWordRow(updatedWord);
}

export function completeReviewItemSession(
  reviewItemId: string,
  failureCount: number,
  terminalRating: ReviewPassRating | null,
): ReviewItem {
  const existingRow = db
    .prepare(`
      SELECT
        id,
        word_id,
        direction,
        interval_hours,
        last_reviewed_at,
        next_due_at,
        ease_factor
      FROM review_items
      WHERE id = ?
    `)
    .get(reviewItemId) as ReviewItemRow | undefined;

  if (!existingRow) {
    throw new Error('Review item not found');
  }

  const currentItem = mapReviewItemRow(existingRow);
  const updatedItem = scheduleReviewItemFromSession(currentItem, failureCount, terminalRating);

  db.prepare(`
    UPDATE review_items
    SET interval_hours = ?,
        last_reviewed_at = ?,
        next_due_at = ?,
        ease_factor = ?
    WHERE id = ?
  `).run(
    updatedItem.intervalHours,
    updatedItem.lastReviewedAt,
    updatedItem.nextDueAt,
    updatedItem.easeFactor,
    updatedItem.id,
  );

  return updatedItem;
}

export function completeLearningWordSession(wordId: string, success: boolean): Word {
  const existingWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  const today = getTodayKey();
  const nextLearningStreak = success ? existingWord.learning_streak + 1 : 0;
  const nextStatus: WordStatus = nextLearningStreak >= 3 ? 'review' : 'learning';

  db.prepare(`
    UPDATE words
    SET status = ?,
        learning_streak = ?,
        last_learning_success_on = ?,
        last_learning_covered_on = ?
    WHERE id = ?
  `).run(
    nextStatus,
    nextLearningStreak,
    success ? today : existingWord.last_learning_success_on,
    today,
    wordId,
  );

  if (nextStatus === 'review') {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE review_items
      SET interval_hours = 24,
          last_reviewed_at = ?,
          next_due_at = ?,
          ease_factor = ?
      WHERE word_id = ?
    `).run(now, addHours(now, 24), INITIAL_REVIEW_EASE_FACTOR, wordId);
  }

  const updatedWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow;

  return mapWordRow(updatedWord);
}

function initializeDatabase() {
  if (!dbExistedOnStartup) {
    createSchema();
    seedDatabase();
    return;
  }

  try {
    applyLightweightSchemaMigrations();
    validateSchema();
    ensureIndexes();
    seedEmptyDevDatabase();
  } catch (error) {
    if (!shouldRebuildDevDatabase(error)) {
      throw error;
    }

    rebuildDevDatabase(error);
  }
}

function openDatabase(targetPath: string) {
  const database = new DatabaseSync(targetPath);
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

function applyLightweightSchemaMigrations() {
  const wordColumns = db.prepare(`PRAGMA table_info(words)`).all() as Array<{ name: string }>;
  const hasWordsTable = wordColumns.length > 0;

  if (!hasWordsTable) {
    return;
  }

  const hasMeaningsJson = wordColumns.some((column) => column.name === 'meanings_json');
  if (!hasMeaningsJson) {
    db.exec(`ALTER TABLE words ADD COLUMN meanings_json TEXT NOT NULL DEFAULT '[]'`);
  }

  const hasPersonalNotes = wordColumns.some((column) => column.name === 'personal_notes');
  if (!hasPersonalNotes) {
    db.exec(`ALTER TABLE words ADD COLUMN personal_notes TEXT NOT NULL DEFAULT ''`);
  }
}

function shouldRebuildDevDatabase(error: unknown) {
  if (config.mode !== 'dev') {
    return false;
  }

  return error instanceof Error && error.message.startsWith(`Database at ${dbPath} `);
}

function rebuildDevDatabase(error: unknown) {
  const backupPath = path.join(
    config.dataDir,
    `app.db.invalid-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );

  db.close();

  if (fs.existsSync(dbPath)) {
    fs.renameSync(dbPath, backupPath);
  }

  console.warn(
    [
      `Dev database at ${dbPath} is invalid; rebuilding it from seed data.`,
      error instanceof Error ? error.message : String(error),
      `Original file backed up to ${backupPath}.`,
    ].join(' '),
  );

  db = openDatabase(dbPath);
  createSchema();
  seedDatabase();
}

function seedEmptyDevDatabase() {
  if (!config.seedSampleData) {
    return;
  }

  const counts = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM words) AS word_count,
        (SELECT COUNT(*) FROM review_items) AS review_item_count
    `)
    .get() as { word_count: number; review_item_count: number };

  if (counts.word_count === 0 && counts.review_item_count === 0) {
    seedDatabase();
  }
}

function createSchema() {
  db.exec(`
    CREATE TABLE words (
      id TEXT PRIMARY KEY,
      hanzi TEXT NOT NULL,
      traditional TEXT,
      pinyin TEXT NOT NULL,
      meaning TEXT NOT NULL,
      meanings_json TEXT NOT NULL DEFAULT '[]',
      personal_notes TEXT NOT NULL DEFAULT '',
      examples_json TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      learning_streak INTEGER NOT NULL DEFAULT 0,
      last_learning_success_on TEXT,
      last_learning_covered_on TEXT
    );

    CREATE TABLE review_items (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      interval_hours INTEGER NOT NULL,
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
    'traditional',
    'pinyin',
    'meaning',
    'meanings_json',
    'personal_notes',
    'examples_json',
    'status',
    'priority',
    'created_at',
    'learning_streak',
    'last_learning_success_on',
    'last_learning_covered_on',
  ]);
  assertTableColumns('review_items', [
    'id',
    'word_id',
    'direction',
    'interval_hours',
    'last_reviewed_at',
    'next_due_at',
    'ease_factor',
  ]);
}

function assertTableColumns(tableName: string, expectedColumns: string[]) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const availableColumns = new Set(rows.map((row) => row.name));

  if (availableColumns.size === 0) {
    throw new Error(`Database at ${dbPath} is missing the required "${tableName}" table.`);
  }

  for (const column of expectedColumns) {
    if (!availableColumns.has(column)) {
      throw new Error(
        `Database at ${dbPath} has an incompatible "${tableName}" table. Missing column "${column}". Reset the dev database or create a fresh study database under the new schema.`,
      );
    }
  }
}

function seedDatabase() {
  if (!config.seedSampleData) {
    return;
  }

  const seedData = readSeedData() ?? buildSampleSeedData();

  const insertWord = db.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      traditional,
      pinyin,
      meaning,
      meanings_json,
      personal_notes,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertReviewItem = db.prepare(`
    INSERT INTO review_items (
      id,
      word_id,
      direction,
      interval_hours,
      last_reviewed_at,
      next_due_at,
      ease_factor
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');

  try {
    for (const word of seedData.words) {
      insertWord.run(
        word.id,
        word.hanzi,
        word.traditional,
        word.pinyin,
        word.meaning,
        JSON.stringify(word.meanings),
        word.personalNotes,
        JSON.stringify(word.examples),
        word.status,
        word.priority,
        word.createdAt,
        word.learningStreak,
        word.lastLearningSuccessOn,
        word.lastLearningCoveredOn,
      );
    }

    for (const reviewItem of seedData.reviewItems) {
      insertReviewItem.run(
        reviewItem.id,
        reviewItem.wordId,
        reviewItem.direction,
        reviewItem.intervalHours,
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

function readSeedData(): SeedData | null {
  if (!fs.existsSync(appJsonPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')) as Partial<SeedData>;

  if (!Array.isArray(parsed.words) || !Array.isArray(parsed.reviewItems)) {
    return null;
  }

  return {
    words: parsed.words.map(normalizeSeedWord),
    reviewItems: parsed.reviewItems.map(normalizeSeedReviewItem),
  };
}

function normalizeSeedWord(word: Partial<Word>): Word {
  return {
    id: word.id ?? '',
    hanzi: word.hanzi ?? '',
    traditional: word.traditional ?? null,
    pinyin: word.pinyin ?? '',
    meaning: word.meaning ?? '',
    meanings: Array.isArray((word as Partial<Word> & { meanings?: unknown }).meanings)
      ? ((word as Partial<Word> & { meanings?: unknown }).meanings as string[]).filter((meaning) => meaning.trim().length > 0)
      : [word.meaning ?? ''],
    personalNotes: word.personalNotes ?? '',
    examples: Array.isArray(word.examples) ? word.examples : [],
    status: word.status ?? 'unstudied',
    priority: word.priority ?? 0,
    createdAt: word.createdAt ?? new Date().toISOString(),
    learningStreak: word.learningStreak ?? 0,
    lastLearningSuccessOn: word.lastLearningSuccessOn ?? null,
    lastLearningCoveredOn: word.lastLearningCoveredOn ?? null,
  };
}

function normalizeSeedReviewItem(reviewItem: Partial<ReviewItem>): ReviewItem {
  return {
    id: reviewItem.id ?? '',
    wordId: reviewItem.wordId ?? '',
    direction: reviewItem.direction === 'reverse' ? 'reverse' : 'forward',
    intervalHours: reviewItem.intervalHours ?? 0,
    lastReviewedAt: reviewItem.lastReviewedAt ?? null,
    nextDueAt: reviewItem.nextDueAt ?? null,
    easeFactor: reviewItem.easeFactor ?? INITIAL_REVIEW_EASE_FACTOR,
  };
}

function buildSampleSeedData(): SeedData {
  const words = buildSampleWords();
  return {
    words,
    reviewItems: buildSampleReviewItems(words),
  };
}

function buildSampleWords(): Word[] {
  const now = new Date().toISOString();
  const today = getTodayKey();

  return [
    {
      id: 'word-1',
      hanzi: '你好',
      traditional: '你好',
      pinyin: 'nǐ hǎo',
      meaning: 'hello',
      meanings: ['hello'],
      personalNotes: '',
      examples: ['你好！你今天怎么样？'],
      status: 'review',
      priority: 100,
      createdAt: now,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    },
    {
      id: 'word-2',
      hanzi: '谢谢',
      traditional: '謝謝',
      pinyin: 'xiè xie',
      meaning: 'thank you',
      meanings: ['thank you'],
      personalNotes: '',
      examples: ['谢谢你的帮助。'],
      status: 'learning',
      priority: 99,
      createdAt: now,
      learningStreak: 1,
      lastLearningSuccessOn: addDaysToDateKey(today, -1),
      lastLearningCoveredOn: null,
    },
    {
      id: 'word-3',
      hanzi: '学习',
      traditional: '學習',
      pinyin: 'xué xí',
      meaning: 'to study',
      meanings: ['to study'],
      personalNotes: '',
      examples: ['我每天学习汉语。'],
      status: 'learning',
      priority: 98,
      createdAt: now,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    },
    {
      id: 'word-4',
      hanzi: '朋友',
      traditional: '朋友',
      pinyin: 'péng you',
      meaning: 'friend',
      meanings: ['friend'],
      personalNotes: '',
      examples: ['她是我的好朋友。'],
      status: 'unstudied',
      priority: 97,
      createdAt: now,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    },
    {
      id: 'word-5',
      hanzi: '说',
      traditional: '說',
      pinyin: 'shuō',
      meaning: 'to speak',
      meanings: ['to speak'],
      personalNotes: '',
      examples: ['你会说中文吗？'],
      status: 'unstudied',
      priority: 96,
      createdAt: now,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    },
  ];
}

function buildSampleReviewItems(words: Word[]): ReviewItem[] {
  const overdueAt = addHours(new Date().toISOString(), -24);
  const learningDueAt = addHours(new Date().toISOString(), -1);

  return words.flatMap((word) => {
    const nextDueAt = word.status === 'unstudied' ? null : word.status === 'review' ? overdueAt : learningDueAt;

    return [
      {
        id: `${word.id}-forward`,
        wordId: word.id,
        direction: 'forward',
        intervalHours: word.status === 'review' ? 48 : 6,
        lastReviewedAt: null,
        nextDueAt,
        easeFactor: INITIAL_REVIEW_EASE_FACTOR,
      },
      {
        id: `${word.id}-reverse`,
        wordId: word.id,
        direction: 'reverse',
        intervalHours: word.status === 'review' ? 36 : 6,
        lastReviewedAt: null,
        nextDueAt,
        easeFactor: INITIAL_REVIEW_EASE_FACTOR,
      },
    ];
  });
}

function mapWordRow(row: WordRow): Word {
  return {
    id: row.id,
    hanzi: row.hanzi,
    traditional: row.traditional,
    pinyin: row.pinyin,
    meaning: row.meaning,
    meanings: parseMeaningsJson(row.meanings_json, row.meaning),
    personalNotes: row.personal_notes,
    examples: JSON.parse(row.examples_json) as string[],
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    learningStreak: row.learning_streak,
    lastLearningSuccessOn: row.last_learning_success_on,
    lastLearningCoveredOn: row.last_learning_covered_on,
  };
}

function mapReviewItemRow(row: ReviewItemRow): ReviewItem {
  return {
    id: row.id,
    wordId: row.word_id,
    direction: row.direction,
    intervalHours: row.interval_hours,
    lastReviewedAt: row.last_reviewed_at,
    nextDueAt: row.next_due_at,
    easeFactor: row.ease_factor,
  };
}

function getSessionItemsWithWords(): SessionItemWithWord[] {
  const now = new Date().toISOString();
  const today = getTodayKey();
  const dueReviewRows = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor,
        words.hanzi AS word_hanzi,
        words.traditional AS word_traditional,
        words.pinyin AS word_pinyin,
        words.meaning AS word_meaning,
        words.meanings_json AS word_meanings_json,
        words.personal_notes AS word_personal_notes,
        words.examples_json AS word_examples_json,
        words.status AS word_status,
        words.priority AS word_priority,
        words.created_at AS word_created_at,
        words.learning_streak AS word_learning_streak,
        words.last_learning_success_on AS word_last_learning_success_on,
        words.last_learning_covered_on AS word_last_learning_covered_on
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'review'
        AND review_items.next_due_at IS NOT NULL
        AND review_items.next_due_at <= ?
      ORDER BY
        CASE review_items.direction
          WHEN 'reverse' THEN 0
          ELSE 1
        END ASC,
        review_items.next_due_at ASC
    `)
    .all(now) as SessionItemWithWordRow[];

  const learningRows = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor,
        words.hanzi AS word_hanzi,
        words.traditional AS word_traditional,
        words.pinyin AS word_pinyin,
        words.meaning AS word_meaning,
        words.meanings_json AS word_meanings_json,
        words.personal_notes AS word_personal_notes,
        words.examples_json AS word_examples_json,
        words.status AS word_status,
        words.priority AS word_priority,
        words.created_at AS word_created_at,
        words.learning_streak AS word_learning_streak,
        words.last_learning_success_on AS word_last_learning_success_on,
        words.last_learning_covered_on AS word_last_learning_covered_on
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'learning'
        AND (words.last_learning_covered_on IS NULL OR words.last_learning_covered_on != ?)
      ORDER BY
        CASE review_items.direction
          WHEN 'reverse' THEN 0
          ELSE 1
        END ASC
    `)
    .all(today) as SessionItemWithWordRow[];

  const unstudiedRows = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor,
        words.hanzi AS word_hanzi,
        words.traditional AS word_traditional,
        words.pinyin AS word_pinyin,
        words.meaning AS word_meaning,
        words.meanings_json AS word_meanings_json,
        words.personal_notes AS word_personal_notes,
        words.examples_json AS word_examples_json,
        words.status AS word_status,
        words.priority AS word_priority,
        words.created_at AS word_created_at,
        words.learning_streak AS word_learning_streak,
        words.last_learning_success_on AS word_last_learning_success_on,
        words.last_learning_covered_on AS word_last_learning_covered_on
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'unstudied'
        AND words.id IN (
          SELECT id
          FROM words
          WHERE status = 'unstudied'
          ORDER BY priority DESC, created_at ASC
          LIMIT ?
        )
      ORDER BY
        words.priority DESC,
        words.created_at ASC,
        CASE review_items.direction
          WHEN 'forward' THEN 0
          ELSE 1
        END ASC
    `)
    .all(DAILY_NEW_WORD_LIMIT) as SessionItemWithWordRow[];

  return [...dueReviewRows, ...learningRows, ...unstudiedRows].map(mapSessionItemWithWordRow);
}

function mapSessionItemWithWordRow(row: SessionItemWithWordRow): SessionItemWithWord {
  return {
    reviewItem: mapReviewItemRow(row),
    word: {
      id: row.word_id,
      hanzi: row.word_hanzi,
      traditional: row.word_traditional,
      pinyin: row.word_pinyin,
      meaning: row.word_meaning,
      meanings: parseMeaningsJson(row.word_meanings_json, row.word_meaning),
      personalNotes: row.word_personal_notes,
      examples: JSON.parse(row.word_examples_json) as string[],
      status: row.word_status,
      priority: row.word_priority,
      createdAt: row.word_created_at,
      learningStreak: row.word_learning_streak,
      lastLearningSuccessOn: row.word_last_learning_success_on,
      lastLearningCoveredOn: row.word_last_learning_covered_on,
    },
  };
}

// Applies the persisted scheduling update for a covered review-item session.
// - `failureCount > 0`: treat as lapse-and-recovery, reset interval to 6h and reduce ease by `0.15 * failureCount` with a floor of `1.8`
// - clean `hard`: multiply interval by `1.5`, then round up to the next whole hour with a minimum of 6h; reduce ease by `0.15`, floor `1.8`
// - clean `good`: multiply interval by current ease, then round up to the next whole hour; ease stays unchanged
// - clean `easy`: multiply interval by `ease + 0.35`, then round up to the next whole hour; ease increases by `0.15`
function scheduleReviewItemFromSession(
  item: ReviewItem,
  failureCount: number,
  terminalRating: ReviewPassRating | null,
): ReviewItem {
  const reviewedAt = new Date().toISOString();

  if (failureCount > 0) {
    const penaltyEase = Math.max(1.8, Number((item.easeFactor - 0.15 * failureCount).toFixed(2)));

    return {
      ...item,
      intervalHours: 6,
      lastReviewedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, 6),
      easeFactor: penaltyEase,
    };
  }

  if (terminalRating === 'hard') {
    const nextInterval = Math.max(6, ceilIntervalHours(item.intervalHours * 1.5));

    return {
      ...item,
      intervalHours: nextInterval,
      lastReviewedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, nextInterval),
      easeFactor: Math.max(1.8, Number((item.easeFactor - 0.15).toFixed(2))),
    };
  }

  if (terminalRating === 'good') {
    const baseInterval = ceilIntervalHours(item.intervalHours * item.easeFactor);

    return {
      ...item,
      intervalHours: baseInterval,
      lastReviewedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, baseInterval),
      easeFactor: Number(item.easeFactor.toFixed(2)),
    };
  }

  if (terminalRating !== 'easy') {
    throw new Error('Expected terminal review rating');
  }

  const nextInterval = ceilIntervalHours(item.intervalHours * (item.easeFactor + 0.35));

  return {
    ...item,
    intervalHours: nextInterval,
    lastReviewedAt: reviewedAt,
    nextDueAt: addHours(reviewedAt, nextInterval),
    easeFactor: Number((item.easeFactor + 0.15).toFixed(2)),
  };
}

function addHours(isoTimestamp: string, hours: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function parseMeaningsJson(raw: string, fallbackMeaning: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  } catch {
    // Fall through to the persisted single-string meaning.
  }

  return fallbackMeaning.trim() ? [fallbackMeaning] : [];
}

function ceilIntervalHours(hours: number) {
  return Math.max(1, Math.ceil(hours));
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}
