import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type MigrationRecord = {
  id: string;
  hanzi: string;
  traditional?: string | null;
  pinyin: string;
  meanings: string[];
  intervalDays: number;
  lastReviewedAt: string;
  nextDueAt: string;
};

type MigrationFile = {
  meta: {
    snapshotAt: string;
  };
  records: MigrationRecord[];
};

const cwd = process.cwd();
const dataDir = path.resolve(cwd, 'data');
const dbPath = path.join(dataDir, 'app.db');
const appJsonPath = path.join(dataDir, 'app.json');
const migrationPath = path.join(dataDir, 'hack-chinese-migration-v2.json');
const fixtureSizeArg = process.argv[2] ?? '10';
const fixtureSize = Number.parseInt(fixtureSizeArg, 10);

if (!Number.isInteger(fixtureSize) || fixtureSize <= 0) {
  throw new Error(`Fixture size must be a positive integer, received: ${fixtureSizeArg}`);
}

const migration = JSON.parse(fs.readFileSync(migrationPath, 'utf8')) as MigrationFile;
const snapshotAt = new Date(migration.meta.snapshotAt).toISOString();
const dueRecords = migration.records
  .filter((record) => new Date(record.nextDueAt).getTime() <= new Date(snapshotAt).getTime())
  .sort((a, b) => new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime())
  .slice(0, fixtureSize);

if (dueRecords.length === 0) {
  throw new Error('No due records found in the migration file.');
}

fs.mkdirSync(dataDir, { recursive: true });

if (fs.existsSync(dbPath)) {
  const backupPath = path.join(
    dataDir,
    `app.db.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.renameSync(dbPath, backupPath);
}

if (fs.existsSync(appJsonPath)) {
  const backupPath = path.join(
    dataDir,
    `app.json.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.renameSync(appJsonPath, backupPath);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE words (
    id TEXT PRIMARY KEY,
    hanzi TEXT NOT NULL,
    traditional TEXT,
    pinyin TEXT NOT NULL,
    meaning TEXT NOT NULL,
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

  CREATE INDEX idx_words_priority ON words(priority DESC, created_at ASC);
  CREATE INDEX idx_review_items_due ON review_items(next_due_at ASC);
`);

const insertWord = db.prepare(`
  INSERT INTO words (
    id,
    hanzi,
    traditional,
    pinyin,
    meaning,
    examples_json,
    status,
    priority,
    created_at,
    learning_streak,
    last_learning_success_on,
    last_learning_covered_on
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  dueRecords.forEach((record, index) => {
    insertWord.run(
      record.id,
      record.hanzi,
      record.traditional ?? null,
      record.pinyin,
      record.meanings.join('; '),
      JSON.stringify([]),
      'review',
      fixtureSize - index,
      snapshotAt,
      0,
      null,
      null,
    );

    ['forward', 'reverse'].forEach((direction) => {
      insertReviewItem.run(
        `${record.id}-${direction}`,
        record.id,
        direction,
        Math.max(1, Math.round(record.intervalDays * 24)),
        record.lastReviewedAt,
        record.nextDueAt,
        2.5,
      );
    });
  });

  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}

const seedWords = dueRecords.map((record, index) => ({
  id: record.id,
  hanzi: record.hanzi,
  traditional: record.traditional ?? null,
  pinyin: record.pinyin,
  meaning: record.meanings.join('; '),
  examples: [],
  status: 'review',
  priority: fixtureSize - index,
  createdAt: snapshotAt,
  learningStreak: 0,
  lastLearningSuccessOn: null,
  lastLearningCoveredOn: null,
}));

const seedReviewItems = dueRecords.flatMap((record) =>
  ['forward', 'reverse'].map((direction) => ({
    id: `${record.id}-${direction}`,
    wordId: record.id,
    direction,
    intervalHours: Math.max(1, Math.round(record.intervalDays * 24)),
    lastReviewedAt: record.lastReviewedAt,
    nextDueAt: record.nextDueAt,
    easeFactor: 2.5,
  })),
);

fs.writeFileSync(
  appJsonPath,
  JSON.stringify(
    {
      words: seedWords,
      reviewItems: seedReviewItems,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      dbPath,
      appJsonPath,
      snapshotAt,
      insertedWordCount: dueRecords.length,
      insertedReviewItemCount: dueRecords.length * 2,
      words: dueRecords.map((record) => ({
        hanzi: record.hanzi,
        pinyin: record.pinyin,
        nextDueAt: record.nextDueAt,
      })),
    },
    null,
    2,
  ),
);
