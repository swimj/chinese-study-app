import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type CanonicalWord = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyinDisplay: string;
  meaning: string;
  meanings: string[];
  priority: number | null;
};

type CanonicalCorpus = {
  words: CanonicalWord[];
};

type Options = {
  inputPath: string;
  dataDir: string;
  force: boolean;
};

const options = parseOptions(process.argv.slice(2));
const dbPath = path.join(options.dataDir, 'app.db');
const generatedAt = new Date().toISOString();

if (!fs.existsSync(options.inputPath)) {
  throw new Error(`Canonical corpus not found: ${options.inputPath}`);
}

if (fs.existsSync(dbPath)) {
  if (!options.force) {
    throw new Error(`Refusing to overwrite existing database at ${dbPath}. Pass --force to rebuild it.`);
  }

  fs.rmSync(dbPath);
}

fs.mkdirSync(options.dataDir, { recursive: true });

process.env.APP_MODE = 'study';
process.env.APP_STUDY_PROFILE = 'mandarin';
process.env.APP_DATA_DIR = options.dataDir;

await import(`../server/db.ts?friend-mandarin-db=${Date.now()}`);

const corpus = JSON.parse(fs.readFileSync(options.inputPath, 'utf8')) as CanonicalCorpus;
const database = new DatabaseSync(dbPath);

database.exec('PRAGMA foreign_keys = ON;');
database.exec('BEGIN');

try {
  const insertWord = database.prepare(`
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
    VALUES (?, ?, ?, ?, ?, ?, '', '[]', 'unstudied', ?, ?, 0, NULL, NULL)
  `);

  const insertWordMeaning = database.prepare(`
    INSERT INTO word_meanings (
      id,
      word_id,
      position,
      text,
      show_on_production_prompt,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);

  const insertMetadata = database.prepare(`
    INSERT INTO app_metadata (
      key,
      value,
      updated_at
    )
    VALUES (?, ?, ?)
  `);

  for (const word of corpus.words) {
    const meanings = normalizeMeanings(word);
    insertWord.run(
      word.id,
      word.hanzi,
      word.traditional,
      word.pinyinDisplay,
      meanings.join('; '),
      JSON.stringify(meanings),
      word.priority ?? 1,
      generatedAt,
    );

    for (const [index, meaning] of meanings.entries()) {
      insertWordMeaning.run(
        `${word.id}-meaning-${index + 1}`,
        word.id,
        index,
        meaning,
        generatedAt,
        generatedAt,
      );
    }
  }

  insertMetadata.run('friend_mandarin_db_generated_at', generatedAt, generatedAt);
  insertMetadata.run('friend_mandarin_db_source', path.relative(process.cwd(), options.inputPath), generatedAt);
  insertMetadata.run('friend_mandarin_db_word_count', String(corpus.words.length), generatedAt);

  database.exec('COMMIT');
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
} finally {
  database.close();
}

console.log(
  JSON.stringify(
    {
      dbPath,
      sourcePath: options.inputPath,
      wordCount: corpus.words.length,
      generatedAt,
    },
    null,
    2,
  ),
);

function parseOptions(args: string[]): Options {
  let inputPath = 'data/canonical-corpus.json';
  let dataDir = 'data/friend-mandarin-user-data';
  let force = false;

  for (const arg of args) {
    if (arg === '--force') {
      force = true;
    } else if (arg.startsWith('--input=')) {
      inputPath = arg.slice('--input='.length);
    } else if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length);
    } else {
      throw new Error(`Unknown argument "${arg}". Expected --force, --input=PATH, or --data-dir=DIR.`);
    }
  }

  return {
    inputPath: path.resolve(inputPath),
    dataDir: path.resolve(dataDir),
    force,
  };
}

function normalizeMeanings(word: CanonicalWord): string[] {
  const meanings = Array.isArray(word.meanings)
    ? word.meanings.map((meaning) => meaning.trim()).filter(Boolean)
    : [];

  const fallback = word.meaning.trim();
  return meanings.length > 0 ? meanings : [fallback];
}
