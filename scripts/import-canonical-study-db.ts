import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type StudyWord = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  examples: string[];
  status: 'unstudied' | 'learning' | 'review';
  priority: number;
  createdAt: string;
  learningStreak: number;
  lastLearningSuccessOn: string | null;
  lastLearningCoveredOn: string | null;
};

type StudyImportArtifact = {
  meta: {
    reviewItemDefaults: {
      directions: Array<'forward' | 'reverse'>;
      intervalHours: number;
      lastReviewedAt: string | null;
      nextDueAt: string | null;
      easeFactor: number;
    };
  };
  words: StudyWord[];
};

const cwd = process.cwd();
const inputPath = path.resolve(cwd, process.argv[2] ?? 'data/canonical-study-import.json');
const dbPath = path.resolve(cwd, process.argv[3] ?? 'data/canonical-study.db');
const dbDir = path.dirname(dbPath);

const artifact = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as StudyImportArtifact;

fs.mkdirSync(dbDir, { recursive: true });

if (fs.existsSync(dbPath)) {
  const backupPath = `${dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.renameSync(dbPath, backupPath);
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
  for (const word of artifact.words) {
    insertWord.run(
      word.id,
      word.hanzi,
      word.traditional,
      word.pinyin,
      word.meaning,
      JSON.stringify(word.examples),
      word.status,
      word.priority,
      word.createdAt,
      word.learningStreak,
      word.lastLearningSuccessOn,
      word.lastLearningCoveredOn,
    );

    for (const direction of artifact.meta.reviewItemDefaults.directions) {
      insertReviewItem.run(
        `${word.id}-${direction}`,
        word.id,
        direction,
        artifact.meta.reviewItemDefaults.intervalHours,
        artifact.meta.reviewItemDefaults.lastReviewedAt,
        artifact.meta.reviewItemDefaults.nextDueAt,
        artifact.meta.reviewItemDefaults.easeFactor,
      );
    }
  }

  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}

console.log(
  JSON.stringify(
    {
      dbPath,
      wordCount: artifact.words.length,
      reviewItemCount: artifact.words.length * artifact.meta.reviewItemDefaults.directions.length,
    },
    null,
    2,
  ),
);
