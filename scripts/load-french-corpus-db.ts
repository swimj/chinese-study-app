import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type FrenchCorpus = {
  meta?: {
    generatedAt?: string;
  };
  words: FrenchCorpusWord[];
};

type FrenchCorpusWord = {
  id: string;
  word: string;
  auxiliary: string;
  meanings: string[];
  priority: number;
  aliases: FrenchCorpusAlias[];
};

type FrenchCorpusAlias = {
  aliasText: string;
  normalizedAlias: string;
  relation: string;
  source: string;
  tags: string[];
};

type SeedWord = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings: string[];
  personalNotes: string;
  examples: string[];
  status: 'unstudied';
  priority: number;
  createdAt: string;
  learningStreak: number;
  lastLearningSuccessOn: null;
  lastLearningCoveredOn: null;
};

type SeedData = {
  meta: {
    generatedAt: string;
    source: string;
    wordCount: number;
    note: string;
  };
  words: SeedWord[];
  wordStudyAdmissionStates: [];
  wordSkillStates: [];
};

const DEFAULT_INPUT_PATH = 'data/french-corpus.json';
const DEFAULT_OUTPUT_DIR = 'data/french-study';

const options = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const inputPath = path.resolve(cwd, options.inputPath ?? DEFAULT_INPUT_PATH);
const outputDir = path.resolve(cwd, options.outputDir ?? DEFAULT_OUTPUT_DIR);
const seedPath = path.join(outputDir, 'app.json');
const dbPath = path.join(outputDir, 'app.db');

async function main() {
  if (fs.existsSync(dbPath) && !options.force) {
    throw new Error(`Refusing to overwrite existing database at ${dbPath}. Pass --force to rebuild it.`);
  }

  const corpus = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as FrenchCorpus;
  validateCorpus(corpus);

  fs.mkdirSync(outputDir, { recursive: true });
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
  }

  const seedData = buildSeedData(corpus);
  fs.writeFileSync(seedPath, `${JSON.stringify(seedData, null, 2)}\n`);

  await createAppDatabaseFromSeed();
  importAliases(corpus);

  console.log(
    JSON.stringify(
      {
        dbPath,
        seedPath,
        wordCount: corpus.words.length,
        aliasCount: corpus.words.reduce((total, word) => total + word.aliases.length, 0),
        usage: {
          backend:
            `node --import tsx server/index.ts --mode=dev --study-profile=french --data-dir=${outputDir} --seed-data=${seedPath}`,
          frontend: 'VITE_STUDY_PROFILE=french npm run dev:frontend',
        },
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]) {
  const parsed: {
    inputPath?: string;
    outputDir?: string;
    force?: boolean;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') {
      parsed.inputPath = readArgValue(args, index);
      index += 1;
    } else if (arg === '--output-dir') {
      parsed.outputDir = readArgValue(args, index);
      index += 1;
    } else if (arg === '--force') {
      parsed.force = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readArgValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Expected value after ${args[index]}`);
  }
  return value;
}

function validateCorpus(corpus: FrenchCorpus) {
  if (!Array.isArray(corpus.words)) {
    throw new Error('Expected French corpus with a words array.');
  }

  const ids = new Set<string>();
  for (const word of corpus.words) {
    if (!word.id || !word.word || !Array.isArray(word.meanings) || !Array.isArray(word.aliases)) {
      throw new Error(`Invalid corpus word: ${JSON.stringify(word)}`);
    }

    if (ids.has(word.id)) {
      throw new Error(`Duplicate corpus word id: ${word.id}`);
    }
    ids.add(word.id);
  }
}

function buildSeedData(corpus: FrenchCorpus): SeedData {
  const generatedAt = new Date().toISOString();
  const seedWords = corpus.words.map((word, index): SeedWord => {
    const meanings = word.meanings.map((meaning) => meaning.trim()).filter(Boolean);
    const createdAt = new Date(Date.parse(generatedAt) + index).toISOString();

    return {
      id: word.id,
      hanzi: word.word,
      traditional: null,
      pinyin: word.auxiliary,
      meaning: meanings.join('; '),
      meanings,
      personalNotes: '',
      examples: [],
      status: 'unstudied',
      priority: word.priority,
      createdAt,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    };
  });

  return {
    meta: {
      generatedAt,
      source: inputPath,
      wordCount: seedWords.length,
      note: 'Generated from the French corpus artifact for local backend testing.',
    },
    words: seedWords,
    wordStudyAdmissionStates: [],
    wordSkillStates: [],
  };
}

async function createAppDatabaseFromSeed() {
  const originalArgv = process.argv;
  process.argv = [
    originalArgv[0] ?? 'node',
    originalArgv[1] ?? 'scripts/load-french-corpus-db.ts',
    '--mode=dev',
    `--data-dir=${outputDir}`,
    `--seed-data=${seedPath}`,
  ];

  try {
    await import('../server/db.ts');
  } finally {
    process.argv = originalArgv;
  }
}

function importAliases(corpus: FrenchCorpus) {
  const db = new DatabaseSync(dbPath);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS word_lookup_aliases (
        alias_text TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        relation TEXT NOT NULL,
        source TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (normalized_alias, word_id, source)
      );

      CREATE INDEX IF NOT EXISTS idx_word_lookup_aliases_normalized_alias
        ON word_lookup_aliases(normalized_alias);
    `);

    const now = new Date().toISOString();
    const insertAlias = db.prepare(`
      INSERT INTO word_lookup_aliases (
        alias_text,
        normalized_alias,
        word_id,
        relation,
        source,
        tags_json,
        confidence,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_alias, word_id, source) DO UPDATE SET
        alias_text = excluded.alias_text,
        relation = excluded.relation,
        tags_json = excluded.tags_json,
        confidence = excluded.confidence,
        created_at = excluded.created_at
    `);

    db.exec('BEGIN');
    try {
      for (const word of corpus.words) {
        for (const alias of word.aliases) {
          insertAlias.run(
            alias.aliasText,
            alias.normalizedAlias,
            word.id,
            alias.relation,
            alias.source,
            JSON.stringify(alias.tags),
            null,
            now,
          );
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
