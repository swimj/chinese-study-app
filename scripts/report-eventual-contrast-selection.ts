import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type WordStatus = 'unstudied' | 'learning' | 'review';

type ReportRow = {
  word_id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  status: WordStatus;
  learning_streak: number;
  last_learning_success_on: string | null;
  last_learning_covered_on: string | null;
  cluster_count: number;
  cluster_ids: string;
  cluster_titles: string;
  review_admission_phase: string | null;
  review_earliest_next_study_at: string | null;
  contextual_relevance_state: string | null;
  contextual_relevance_updated_at: string | null;
  contextual_relevance_source_event_id: string | null;
  contextual_enabled: number | null;
  contextual_interval_hours: number | null;
  contextual_last_studied_at: string | null;
  contextual_next_due_at: string | null;
  contextual_ease_factor: number | null;
  contextual_current_urgency: number | null;
  sibling_count: number;
  usable_prompt_count: number;
  usable_prompt_targeting_scheduled_word_count: number;
  usable_prompt_targeting_sibling_count: number;
  suppressed_prompt_count: number;
  enabled_recognition_state_count: number;
  enabled_production_state_count: number;
};

type Args = {
  dbPath: string;
};

const args = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(args.dbPath, { readOnly: true });

try {
  const rows = getReportRows(db);
  printReport(args.dbPath, rows);
} finally {
  db.close();
}

function parseArgs(values: string[]): Args {
  let dbPath: string | null = null;
  let dataDir: string | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const nextValue = values[index + 1];

    if (value === '--help' || value === '-h') {
      printUsageAndExit(0);
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
    '  node --import tsx scripts/report-eventual-contrast-selection.ts --db /path/to/app.db',
    '  node --import tsx scripts/report-eventual-contrast-selection.ts --data-dir /path/to/study-data',
    '',
    'Default DB path: data/app.db',
  ].join('\n'));
  process.exit(exitCode);
}

