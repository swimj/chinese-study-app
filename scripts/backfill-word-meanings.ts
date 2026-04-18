import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJoinKey } from './lib/canonical-words.ts';

type CorpusWord = {
  id: string;
  hanzi: string;
  pinyinDisplay: string;
  meanings: string[];
};

type CanonicalCorpus = {
  words: CorpusWord[];
};

type ReviewPatchRecord = {
  hanzi: string;
  pinyin: string;
  meanings: string[];
};

type ReviewPatchFile = {
  records: ReviewPatchRecord[];
};

type DbWordRow = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
};

const cwd = process.cwd();
const dbPath = path.resolve(cwd, process.argv[2] ?? 'data/canonical-study-pristine.db');
const corpusPath = path.resolve(cwd, process.argv[3] ?? 'data/canonical-corpus.json');
const patchPath = path.resolve(cwd, process.argv[4] ?? 'data/hack-chinese-migration-v2.json');
const reportPath = path.resolve(cwd, process.argv[5] ?? 'data/word-meanings-backfill-report.json');

if (!fs.existsSync(dbPath)) {
  throw new Error(`Database not found at ${dbPath}`);
}

const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as CanonicalCorpus;
const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8')) as ReviewPatchFile;

const backupPath = `${dbPath}.backup-before-meanings-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(dbPath, backupPath);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

ensureMeaningsJsonColumn(db);

const words = db.prepare(`SELECT id, hanzi, pinyin, meaning FROM words`).all() as DbWordRow[];

const corpusById = new Map<string, string[]>();
const corpusByJoinKey = new Map<string, string[]>();
for (const word of corpus.words) {
  corpusById.set(word.id, word.meanings);
  corpusByJoinKey.set(canonicalJoinKey(word.hanzi, word.pinyinDisplay), word.meanings);
}

const patchByJoinKey = new Map<string, string[]>();
for (const record of patch.records) {
  patchByJoinKey.set(canonicalJoinKey(record.hanzi, record.pinyin), record.meanings);
}

const updateWord = db.prepare(`
  UPDATE words
  SET meaning = ?, meanings_json = ?
  WHERE id = ?
`);

let updatedFromCorpusId = 0;
let updatedFromCorpusJoinKey = 0;
let updatedFromPatch = 0;
let fallbackToExistingMeaning = 0;

db.exec('BEGIN');

try {
  for (const word of words) {
    const corpusMeaningsById = corpusById.get(word.id);
    const corpusMeaningsByJoinKey = corpusByJoinKey.get(canonicalJoinKey(word.hanzi, word.pinyin));
    const patchMeanings = patchByJoinKey.get(canonicalJoinKey(word.hanzi, word.pinyin));

    let meanings: string[];

    if (corpusMeaningsById && corpusMeaningsById.length > 0) {
      meanings = corpusMeaningsById;
      updatedFromCorpusId += 1;
    } else if (corpusMeaningsByJoinKey && corpusMeaningsByJoinKey.length > 0) {
      meanings = corpusMeaningsByJoinKey;
      updatedFromCorpusJoinKey += 1;
    } else if (patchMeanings && patchMeanings.length > 0) {
      meanings = patchMeanings;
      updatedFromPatch += 1;
    } else {
      meanings = [word.meaning];
      fallbackToExistingMeaning += 1;
    }

    updateWord.run(meanings.join('; '), JSON.stringify(meanings), word.id);
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
      corpusPath,
      patchPath,
      wordCount: words.length,
      updatedFromCorpusId,
      updatedFromCorpusJoinKey,
      updatedFromPatch,
      fallbackToExistingMeaning,
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
      wordCount: words.length,
      updatedFromCorpusId,
      updatedFromCorpusJoinKey,
      updatedFromPatch,
      fallbackToExistingMeaning,
    },
    null,
    2,
  ),
);

function ensureMeaningsJsonColumn(database: DatabaseSync) {
  const columns = database.prepare(`PRAGMA table_info(words)`).all() as Array<{ name: string }>;
  const hasMeaningsJson = columns.some((column) => column.name === 'meanings_json');

  if (!hasMeaningsJson) {
    database.exec(`ALTER TABLE words ADD COLUMN meanings_json TEXT NOT NULL DEFAULT '[]'`);
  }
}
