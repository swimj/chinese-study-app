import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canMatchByNeutralToneFallback, canonicalJoinKey } from './lib/canonical-words.ts';

type ReviewPatchRecord = {
  hanzi: string;
  pinyin: string;
  intervalDays: number;
  lastReviewedAt: string;
  nextDueAt: string;
};

type ReviewPatchFile = {
  records: ReviewPatchRecord[];
};

type WordRow = {
  id: string;
  hanzi: string;
  pinyin: string;
};

const cwd = process.cwd();
const dbPath = path.resolve(cwd, process.argv[2] ?? 'data/canonical-study.db');
const patchPath = path.resolve(cwd, process.argv[3] ?? 'data/hack-chinese-migration-v2.json');
const reportPath = path.resolve(cwd, process.argv[4] ?? 'data/hack-chinese-review-patch-report.json');

if (!fs.existsSync(dbPath)) {
  throw new Error(`Database not found at ${dbPath}`);
}

const patchFile = JSON.parse(fs.readFileSync(patchPath, 'utf8')) as ReviewPatchFile;
const backupPath = `${dbPath}.backup-before-review-patch-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(dbPath, backupPath);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

const words = db
  .prepare(`SELECT id, hanzi, pinyin FROM words`)
  .all() as WordRow[];

const exactMap = new Map<string, WordRow>();
const hanziMap = new Map<string, WordRow[]>();

for (const word of words) {
  exactMap.set(canonicalJoinKey(word.hanzi, word.pinyin), word);
  const group = hanziMap.get(word.hanzi) ?? [];
  group.push(word);
  hanziMap.set(word.hanzi, group);
}

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

const exactMatches: Array<{ hanzi: string; pinyin: string; wordId: string }> = [];
const fallbackMatches: Array<{ hanzi: string; pinyin: string; wordId: string; matchedPinyin: string }> = [];
const ambiguous: Array<{ hanzi: string; pinyin: string; candidates: string[] }> = [];
const unmatched: Array<{ hanzi: string; pinyin: string }> = [];

db.exec('BEGIN');

try {
  for (const record of patchFile.records) {
    const exact = exactMap.get(canonicalJoinKey(record.hanzi, record.pinyin));

    if (exact) {
      applyPatch(updateWord, updateReviewItems, exact.id, record);
      exactMatches.push({ hanzi: record.hanzi, pinyin: record.pinyin, wordId: exact.id });
      continue;
    }

    const sameHanzi = hanziMap.get(record.hanzi) ?? [];
    const fallbackCandidates = sameHanzi.filter((candidate) =>
      canMatchByNeutralToneFallback(record.pinyin, candidate.pinyin),
    );

    if (fallbackCandidates.length === 1) {
      const candidate = fallbackCandidates[0];
      applyPatch(updateWord, updateReviewItems, candidate.id, record);
      fallbackMatches.push({
        hanzi: record.hanzi,
        pinyin: record.pinyin,
        wordId: candidate.id,
        matchedPinyin: candidate.pinyin,
      });
      continue;
    }

    if (fallbackCandidates.length > 1) {
      ambiguous.push({
        hanzi: record.hanzi,
        pinyin: record.pinyin,
        candidates: fallbackCandidates.map((candidate) => candidate.pinyin).sort(),
      });
      continue;
    }

    unmatched.push({ hanzi: record.hanzi, pinyin: record.pinyin });
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
      backupPath,
      patchPath,
      exactMatchCount: exactMatches.length,
      fallbackMatchCount: fallbackMatches.length,
      ambiguousCount: ambiguous.length,
      unmatchedCount: unmatched.length,
      sampleFallbackMatches: fallbackMatches.slice(0, 20),
      sampleAmbiguous: ambiguous.slice(0, 20),
      sampleUnmatched: unmatched.slice(0, 20),
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      dbPath,
      backupPath,
      reportPath,
      exactMatchCount: exactMatches.length,
      fallbackMatchCount: fallbackMatches.length,
      ambiguousCount: ambiguous.length,
      unmatchedCount: unmatched.length,
    },
    null,
    2,
  ),
);

function applyPatch(
  updateWord: ReturnType<DatabaseSync['prepare']>,
  updateReviewItems: ReturnType<DatabaseSync['prepare']>,
  wordId: string,
  record: ReviewPatchRecord,
) {
  updateWord.run(wordId);
  updateReviewItems.run(Math.max(1, Math.round(record.intervalDays * 24)), record.lastReviewedAt, record.nextDueAt, wordId);
}
