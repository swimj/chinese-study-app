import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { StudyProfileV0 } from '../src/domain/reflection.ts';
import { generatePreparedReflectionBundle } from '../server/reflection/generation.ts';
import { createLunaReflectionProvider } from '../server/reflection/luna-provider.ts';
import {
  createLegacyPromptRemediationPlan,
  executeLegacyPromptRemediation,
  LegacyPromptRemediationGenerationError,
  type LegacyPromptRemediationReport,
} from './lib/legacy-prompt-remediation.ts';

type CliOptions = {
  dataDir: string;
  learnerId: string;
  studyProfile: StudyProfileV0;
  apply: boolean;
};

export async function runLegacyPromptRemediationCli(
  argv = process.argv.slice(2),
): Promise<LegacyPromptRemediationReport> {
  const options = parseOptions(argv);
  const dbPath = path.join(options.dataDir, 'app.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}.`);
  }

  let db: DatabaseSync;
  let closeDatabase = false;
  if (options.apply) {
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = options.dataDir;
    process.env.APP_LEARNER_ID = options.learnerId;
    process.env.APP_STUDY_PROFILE = options.studyProfile;
    await import('../server/db.ts');
    const connection = await import('../server/db/connection.ts');
    db = connection.getDb();
  } else {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.function('current_learner_id', () => options.learnerId);
    closeDatabase = true;
  }

  try {
    assertEnabledLearner(db, options.learnerId);
    const plan = createLegacyPromptRemediationPlan({
      db,
      learnerId: options.learnerId,
      studyProfile: options.studyProfile,
    });
    const provider = options.apply ? createLunaReflectionProvider() : null;
    return await executeLegacyPromptRemediation({
      plan,
      apply: options.apply,
      generateBatch: provider === null ? undefined : async (batch) => {
        const runId = randomUUID();
        try {
          const result = await generatePreparedReflectionBundle({
            sourceSessionId: null,
            builtBundle: {
              bundle: batch.bundle,
              eligibleItemCount: batch.bundle.items.length,
              includedItemCount: batch.bundle.items.length,
            },
            provider,
            generatedAt: batch.bundle.generatedAt,
            runId,
          });
          return { runId: result.runId, artifactId: result.artifactId };
        } catch (error) {
          throw new LegacyPromptRemediationGenerationError(runId, error);
        }
      },
    });
  } finally {
    if (closeDatabase) db.close();
  }
}

function parseOptions(argv: string[]): CliOptions {
  const args = new Map(argv.map(parseArg).filter((entry): entry is [string, string] => entry !== null));
  const dataDir = args.get('data-dir')?.trim();
  const learnerId = args.get('learner-id')?.trim();
  if (!dataDir || !learnerId) {
    throw new Error(
      'Usage: --data-dir=/absolute/path --learner-id=<stable-id> '
      + '[--study-profile=mandarin|french] [--apply=true]',
    );
  }
  const applyValue = args.get('apply');
  if (applyValue !== undefined && applyValue !== 'true' && applyValue !== 'false') {
    throw new Error('--apply must be true or false. Omit it for the default dry run.');
  }
  const studyProfile = args.get('study-profile') ?? 'mandarin';
  if (studyProfile !== 'mandarin' && studyProfile !== 'french') {
    throw new Error('--study-profile must be mandarin or french.');
  }
  return {
    dataDir: path.resolve(dataDir),
    learnerId,
    studyProfile,
    apply: applyValue === 'true',
  };
}

function assertEnabledLearner(db: DatabaseSync, learnerId: string): void {
  const learner = db.prepare(`
    SELECT 1 FROM learners WHERE learner_id = ? AND disabled_at IS NULL
  `).get(learnerId);
  if (!learner) throw new Error(`Enabled learner "${learnerId}" was not found.`);
}

function parseArg(argument: string): [string, string] | null {
  if (!argument.startsWith('--')) return null;
  const [key, ...rest] = argument.slice(2).split('=');
  return key && rest.length > 0 ? [key, rest.join('=')] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runLegacyPromptRemediationCli().then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.generatedBatches.some((batch) => batch.state === 'failed')) process.exitCode = 1;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
