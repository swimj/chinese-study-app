import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type StudySkillId = 'recognition' | 'production';

type Violation = {
  wordId: string;
  skillId: StudySkillId | null;
  problem: string;
};

type Args = {
  dbPath: string;
  apply: boolean;
  backup: boolean;
};

main();

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.dbPath)) {
    throw new Error(`Database not found at ${args.dbPath}`);
  }

  const db = new DatabaseSync(args.dbPath);
  db.exec('PRAGMA foreign_keys = ON;');

  try {
  const reviewItemsTableExists = tableExists(db, 'review_items');
  const violations = validateStudySchedulerStateInvariants(db);
  const unprojectedAttemptEventCount = countUnprojectedAttemptEvents(db);
  const reviewItemCount = reviewItemsTableExists ? countRows(db, 'review_items') : 0;
  const reviewWordCount = countReviewWords(db);
  const wordSkillStateCount = countRows(db, 'word_skill_state');

  const blockers = [
    ...violations.map((violation) => `${violation.wordId} ${violation.skillId ?? 'word'}: ${violation.problem}`),
    unprojectedAttemptEventCount > 0
      ? `${unprojectedAttemptEventCount} study_attempt_events row(s) have not been projected`
      : null,
  ].filter((blocker): blocker is string => blocker !== null);

  if (!reviewItemsTableExists) {
    console.log(
      JSON.stringify(
        {
          dbPath: args.dbPath,
          mode: args.apply ? 'apply' : 'dry-run',
          status: 'already-retired',
          reviewWordCount,
          wordSkillStateCount,
          blockers,
        },
        null,
        2,
      ),
    );
    process.exitCode = blockers.length === 0 ? 0 : 1;
    return;
  }

  if (blockers.length > 0) {
    console.log(
      JSON.stringify(
        {
          dbPath: args.dbPath,
          mode: args.apply ? 'apply' : 'dry-run',
          status: 'blocked',
          reviewItemCount,
          reviewWordCount,
          wordSkillStateCount,
          blockers,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          dbPath: args.dbPath,
          mode: 'dry-run',
          status: 'ready',
          reviewItemCount,
          reviewWordCount,
          wordSkillStateCount,
          nextStep: 'Rerun with --apply to drop review_items.',
        },
        null,
        2,
      ),
    );
    return;
  }

  const backupPath = args.backup ? createBackup(args.dbPath) : null;
  db.exec('BEGIN');
  try {
    db.exec(`
      DROP INDEX IF EXISTS idx_review_items_due;
      DROP TABLE review_items;
    `);
    db.prepare(`
      INSERT INTO app_metadata (
        key,
        value,
        updated_at
      ) VALUES ('review_items_retired_v1', 'completed', ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        dbPath: args.dbPath,
        mode: 'apply',
        status: 'retired',
        backupPath,
        droppedReviewItemCount: reviewItemCount,
        reviewWordCount,
        wordSkillStateCount,
      },
      null,
      2,
    ),
  );
  } finally {
    db.close();
  }
}

function parseArgs(rawArgs: string[]): Args {
  let dbPath = process.env.APP_DB_PATH ?? '';
  let dataDir = process.env.APP_DATA_DIR ?? '';
  let apply = false;
  let backup = true;

  for (const arg of rawArgs) {
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      apply = false;
    } else if (arg === '--no-backup') {
      backup = false;
    } else if (arg.startsWith('--db=')) {
      dbPath = arg.slice('--db='.length);
    } else if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length);
    } else {
      throw new Error(`Unknown argument "${arg}". Expected --dry-run, --apply, --db=PATH, --data-dir=DIR, or --no-backup.`);
    }
  }

  if (!dbPath && dataDir) {
    dbPath = path.join(dataDir, 'app.db');
  }

  if (!dbPath) {
    dbPath = path.resolve(process.cwd(), 'data/app.db');
  }

  return {
    dbPath: path.resolve(dbPath),
    apply,
    backup,
  };
}

function tableExists(db: DatabaseSync, tableName: string) {
  const row = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
    `)
    .get(tableName) as { name: string } | undefined;

  return row !== undefined;
}

function countRows(db: DatabaseSync, tableName: string) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

function countReviewWords(db: DatabaseSync) {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM words
      WHERE status = 'review'
    `)
    .get() as { count: number };
  return row.count;
}

function countUnprojectedAttemptEvents(db: DatabaseSync) {
  if (!tableExists(db, 'study_attempt_events')) {
    return 0;
  }

  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM study_attempt_events
      WHERE projected_at IS NULL
    `)
    .get() as { count: number };

  return row.count;
}

function validateStudySchedulerStateInvariants(db: DatabaseSync): Violation[] {
  const reviewWordsMissingAdmission = db
    .prepare(`
      SELECT words.id
      FROM words
      LEFT JOIN word_study_admission_state
        ON word_study_admission_state.word_id = words.id
       AND word_study_admission_state.study_phase = 'review'
      WHERE words.status = 'review'
        AND word_study_admission_state.word_id IS NULL
      ORDER BY words.id ASC
    `)
    .all() as Array<{ id: string }>;

  const reviewWordsMissingSkill = db
    .prepare(`
      WITH expected_skills(skill_id) AS (
        VALUES ('recognition'), ('production')
      )
      SELECT
        words.id,
        expected_skills.skill_id
      FROM words
      CROSS JOIN expected_skills
      LEFT JOIN word_skill_state
        ON word_skill_state.word_id = words.id
       AND word_skill_state.skill_id = expected_skills.skill_id
      WHERE words.status = 'review'
        AND word_skill_state.word_id IS NULL
      ORDER BY words.id ASC, expected_skills.skill_id ASC
    `)
    .all() as Array<{ id: string; skill_id: StudySkillId }>;

  const invalidSkillStates = db
    .prepare(`
      SELECT
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        ease_factor
      FROM word_skill_state
      WHERE skill_id IN ('recognition', 'production')
        AND (
          enabled = 0
          OR interval_hours <= 0
          OR last_studied_at IS NULL
          OR last_studied_at = ''
          OR ease_factor <= 0
        )
      ORDER BY word_id ASC, skill_id ASC
    `)
    .all() as Array<{
      word_id: string;
      skill_id: StudySkillId;
      enabled: number;
      interval_hours: number;
      last_studied_at: string | null;
      ease_factor: number;
    }>;

  const violations: Violation[] = [];

  for (const row of reviewWordsMissingAdmission) {
    violations.push({ wordId: row.id, skillId: null, problem: 'review word missing admission state' });
  }

  for (const row of reviewWordsMissingSkill) {
    violations.push({ wordId: row.id, skillId: row.skill_id, problem: 'review word missing skill state' });
  }

  for (const row of invalidSkillStates) {
    const problem =
      row.enabled === 0
        ? 'disabled scheduler skill'
        : row.interval_hours <= 0
          ? 'non-positive interval_hours'
          : row.last_studied_at === null || row.last_studied_at === ''
            ? 'missing last_studied_at'
            : 'non-positive ease_factor';
    violations.push({ wordId: row.word_id, skillId: row.skill_id, problem });
  }

  return violations;
}

function createBackup(dbPath: string) {
  const backupPath = `${dbPath}.backup-before-review-items-retire-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}
