import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { DatabaseSync } from 'node:sqlite';

type WordReport = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings: string[];
  personalNotes: string;
  status: string;
  priority: number;
  createdAt: string;
  learningStreak: number;
  lastLearningSuccessOn: string | null;
  lastLearningCoveredOn: string | null;
  admission: {
    studyPhase: string;
    earliestNextStudyAt: string | null;
  } | null;
  skills: Array<{
    skillId: string;
    enabled: boolean;
    intervalHours: number;
    lastStudiedAt: string;
    nextDueAt: string | null;
    easeFactor: number;
  }>;
};

type WordRow = Omit<WordReport, 'meanings' | 'admission' | 'skills'> & {
  meaningsJson: string;
};

export function findWordReports(db: DatabaseSync, hanzi: string): WordReport[] {
  const normalizedHanzi = hanzi.trim();
  if (normalizedHanzi.length === 0) {
    return [];
  }

  const words = db.prepare(`
    SELECT
      id, hanzi, traditional, pinyin, meaning, meanings_json AS meaningsJson,
      personal_notes AS personalNotes, status, priority, created_at AS createdAt,
      learning_streak AS learningStreak,
      last_learning_success_on AS lastLearningSuccessOn,
      last_learning_covered_on AS lastLearningCoveredOn
    FROM words
    WHERE hanzi = ?
    ORDER BY priority DESC, created_at ASC, id ASC
  `).all(normalizedHanzi) as WordRow[];

  const admission = db.prepare(`
    SELECT study_phase AS studyPhase, earliest_next_study_at AS earliestNextStudyAt
    FROM word_study_admission_state
    WHERE word_id = ?
  `);
  const skills = db.prepare(`
    SELECT
      skill_id AS skillId,
      enabled,
      interval_hours AS intervalHours,
      last_studied_at AS lastStudiedAt,
      next_due_at AS nextDueAt,
      ease_factor AS easeFactor
    FROM word_skill_state
    WHERE word_id = ?
    ORDER BY skill_id ASC
  `);

  return words.map((word) => ({
    ...word,
    meanings: parseJsonArray(word.meaningsJson),
    admission: (admission.get(word.id) as WordReport['admission'] | undefined) ?? null,
    skills: (skills.all(word.id) as Array<WordReport['skills'][number] & { enabled: number }>).map((skill) => ({
      ...skill,
      enabled: skill.enabled !== 0,
    })),
  }));
}

export function formatWordReport(report: WordReport): string {
  const lines = [
    `${report.hanzi}${report.traditional ? ` (traditional: ${report.traditional})` : ''} [${report.id}]`,
    `  status: ${report.status}`,
    `  pinyin: ${report.pinyin}`,
    `  meaning: ${report.meaning}`,
    `  meanings: ${report.meanings.length > 0 ? report.meanings.join(' | ') : '(none)'}`,
    `  priority: ${report.priority}`,
    `  created: ${report.createdAt}`,
  ];

  if (report.personalNotes.length > 0) lines.push(`  personal notes: ${report.personalNotes}`);
  if (report.status === 'learning') {
    lines.push(`  learning streak: ${report.learningStreak}`);
    lines.push(`  last learning success: ${report.lastLearningSuccessOn ?? '(none)'}`);
    lines.push(`  last learning covered: ${report.lastLearningCoveredOn ?? '(none)'}`);
  }

  if (report.admission) {
    lines.push(`  admission: ${report.admission.studyPhase}`);
    lines.push(`  earliest next study: ${report.admission.earliestNextStudyAt ?? '(none)'}`);
  } else {
    lines.push('  admission: (no review admission row)');
  }

  if (report.skills.length === 0) {
    lines.push('  skill schedules: (none)');
  } else {
    lines.push('  skill schedules:');
    for (const skill of report.skills) {
      lines.push(
        `    - ${skill.skillId}: ${skill.enabled ? 'enabled' : 'disabled'}, next due ${skill.nextDueAt ?? '(none)'}, ` +
          `last studied ${skill.lastStudiedAt}, interval ${skill.intervalHours}h, ease ${skill.easeFactor}`,
      );
    }
  }

  return lines.join('\n');
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function getDataDir(): string {
  const dataDirArg = process.argv.find((argument) => argument.startsWith('--data-dir='));
  return path.resolve(dataDirArg?.slice('--data-dir='.length) || process.env.APP_DATA_DIR || 'data');
}

function getLearnerId(): string {
  const learnerIdArg = process.argv.find((argument) => argument.startsWith('--learner-id='));
  const learnerId = learnerIdArg?.slice('--learner-id='.length) || process.env.APP_LEARNER_ID || '';
  if (learnerId.trim().length === 0) {
    throw new Error('Pass --learner-id=<stable-id> or set APP_LEARNER_ID.');
  }
  return learnerId.trim();
}

export async function runWordReportCli(): Promise<void> {
  const dataDir = getDataDir();
  const learnerId = getLearnerId();
  const dbPath = path.join(dataDir, 'app.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Pass --data-dir=/absolute/path or set APP_DATA_DIR.`);
  }

  // This connection is deliberately read-only. Do not replace it with the app DB barrel:
  // importing that module initializes the database and may seed or migrate it.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const learner = db.prepare(`
    SELECT 1 FROM learners WHERE learner_id = ? AND disabled_at IS NULL
  `).get(learnerId);
  if (!learner) {
    db.close();
    throw new Error(`Enabled learner "${learnerId}" was not found in ${dbPath}.`);
  }
  db.function('current_learner_id', () => learnerId);
  const cli = readline.createInterface({ input, output });

  try {
    console.log(`Read-only word report for ${dbPath}`);
    console.log('Enter blank input or "quit" to exit. Reports use durable projections only; events are not assembled.');
    while (true) {
      const answer = (await cli.question('hanzi> ')).trim();
      if (answer.length === 0 || answer === 'quit' || answer === 'exit') break;

      const reports = findWordReports(db, answer);
      if (reports.length === 0) {
        console.log(`No exact hanzi matches for ${answer}.`);
        continue;
      }

      console.log(`Found ${reports.length} exact match${reports.length === 1 ? '' : 'es'}:`);
      console.log(reports.map(formatWordReport).join('\n\n'));
    }
  } finally {
    cli.close();
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  runWordReportCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
