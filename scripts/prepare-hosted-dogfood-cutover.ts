import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { closeDbConnection, getDb } from '../server/db/connection.ts';
import {
  readStrictArguments,
  requireArgument,
} from './lib/hosted-runtime.ts';
import {
  createConsistentSqliteSnapshot,
  readDogfoodCutoverCounts,
  sha256File,
  sha256Text,
  validatePreparedDogfoodDatabase,
} from './lib/hosted-dogfood-cutover.ts';

const args = readStrictArguments([
  'source-data-dir',
  'output-data-dir',
  'learner-id',
  'clerk-subject',
  'actor-id',
  'cutover-id',
  'prepared-at',
]);
const sourceDataDir = requireAbsoluteDirectoryArgument(args, 'source-data-dir');
const outputDataDir = requireAbsoluteDirectoryArgument(args, 'output-data-dir');
const learnerId = requireArgument(args, 'learner-id');
const clerkSubject = requireArgument(args, 'clerk-subject');
const actorId = requireArgument(args, 'actor-id');
const cutoverId = requireArgument(args, 'cutover-id');
const preparedAt = args.get('prepared-at') ?? new Date().toISOString();
const sourceDatabasePath = path.join(sourceDataDir, 'app.db');

if (sourceDataDir === outputDataDir) {
  throw new Error('Output data directory must differ from the source data directory.');
}
if (fs.existsSync(outputDataDir)) {
  throw new Error(`Output data directory already exists: ${outputDataDir}`);
}

const stagingDataDir = `${outputDataDir}.tmp-${randomUUID()}`;
try {
  const preparedDatabasePath = path.join(stagingDataDir, 'app.db');
  const stagingManifestPath = path.join(stagingDataDir, 'manifest.json');
  createConsistentSqliteSnapshot(sourceDatabasePath, preparedDatabasePath);
  const snapshotSha256 = sha256File(preparedDatabasePath);
  const snapshotDatabase = new DatabaseSync(preparedDatabasePath, { readOnly: true });
  const beforeCounts = (() => {
    try {
      return readDogfoodCutoverCounts(snapshotDatabase);
    } finally {
      snapshotDatabase.close();
    }
  })();

  process.env.APP_MODE = 'study';
  process.env.APP_AUTH_MODE = 'trusted_local';
  process.env.APP_DATA_DIR = stagingDataDir;
  process.env.APP_LEARNER_ID = learnerId;
  delete process.env.APP_SEED_DATA_PATH;
  process.env.APP_STUDY_PROFILE = 'mandarin';
  const dbModuleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?hosted-dogfood-cutover=${Date.now()}`;
  const db = await import(dbModuleUrl);

  let identityBindingStatus: 'bound' | 'already_bound';
  let sharedTrialBackfill: ReturnType<typeof db.inspectDogfoodSharedTrialBackfill>;
  try {
    sharedTrialBackfill = db.runWithLearnerId(learnerId, () => {
      const report = db.inspectDogfoodSharedTrialBackfill({ publishedAt: preparedAt });
      identityBindingStatus = db.bindExternalLearnerIdentity({
        provider: db.CLERK_AUTH_PROVIDER,
        providerSubject: clerkSubject,
        learnerId,
        createdAt: preparedAt,
      });
      db.backfillDogfoodSharedTrialContent({ publishedAt: preparedAt });
      return report;
    });
    db.setHostedServiceControl({ key: 'provider_work_enabled', enabled: false, actorId, updatedAt: preparedAt });
    db.setHostedServiceControl({ key: 'maintenance_mode', enabled: true, actorId, updatedAt: preparedAt });
    db.createDeploymentSentinel({ sentinelId: cutoverId, actorId, createdAt: preparedAt });
    getDb().prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    getDb().prepare('PRAGMA journal_mode=DELETE').get();
  } finally {
    closeDbConnection();
  }

  assertNoPreparedSidecars(preparedDatabasePath);
  const validation = validatePreparedDogfoodDatabase(preparedDatabasePath, {
    learnerId,
    clerkSubjectSha256: sha256Text(clerkSubject),
    cutoverId,
  });
  assertPreservedCounts(beforeCounts, validation.counts, sharedTrialBackfill, identityBindingStatus!);
  const preparedSha256 = sha256File(preparedDatabasePath);
  const manifest = {
    schemaVersion: 'hosted_dogfood_cutover.v1' as const,
    cutoverId,
    learnerId,
    clerkSubjectSha256: sha256Text(clerkSubject),
    preparedAt,
    snapshotSha256,
    databaseSha256: preparedSha256,
    identityBindingStatus: identityBindingStatus!,
    sharedTrialBackfill,
    beforeCounts,
    validation,
  };
  fs.writeFileSync(stagingManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(stagingDataDir, outputDataDir);

  process.stdout.write(`${JSON.stringify({
    status: 'prepared',
    sourceDatabasePath,
    preparedDatabasePath: path.join(outputDataDir, 'app.db'),
    manifestPath: path.join(outputDataDir, 'manifest.json'),
    manifest,
  }, null, 2)}\n`);
} catch (error) {
  fs.rmSync(stagingDataDir, { recursive: true, force: true });
  throw error;
}

function requireAbsoluteDirectoryArgument(input: Map<string, string>, key: string): string {
  const raw = requireArgument(input, key);
  if (!path.isAbsolute(raw)) throw new Error(`--${key} must be an absolute path.`);
  return path.resolve(raw);
}

function assertNoPreparedSidecars(databasePath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(`${databasePath}${suffix}`)) {
      throw new Error(`Prepared database retained SQLite sidecar ${databasePath}${suffix}.`);
    }
  }
}

function assertPreservedCounts(
  before: ReturnType<typeof readDogfoodCutoverCounts>,
  after: ReturnType<typeof readDogfoodCutoverCounts>,
  backfill: ReturnType<typeof db.inspectDogfoodSharedTrialBackfill>,
  bindingStatus: 'bound' | 'already_bound',
): void {
  const preservedKeys = [
    'learners',
    'lexicalWords',
    'lexicalMeanings',
    'wordStates',
    'wordSkillStates',
    'studySessions',
    'studyAttempts',
    'reflectionArtifacts',
    'reflectionRuns',
    'productionCues',
    'contrastClusters',
  ] as const;
  for (const key of preservedKeys) {
    if (before[key] !== after[key]) {
      throw new Error(`Dogfood preparation changed preserved count ${key}: ${before[key]} -> ${after[key]}.`);
    }
  }
  const expectedPublicationIncrease = backfill.contrastClusterIds.length
    + backfill.productionCueIds.length
    + backfill.productionCueSupplementIds.length;
  if (after.sharedTrialPublications !== before.sharedTrialPublications + expectedPublicationIncrease) {
    throw new Error('Dogfood preparation produced an unexpected shared-trial publication count.');
  }
  const expectedAuthMappingIncrease = bindingStatus === 'bound' ? 1 : 0;
  if (after.authMappings !== before.authMappings + expectedAuthMappingIncrease) {
    throw new Error('Dogfood preparation produced an unexpected auth-mapping count.');
  }
}