function getReportRows(database: DatabaseSync): ReportRow[] {
  return database.prepare(`
    WITH
      report_clock AS (
        SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now_at
      ),
      contrast_words AS (
        SELECT
          words.id AS word_id,
          words.hanzi,
          words.traditional,
          words.pinyin,
          words.meaning,
          words.status,
          words.learning_streak,
          words.last_learning_success_on,
          words.last_learning_covered_on,
          COUNT(DISTINCT contrast_cluster_members.cluster_id) AS cluster_count,
          GROUP_CONCAT(DISTINCT contrast_cluster_members.cluster_id) AS cluster_ids,
          GROUP_CONCAT(DISTINCT contrast_clusters.title) AS cluster_titles
        FROM contrast_cluster_members
        INNER JOIN contrast_clusters
          ON contrast_clusters.id = contrast_cluster_members.cluster_id
        INNER JOIN words
          ON words.id = contrast_cluster_members.word_id
        GROUP BY words.id
      ),
      usable_contrast_content AS (
        SELECT
          scheduled_member.word_id,
          COUNT(DISTINCT sibling_member.word_id) AS sibling_count,
          COUNT(DISTINCT contrast_prompts.id) AS usable_prompt_count,
          COUNT(DISTINCT CASE
            WHEN contrast_prompts.target_word_id = scheduled_member.word_id
              THEN contrast_prompts.id
          END) AS usable_prompt_targeting_scheduled_word_count,
          COUNT(DISTINCT CASE
            WHEN contrast_prompts.target_word_id = sibling_member.word_id
              THEN contrast_prompts.id
          END) AS usable_prompt_targeting_sibling_count
        FROM contrast_cluster_members AS scheduled_member
        INNER JOIN contrast_cluster_members AS sibling_member
          ON sibling_member.cluster_id = scheduled_member.cluster_id
         AND sibling_member.word_id != scheduled_member.word_id
        LEFT JOIN contrast_prompts
          ON contrast_prompts.cluster_id = scheduled_member.cluster_id
         AND contrast_prompts.target_word_id IN (scheduled_member.word_id, sibling_member.word_id)
         AND NOT EXISTS (
           SELECT 1
           FROM study_content_feedback
           WHERE study_content_feedback.target_type = 'contrast_prompt'
             AND study_content_feedback.target_id = contrast_prompts.id
             AND study_content_feedback.feedback_type = 'bad_prompt'
         )
        GROUP BY scheduled_member.word_id
      ),
      suppressed_contrast_content AS (
        SELECT
          scheduled_member.word_id,
          COUNT(DISTINCT contrast_prompts.id) AS suppressed_prompt_count
        FROM contrast_cluster_members AS scheduled_member
        INNER JOIN contrast_cluster_members AS sibling_member
          ON sibling_member.cluster_id = scheduled_member.cluster_id
         AND sibling_member.word_id != scheduled_member.word_id
        INNER JOIN contrast_prompts
          ON contrast_prompts.cluster_id = scheduled_member.cluster_id
         AND contrast_prompts.target_word_id IN (scheduled_member.word_id, sibling_member.word_id)
        INNER JOIN study_content_feedback
          ON study_content_feedback.target_type = 'contrast_prompt'
         AND study_content_feedback.target_id = contrast_prompts.id
         AND study_content_feedback.feedback_type = 'bad_prompt'
        GROUP BY scheduled_member.word_id
      ),
      non_contrast_skill_state AS (
        SELECT
          word_id,
          SUM(CASE WHEN skill_id = 'recognition' AND enabled != 0 THEN 1 ELSE 0 END) AS enabled_recognition_state_count,
          SUM(CASE WHEN skill_id = 'production' AND enabled != 0 THEN 1 ELSE 0 END) AS enabled_production_state_count
        FROM word_skill_state
        WHERE skill_id IN ('recognition', 'production')
          AND interval_hours > 0
          AND last_studied_at IS NOT NULL
          AND last_studied_at != ''
          AND ease_factor > 0
        GROUP BY word_id
      )
    SELECT
      contrast_words.word_id,
      contrast_words.hanzi,
      contrast_words.traditional,
      contrast_words.pinyin,
      contrast_words.meaning,
      contrast_words.status,
      contrast_words.learning_streak,
      contrast_words.last_learning_success_on,
      contrast_words.last_learning_covered_on,
      contrast_words.cluster_count,
      contrast_words.cluster_ids,
      contrast_words.cluster_titles,
      word_study_admission_state.study_phase AS review_admission_phase,
      word_study_admission_state.earliest_next_study_at AS review_earliest_next_study_at,
      word_skill_relevance.relevance_state AS contextual_relevance_state,
      word_skill_relevance.updated_at AS contextual_relevance_updated_at,
      word_skill_relevance.source_event_id AS contextual_relevance_source_event_id,
      word_skill_state.enabled AS contextual_enabled,
      word_skill_state.interval_hours AS contextual_interval_hours,
      word_skill_state.last_studied_at AS contextual_last_studied_at,
      word_skill_state.next_due_at AS contextual_next_due_at,
      word_skill_state.ease_factor AS contextual_ease_factor,
      CASE
        WHEN word_skill_state.last_studied_at IS NULL
          OR word_skill_state.interval_hours IS NULL
          OR word_skill_state.interval_hours <= 0
          THEN NULL
        ELSE ROUND(((julianday(report_clock.now_at) - julianday(word_skill_state.last_studied_at)) * 24.0) / word_skill_state.interval_hours, 3)
      END AS contextual_current_urgency,
      COALESCE(usable_contrast_content.sibling_count, 0) AS sibling_count,
      COALESCE(usable_contrast_content.usable_prompt_count, 0) AS usable_prompt_count,
      COALESCE(usable_contrast_content.usable_prompt_targeting_scheduled_word_count, 0) AS usable_prompt_targeting_scheduled_word_count,
      COALESCE(usable_contrast_content.usable_prompt_targeting_sibling_count, 0) AS usable_prompt_targeting_sibling_count,
      COALESCE(suppressed_contrast_content.suppressed_prompt_count, 0) AS suppressed_prompt_count,
      COALESCE(non_contrast_skill_state.enabled_recognition_state_count, 0) AS enabled_recognition_state_count,
      COALESCE(non_contrast_skill_state.enabled_production_state_count, 0) AS enabled_production_state_count
    FROM contrast_words
    CROSS JOIN report_clock
    LEFT JOIN word_study_admission_state
      ON word_study_admission_state.word_id = contrast_words.word_id
     AND word_study_admission_state.study_phase = 'review'
    LEFT JOIN word_skill_relevance
      ON word_skill_relevance.word_id = contrast_words.word_id
     AND word_skill_relevance.skill_id = 'contextual_selection'
    LEFT JOIN word_skill_state
      ON word_skill_state.word_id = contrast_words.word_id
     AND word_skill_state.skill_id = 'contextual_selection'
    LEFT JOIN usable_contrast_content
      ON usable_contrast_content.word_id = contrast_words.word_id
    LEFT JOIN suppressed_contrast_content
      ON suppressed_contrast_content.word_id = contrast_words.word_id
    LEFT JOIN non_contrast_skill_state
      ON non_contrast_skill_state.word_id = contrast_words.word_id
    ORDER BY
      contrast_words.status DESC,
      contextual_current_urgency DESC,
      contrast_words.word_id ASC
  `).all() as ReportRow[];
}

