import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJoinKey, makeCanonicalWordId } from './lib/canonical-words.ts';

type ReviewPatchRecord = {
  id: string;
  hanzi: string;
  pinyin: string;
  meanings: string[];
  intervalDays: number;
  lastReviewedAt: string;
  nextDueAt: string;
};

type ReviewPatchFile = {
  records: ReviewPatchRecord[];
};

type CuratedWord = {
  hanzi: string;
  pinyin: string;
};

type WordRow = {
  id: string;
  hanzi: string;
  pinyin: string;
};

const cwd = process.cwd();
const dbPath = path.resolve(cwd, process.argv[2] ?? 'data/canonical-study.db');
const curatedPath = path.resolve(cwd, process.argv[3] ?? 'data/hack-chinese-review-unmatched.md');
const patchPath = path.resolve(cwd, process.argv[4] ?? 'data/hack-chinese-migration-v2.json');
const reportPath = path.resolve(cwd, process.argv[5] ?? 'data/hack-chinese-curated-unmatched-import-report.json');

if (!fs.existsSync(dbPath)) {
  throw new Error(`Database not found at ${dbPath}`);
}

if (!fs.existsSync(curatedPath)) {
  throw new Error(`Curated markdown not found at ${curatedPath}`);
}

const curatedWords = parseCuratedMarkdown(fs.readFileSync(curatedPath, 'utf8'));
const patchFile = JSON.parse(fs.readFileSync(patchPath, 'utf8')) as ReviewPatchFile;
const patchMap = new Map<string, ReviewPatchRecord>();

for (const record of patchFile.records) {
  patchMap.set(canonicalJoinKey(record.hanzi, record.pinyin), record);
}

const backupPath = `${dbPath}.backup-before-curated-import-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(dbPath, backupPath);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

const existingWords = db.prepare(`SELECT id, hanzi, pinyin FROM words`).all() as WordRow[];
const existingMap = new Map<string, WordRow>();

for (const word of existingWords) {
  existingMap.set(canonicalJoinKey(word.hanzi, word.pinyin), word);
}

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

const updateWord = db.prepare(`
  UPDATE words
  SET status = 'review',
      learning_streak = 0,
      last_learning_success_on = NULL,
      last_learning_covered_on = NULL
  WHERE id = ?
`);

const updateReviewItems = db.prepare(`
  UPDATE review_items
  SET interval_hours = ?,
      last_reviewed_at = ?,
      next_due_at = ?,
      ease_factor = 2.5
  WHERE word_id = ?
`);

const inserted: Array<{ hanzi: string; pinyin: string; wordId: string }> = [];
const updatedExisting: Array<{ hanzi: string; pinyin: string; wordId: string }> = [];
const missingInPatch: Array<{ hanzi: string; pinyin: string }> = [];

db.exec('BEGIN');

try {
  for (const curatedWord of curatedWords) {
    const key = canonicalJoinKey(curatedWord.hanzi, curatedWord.pinyin);
    const patchRecord = patchMap.get(key);

    if (!patchRecord) {
      missingInPatch.push(curatedWord);
      continue;
    }

    const existing = existingMap.get(key);

    if (existing) {
      applyReviewState(updateWord, updateReviewItems, existing.id, patchRecord);
      updatedExisting.push({ hanzi: curatedWord.hanzi, pinyin: curatedWord.pinyin, wordId: existing.id });
      continue;
    }

    const wordId = makeCanonicalWordId(curatedWord.hanzi, curatedWord.pinyin);
    const meaning = patchRecord.meanings.join('; ');
    const createdAt = new Date().toISOString();

    insertWord.run(
      wordId,
      curatedWord.hanzi,
      null,
      curatedWord.pinyin,
      meaning,
      '[]',
      'review',
      0,
      createdAt,
      0,
      null,
      null,
    );

    const intervalHours = Math.max(1, Math.round(patchRecord.intervalDays * 24));

    for (const direction of ['forward', 'reverse'] as const) {
      insertReviewItem.run(
        `${wordId}-${direction}`,
        wordId,
        direction,
        intervalHours,
        patchRecord.lastReviewedAt,
        patchRecord.nextDueAt,
        2.5,
      );
    }

    existingMap.set(key, { id: wordId, hanzi: curatedWord.hanzi, pinyin: curatedWord.pinyin });
    inserted.push({ hanzi: curatedWord.hanzi, pinyin: curatedWord.pinyin, wordId });
  }

  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}

fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      dbPath,
      curatedPath,
      patchPath,
      backupPath,
      curatedCount: curatedWords.length,
      insertedCount: inserted.length,
      updatedExistingCount: updatedExisting.length,
      missingInPatchCount: missingInPatch.length,
      inserted,
      updatedExisting,
      missingInPatch,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      dbPath,
      curatedPath,
      reportPath,
      backupPath,
      curatedCount: curatedWords.length,
      insertedCount: inserted.length,
      updatedExistingCount: updatedExisting.length,
      missingInPatchCount: missingInPatch.length,
    },
    null,
    2,
  ),
);

function parseCuratedMarkdown(markdown: string): CuratedWord[] {
  const words: CuratedWord[] = [];
  let inUnmatchedSection = false;

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();

    if (line === '## Unmatched') {
      inUnmatchedSection = true;
      continue;
    }

    if (line.startsWith('## ') && line !== '## Unmatched') {
      inUnmatchedSection = false;
    }

    if (!inUnmatchedSection || !line.startsWith('|')) {
      continue;
    }

    if (line.includes('| Hanzi | Pinyin |') || line.includes('| --- |')) {
      continue;
    }

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 3) {
      continue;
    }

    const hanzi = cells[1];
    const pinyin = cells[2];

    if (!hanzi || !pinyin) {
      continue;
    }

    words.push({ hanzi, pinyin });
  }

  return words;
}

function applyReviewState(
  updateWord: ReturnType<DatabaseSync['prepare']>,
  updateReviewItems: ReturnType<DatabaseSync['prepare']>,
  wordId: string,
  patchRecord: ReviewPatchRecord,
) {
  updateWord.run(wordId);
  updateReviewItems.run(
    Math.max(1, Math.round(patchRecord.intervalDays * 24)),
    patchRecord.lastReviewedAt,
    patchRecord.nextDueAt,
    wordId,
  );
}
