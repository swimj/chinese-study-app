import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type CandidateRow = {
  word_id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  status: string;
  relevance_updated_at: string | null;
  source_event_id: string | null;
};

type BackfillRow = CandidateRow & {
  lastStudiedAt: string;
  nextDueAt: string;
};

type Args = {
  apply: boolean;
  dbPath: string;
};

const INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS = 6;
const INITIAL_REVIEW_EASE_FACTOR = 2.5;

const args = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(args.dbPath, { readOnly: !args.apply });

try {
  db.exec('PRAGMA foreign_keys = ON;');
  const candidates = getBackfillRows(db);
  printPlan(args, candidates);

  if (args.apply && candidates.length > 0) {
    applyBackfill(db, candidates);
    console.log('');
    console.log(`Inserted ${candidates.length} contextual_selection scheduler row(s).`);
  } else if (!args.apply) {
    console.log('');
    console.log('Dry run only. Re-run with --apply to insert these rows.');
  }
} finally {
  db.close();
}

function parseArgs(values: string[]): Args {
  let apply = false;
  let dbPath: string | null = null;
  let dataDir: string | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const nextValue = values[index + 1];

    if (value === '--help' || value === '-h') {
      printUsageAndExit(0);
    }

    if (value === '--apply') {
      apply = true;
      continue;
    }

    if (value === '--db') {
      if (!nextValue) {
        throw new Error('Expected value after --db');
      }
      dbPath = nextValue;
      index += 1;
      continue;
    }

    if (value.startsWith('--db=')) {
      dbPath = value.slice('--db='.length);
      continue;
    }

    if (value === '--data-dir') {
      if (!nextValue) {
        throw new Error('Expected value after --data-dir');
      }
      dataDir = nextValue;
      index += 1;
      continue;
    }

    if (value.startsWith('--data-dir=')) {
      dataDir = value.slice('--data-dir='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  const resolvedDbPath = dbPath ?? resolveDbPathFromDataDir(dataDir);
  const absoluteDbPath = path.resolve(resolvedDbPath);

  if (!fs.existsSync(absoluteDbPath)) {
    throw new Error(`Database file not found at ${absoluteDbPath}`);
  }

  return {
    apply,
    dbPath: absoluteDbPath,
  };
}

function resolveDbPathFromDataDir(dataDir: string | null) {
  if (dataDir === null) {
    return path.join('data', 'app.db');
  }

  const absoluteDataDir = path.resolve(dataDir);
  if (fs.existsSync(absoluteDataDir) && !fs.statSync(absoluteDataDir).isDirectory()) {
    throw new Error(`Expected --data-dir to be a directory, but got file: ${absoluteDataDir}. Use --db ${absoluteDataDir} instead.`);
  }

  return path.join(dataDir, 'app.db');
}

function printUsageAndExit(exitCode: number): never {
  console.log([
    'Usage:',
    '  node --import tsx scripts/backfill-contextual-selection-scheduler-state.ts --db /path/to/app.db',
    '  node --import tsx scripts/backfill-contextual-selection-scheduler-state.ts --data-dir /path/to/study-data',
    '',
    'Options:',
    '  --apply   Insert missing word_skill_state rows. Without this, the script is read-only.',
    '',
    'Default DB path: data/app.db',
  ].join('\n'));
  process.exit(exitCode);
}

function getBackfillRows(database: DatabaseSync): BackfillRow[] {
  const rows = database.prepare(`
    SELECT
      words.id AS word_id,
      words.hanzi,
      words.traditional,
      words.pinyin,
      words.meaning,
      words.status,
      word_skill_relevance.updated_at AS relevance_updated_at,
      word_skill_relevance.source_event_id
    FROM word_skill_relevance
    INNER JOIN words
      ON words.id = word_skill_relevance.word_id
    LEFT JOIN word_skill_state
      ON word_skill_state.word_id = word_skill_relevance.word_id
     AND word_skill_state.skill_id = word_skill_relevance.skill_id
    WHERE word_skill_relevance.skill_id = 'contextual_selection'
      AND word_skill_relevance.relevance_state = 'normal'
      AND word_skill_state.word_id IS NULL
    ORDER BY
      words.status DESC,
      word_skill_relevance.updated_at ASC,
      words.id ASC
  `).all() as CandidateRow[];

  return rows.map((row) => {
    const nextDueAt = normalizeSchedulerTimestamp(row.relevance_updated_at) ?? new Date().toISOString();
    return {
      ...row,
      nextDueAt,
      lastStudiedAt: addHours(nextDueAt, -INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS),
    };
  });
}

function normalizeSchedulerTimestamp(value: string | null): string | null {
  if (value === null || value.trim().length === 0) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function addHours(isoTimestamp: string, hours: number) {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function printPlan(args: Args, rows: BackfillRow[]) {
  console.log('Contextual-selection scheduler-state backfill');
  console.log(`DB: ${args.dbPath}`);
  console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);
  console.log('');

  if (rows.length === 0) {
    console.log('No missing contextual_selection scheduler rows found.');
    return;
  }

  console.log(`Found ${rows.length} normal contextual_selection relevance row(s) without scheduler state.`);
  console.log(`Each inserted row will use enabled=1 interval_hours=${INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS} ease_factor=${INITIAL_REVIEW_EASE_FACTOR}.`);
  console.log('next_due_at is relevance.updated_at when valid, otherwise now; last_studied_at is next_due_at minus 6 hours.');
  console.log('');

  for (const row of rows) {
    const source = row.source_event_id ? ` sourceEvent=${row.source_event_id}` : '';
    console.log(`  - ${row.hanzi} [${row.word_id}] (${row.status})${source}`);
    console.log(`    relevanceUpdatedAt=${row.relevance_updated_at ?? 'missing'} nextDueAt=${row.nextDueAt} lastStudiedAt=${row.lastStudiedAt}`);
  }
}

function applyBackfill(database: DatabaseSync, rows: BackfillRow[]) {
  const insert = database.prepare(`
    INSERT INTO word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    ) VALUES (?, 'contextual_selection', 1, ?, ?, ?, ?)
  `);

  database.exec('BEGIN');

  try {
    for (const row of rows) {
      insert.run(
        row.word_id,
        INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS,
        row.lastStudiedAt,
        row.nextDueAt,
        INITIAL_REVIEW_EASE_FACTOR,
      );
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