function printReport(dbPath: string, rows: ReportRow[]) {
  const evaluated = rows.map((row) => ({
    row,
    status: evaluateRow(row),
  }));
  const eligible = evaluated.filter((entry) => entry.status.kind === 'eligible');
  const blocked = evaluated.filter((entry) => entry.status.kind === 'blocked');
  const maybe = evaluated.filter((entry) => entry.status.kind === 'maybe');

  console.log(`Eventual contrast-selection report`);
  console.log(`DB: ${dbPath}`);
  console.log('');

  if (rows.length === 0) {
    console.log('No contrast cluster members found.');
    return;
  }

  console.log(eligible.length > 0
    ? `YES: ${eligible.length} word(s) can eventually surface contrast_selection with no additional management/import action.`
    : `NO: no contrast cluster words currently have all durable prerequisites for eventual contrast_selection scheduling.`);
  console.log(`Checked ${rows.length} contrast-cluster word(s).`);
  console.log(`Normal contextual relevance: ${countWhere(rows, (row) => row.contextual_relevance_state === 'normal')}`);
  console.log(`Enabled contextual scheduler state: ${countWhere(rows, (row) => row.contextual_enabled !== null && row.contextual_enabled !== 0)}`);
  console.log(`Usable unsuppressed prompt content: ${countWhere(rows, (row) => row.usable_prompt_count > 0)}`);

  printSection('Can Eventually Surface', eligible);
  printSection('Maybe Blocked By Invariant Gap', maybe);
  printSection('Cannot Surface Without More Action', blocked);
}

function evaluateRow(row: ReportRow): { kind: 'eligible' | 'blocked' | 'maybe'; reason: string } {
  if (row.contextual_relevance_state === null) {
    return { kind: 'blocked', reason: 'contextual_selection has no relevance row' };
  }
  if (row.contextual_relevance_state !== 'normal') {
    return { kind: 'blocked', reason: `contextual_selection relevance is ${row.contextual_relevance_state}` };
  }
  if (row.contextual_enabled === null) {
    return { kind: 'blocked', reason: 'contextual_selection has no scheduler state' };
  }
  if (row.contextual_enabled === 0) {
    return { kind: 'blocked', reason: 'contextual_selection scheduler state is disabled' };
  }
  if (row.contextual_interval_hours === null || row.contextual_interval_hours <= 0) {
    return { kind: 'blocked', reason: 'contextual_selection interval is missing or non-positive' };
  }
  if (row.contextual_last_studied_at === null || row.contextual_last_studied_at.length === 0) {
    return { kind: 'blocked', reason: 'contextual_selection last_studied_at is missing' };
  }
  if (row.contextual_ease_factor === null || row.contextual_ease_factor <= 0) {
    return { kind: 'blocked', reason: 'contextual_selection ease_factor is missing or non-positive' };
  }
  if (row.usable_prompt_count === 0) {
    return { kind: 'blocked', reason: 'no usable unsuppressed contrast prompt content' };
  }

  if (row.status === 'review' && row.review_admission_phase === null) {
    return { kind: 'maybe', reason: 'review word is missing review admission state' };
  }
  if (row.status === 'review') {
    return { kind: 'eligible', reason: 'review word; current guard and urgency can elapse with time' };
  }
  if (row.status === 'learning') {
    return { kind: 'eligible', reason: 'after ordinary learning graduation' };
  }
  if (row.status === 'unstudied') {
    return { kind: 'eligible', reason: 'after ordinary unstudied intake and learning graduation' };
  }

  return { kind: 'blocked', reason: `unsupported word status ${String(row.status)}` };
}

function printSection(
  title: string,
  entries: Array<{ row: ReportRow; status: { kind: 'eligible' | 'blocked' | 'maybe'; reason: string } }>,
) {
  console.log('');
  console.log(`${title}: ${entries.length}`);

  if (entries.length === 0) {
    console.log('  none');
    return;
  }

  for (const entry of entries) {
    const row = entry.row;
    const due = row.contextual_next_due_at ? ` nextDue=${row.contextual_next_due_at}` : '';
    const urgency = row.contextual_current_urgency === null ? '' : ` urgency=${row.contextual_current_urgency}`;
    const relevance = row.contextual_relevance_state ? ` relevance=${row.contextual_relevance_state}` : ' relevance=missing';
    const scheduler = row.contextual_enabled === null
      ? ' scheduler=missing'
      : ` scheduler=${row.contextual_enabled === 0 ? 'disabled' : 'enabled'} intervalHours=${row.contextual_interval_hours ?? 'missing'}`;

    console.log(`  - ${row.hanzi} [${row.word_id}] (${row.status}): ${entry.status.reason}`);
    console.log(`    clusters: ${row.cluster_titles}`);
    console.log(
      `    contrast: prompts=${row.usable_prompt_count} siblings=${row.sibling_count} suppressedPrompts=${row.suppressed_prompt_count}${relevance}${scheduler}${due}${urgency}`,
    );
  }
}

function countWhere<T>(values: T[], predicate: (value: T) => boolean) {
  return values.reduce((count, value) => count + (predicate(value) ? 1 : 0), 0);
}
