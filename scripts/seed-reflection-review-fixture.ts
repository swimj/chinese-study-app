import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  buildReflectionVerificationMaterializationInput,
  reflectionVerificationFixture,
} from './lib/reflection-verification-fixture.ts';

const dataDir = readRequiredDataDir();
const seedDataPath = path.resolve('server/seeds/reflection-dev.json');

process.env.APP_MODE = 'dev';
process.env.APP_DATA_DIR = dataDir;
process.env.APP_SEED_DATA_PATH = seedDataPath;
process.env.APP_INCLUDE_DEV_CONTRAST_SEED = 'false';

const dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?reflection-fixture=${Date.now()}`);
const sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));

try {
  sqlite.prepare(`
    INSERT OR IGNORE INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, ?, ?, 'processed', ?)
  `).run(
    reflectionVerificationFixture.sessionId,
    reflectionVerificationFixture.startedAt,
    reflectionVerificationFixture.generatedAt,
    reflectionVerificationFixture.generatedAt,
  );

  const materialized = dbModule.materializeReflectionArtifact(
    buildReflectionVerificationMaterializationInput(),
  );

  console.log(JSON.stringify({
    artifactId: materialized.artifact.artifactId,
    proposalCount: materialized.artifact.proposals.length,
    created: materialized.created,
    dataDir,
  }));
} finally {
  sqlite.close();
}

function readRequiredDataDir(): string {
  const argument = process.argv.find((value) => value.startsWith('--data-dir='));
  const rawDataDir = argument?.slice('--data-dir='.length);
  if (!rawDataDir) {
    throw new Error('Expected --data-dir=/absolute/path for the disposable reflection verification database.');
  }

  const resolved = path.resolve(rawDataDir);
  if (!path.isAbsolute(resolved)) {
    throw new Error('Expected an absolute --data-dir path.');
  }

  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
