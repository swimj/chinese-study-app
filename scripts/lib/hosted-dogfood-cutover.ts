import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { durableOwnershipManifest } from '../../server/db/ownership-manifest.ts';

export type DogfoodCutoverCounts = {
  learners: number;
  authMappings: number;
  lexicalWords: number;
  lexicalMeanings: number;
  wordStates: number;
  wordSkillStates: number;
  studySessions: number;
  studyAttempts: number;
  reflectionArtifacts: number;
  reflectionRuns: number;
  productionCues: number;
  contrastClusters: number;
  sharedTrialPublications: number;
};

export type PreparedDogfoodValidation = {
  integrityCheck: 'ok';
  foreignKeyViolationCount: 0;
  learnerId: string;
  clerkSubjectSha256: string;
  cutoverId: string;
  learnerCount: 1;
  foreignPrivateRowCount: 0;
  foreignScopedContentCount: 0;
  controls: {
    maintenanceMode: true;
    providerWorkEnabled: false;
  };
  counts: DogfoodCutoverCounts;
};

export type DogfoodCutoverManifestV1 = {
  schemaVersion: 'hosted_dogfood_cutover.v1';
  cutoverId: string;
  learnerId: string;
  clerkSubjectSha256: string;
  preparedAt: string;
  snapshotSha256: string;
  databaseSha256: string;
  identityBindingStatus: 'bound' | 'already_bound';
  sharedTrialBackfill: {
    learnerId: string;
    publishedAt: string;
    contrastClusterIds: string[];
    productionCueIds: string[];
    productionCueSupplementIds: string[];
  };
  beforeCounts: DogfoodCutoverCounts;
  validation: PreparedDogfoodValidation;
};

export type PromotionReport = {
  mode: 'report_only' | 'applied';
  liveDatabasePath: string;
  incomingDatabasePath: string;
  incomingSha256: string;
  previousDatabaseBackupPath: string | null;
  previousDatabaseSha256: string | null;
  validation: PreparedDogfoodValidation;
};

const COUNT_TABLES = {
  learners: 'learners',
  authMappings: 'learner_auth_mappings',
  lexicalWords: 'lexical_words',
  lexicalMeanings: 'lexical_word_meanings',
  wordStates: 'learner_word_state',
  wordSkillStates: 'learner_owned_word_skill_state',
  studySessions: 'learner_owned_study_sessions',
  studyAttempts: 'learner_owned_study_attempt_events',
  reflectionArtifacts: 'learner_owned_reflection_artifacts',
  reflectionRuns: 'learner_owned_reflection_generation_runs',
  productionCues: 'scoped_production_cues',
  contrastClusters: 'scoped_contrast_clusters',
} as const;

export function createConsistentSqliteSnapshot(sourcePath: string, outputPath: string): void {
  const source = path.resolve(sourcePath);
  const output = path.resolve(outputPath);
  if (source === output) throw new Error('Snapshot output must differ from the source database.');
  if (!fs.existsSync(source)) throw new Error(`Source database not found: ${source}`);
  if (fs.existsSync(output)) throw new Error(`Snapshot output already exists: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const database = new DatabaseSync(source, { readOnly: true });
  try {
    assertSqliteIntegrity(database, 'Source database');
    database.prepare('VACUUM INTO ?').run(output);
  } finally {
    database.close();
  }
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function readDogfoodCutoverManifest(manifestPath: string): DogfoodCutoverManifestV1 {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Dogfood cutover manifest is not valid JSON: ${manifestPath}`, { cause: error });
  }
  if (!isPlainObject(value) || value.schemaVersion !== 'hosted_dogfood_cutover.v1') {
    throw new Error('Unsupported dogfood cutover manifest schema.');
  }
  const manifest = value as DogfoodCutoverManifestV1;
  requireSafeCutoverId(manifest.cutoverId);
  requireNonEmpty(manifest.learnerId, 'manifest learner id');
  requireSha256(manifest.clerkSubjectSha256, 'manifest Clerk subject SHA-256');
  requireSha256(manifest.snapshotSha256, 'manifest snapshot SHA-256');
  requireSha256(manifest.databaseSha256, 'manifest database SHA-256');
  if (manifest.identityBindingStatus !== 'bound' && manifest.identityBindingStatus !== 'already_bound') {
    throw new Error('Manifest contains an invalid identity binding status.');
  }
  if (!isPlainObject(manifest.validation) || manifest.validation.cutoverId !== manifest.cutoverId) {
    throw new Error('Manifest validation does not match its cutover id.');
  }
  return manifest;
}

export function readDogfoodCutoverCounts(database: DatabaseSync): DogfoodCutoverCounts {
  const counts = Object.fromEntries(
    Object.entries(COUNT_TABLES).map(([key, table]) => [key, readCount(database, table)]),
  ) as Omit<DogfoodCutoverCounts, 'sharedTrialPublications'>;
  return {
    ...counts,
    sharedTrialPublications: (database.prepare(`
      SELECT COUNT(*) AS count
      FROM shared_content_publications
      WHERE publication_status = 'shared_trial'
    `).get() as { count: number }).count,
  };
}

export function validatePreparedDogfoodDatabase(
  databasePath: string,
  expected: { learnerId: string; clerkSubjectSha256: string; cutoverId: string },
): PreparedDogfoodValidation {
  const learnerId = requireNonEmpty(expected.learnerId, 'learner id');
  const clerkSubjectSha256 = requireSha256(expected.clerkSubjectSha256, 'Clerk subject SHA-256');
  const cutoverId = requireSafeCutoverId(expected.cutoverId);
  const database = new DatabaseSync(path.resolve(databasePath), { readOnly: true });
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    assertSqliteIntegrity(database, 'Prepared dogfood database');

    const learnerCount = readCount(database, 'learners');
    if (learnerCount !== 1) {
      throw new Error(`Prepared dogfood database has ${learnerCount} learners; expected exactly 1.`);
    }
    const learner = database.prepare(`
      SELECT disabled_at
      FROM learners
      WHERE learner_id = ?
    `).get(learnerId) as { disabled_at: string | null } | undefined;
    if (!learner) throw new Error(`Prepared dogfood learner "${learnerId}" is missing.`);
    if (learner.disabled_at !== null) throw new Error(`Prepared dogfood learner "${learnerId}" is disabled.`);

    const mappings = database.prepare(`
      SELECT provider_subject
      FROM learner_auth_mappings
      WHERE provider = 'clerk' AND learner_id = ?
    `).all(learnerId) as Array<{ provider_subject: string }>;
    if (mappings.length !== 1) {
      throw new Error(`Prepared dogfood learner has ${mappings.length} Clerk mappings; expected exactly 1.`);
    }
    if (sha256Text(mappings[0]!.provider_subject) !== clerkSubjectSha256) {
      throw new Error('Prepared database does not contain the expected dogfood Clerk mapping fingerprint.');
    }

    const trustedLocalMapping = database.prepare(`
      SELECT learner_id
      FROM learner_auth_mappings
      WHERE provider = 'trusted_local' AND provider_subject = ?
    `).get(learnerId) as { learner_id: string } | undefined;
    if (trustedLocalMapping?.learner_id !== learnerId) {
      throw new Error('Prepared database is not derived from the trusted-local dogfood learner.');
    }

    const disposableBootstrap = database.prepare(`
      SELECT 1 AS present FROM content_imports WHERE import_id = 'mandarin-hosted-bootstrap-v1'
    `).get() as { present: number } | undefined;
    if (disposableBootstrap?.present === 1) {
      throw new Error('Prepared database contains the disposable hosted Mandarin bootstrap ledger.');
    }

    const sentinel = database.prepare(`
      SELECT 1 AS present
      FROM deployment_sentinels
      WHERE sentinel_id = ?
    `).get(cutoverId) as { present: number } | undefined;
    if (sentinel?.present !== 1) {
      throw new Error(`Prepared database is missing cutover sentinel "${cutoverId}".`);
    }

    const maintenanceMode = readControl(database, 'maintenance_mode');
    const providerWorkEnabled = readControl(database, 'provider_work_enabled');
    if (!maintenanceMode || providerWorkEnabled) {
      throw new Error('Prepared database must start in maintenance with provider work disabled.');
    }

    const foreignPrivateRowCount = durableOwnershipManifest
      .filter((entry) => entry.ownershipClass === 'learner_private')
      .reduce((total, entry) => total + (database.prepare(`
        SELECT COUNT(*) AS count FROM ${entry.table} WHERE learner_id <> ?
      `).get(learnerId) as { count: number }).count, 0);
    if (foreignPrivateRowCount !== 0) {
      throw new Error(`Prepared database contains ${foreignPrivateRowCount} private rows for another learner.`);
    }

    const scopedContentRoots = [
      'scoped_contrast_clusters',
      'scoped_production_cues',
      'scoped_production_cue_supplements',
    ] as const;
    const foreignScopedContentCount = scopedContentRoots
      .reduce((total, table) => total + (database.prepare(`
        SELECT COUNT(*) AS count
        FROM ${table}
        WHERE content_scope = 'learner' AND owner_learner_id <> ?
      `).get(learnerId) as { count: number }).count, 0);
    if (foreignScopedContentCount !== 0) {
      throw new Error(`Prepared database contains ${foreignScopedContentCount} scoped rows for another learner.`);
    }

    const counts = readDogfoodCutoverCounts(database);
    if (counts.lexicalWords === 0) throw new Error('Prepared dogfood database has no lexical words.');
    return {
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
      learnerId,
      clerkSubjectSha256,
      cutoverId,
      learnerCount: 1,
      foreignPrivateRowCount: 0,
      foreignScopedContentCount: 0,
      controls: { maintenanceMode: true, providerWorkEnabled: false },
      counts,
    };
  } finally {
    database.close();
  }
}

export function promotePreparedDogfoodDatabase(input: {
  dataDir: string;
  incomingDatabasePath: string;
  manifestPath: string;
  cutoverId: string;
  litestreamSocketPath: string;
  apply: boolean;
  confirmNormalProcessStopped: boolean;
}): PromotionReport {
  const dataDir = path.resolve(input.dataDir);
  if (!path.isAbsolute(input.dataDir)) throw new Error('Data directory must be absolute.');
  const incomingDatabasePath = requirePathInside(dataDir, input.incomingDatabasePath, 'Incoming database');
  const liveDatabasePath = path.join(dataDir, 'app.db');
  const litestreamSocketPath = requirePathInside(dataDir, input.litestreamSocketPath, 'Litestream socket');
  const cutoverId = requireSafeCutoverId(input.cutoverId);
  const manifestPath = requirePathInside(dataDir, input.manifestPath, 'Manifest');
  const manifest = readDogfoodCutoverManifest(manifestPath);
  assertRegularFile(manifestPath, 'Manifest');
  const expectedSha256 = manifest.databaseSha256;
  const backupDir = path.join(dataDir, 'cutover-backups', cutoverId);
  const previousDatabaseBackupPath = path.join(backupDir, 'app.db');
  if (cutoverId !== manifest.cutoverId) throw new Error('CLI cutover id does not match the manifest.');
  if (incomingDatabasePath === liveDatabasePath) {
    throw new Error('Incoming database must use a staging path, not the live database path.');
  }
  if (input.apply && !input.confirmNormalProcessStopped) {
    throw new Error('Apply requires explicit confirmation that the normal app and Litestream process are stopped.');
  }
  if (input.apply && fs.existsSync(litestreamSocketPath)) {
    throw new Error(`Litestream socket still exists: ${litestreamSocketPath}`);
  }

  if (input.apply && fs.existsSync(backupDir)) {
    const liveExists = fs.existsSync(liveDatabasePath);
    const incomingExists = fs.existsSync(incomingDatabasePath);
    const backupExists = fs.existsSync(previousDatabaseBackupPath);
    if (!liveExists && incomingExists && backupExists) {
      assertNoSqliteSidecars(incomingDatabasePath, 'incoming database');
      fs.renameSync(previousDatabaseBackupPath, liveDatabasePath);
      fsyncDirectory(dataDir);
      fs.rmdirSync(backupDir);
      fsyncDirectory(path.dirname(backupDir));
      throw new Error('Recovered the previous live database after an interrupted promotion. Re-run report-only validation before retrying apply.');
    }
    if (liveExists && !incomingExists && backupExists && sha256File(liveDatabasePath) === expectedSha256) {
      assertNoSqliteSidecars(liveDatabasePath, 'live database');
      const validation = validatePreparedDogfoodDatabase(liveDatabasePath, {
        learnerId: manifest.learnerId,
        clerkSubjectSha256: manifest.clerkSubjectSha256,
        cutoverId: manifest.cutoverId,
      });
      if (JSON.stringify(validation) !== JSON.stringify(manifest.validation)) {
        throw new Error('Recovered promoted database validation does not match the preparation manifest.');
      }
      return {
        mode: 'applied',
        liveDatabasePath,
        incomingDatabasePath,
        incomingSha256: expectedSha256,
        previousDatabaseBackupPath,
        previousDatabaseSha256: sha256File(previousDatabaseBackupPath),
        validation,
      };
    }
    if (liveExists && incomingExists && !backupExists && fs.readdirSync(backupDir).length === 0) {
      fs.rmdirSync(backupDir);
      fsyncDirectory(path.dirname(backupDir));
    } else {
      throw new Error(`Ambiguous interrupted cutover state under ${backupDir}; keep the Machine idle and inspect it manually.`);
    }
  }

  if (!fs.existsSync(liveDatabasePath)) throw new Error(`Live database not found: ${liveDatabasePath}`);
  if (!fs.existsSync(incomingDatabasePath)) throw new Error(`Incoming database not found: ${incomingDatabasePath}`);
  assertRegularFile(liveDatabasePath, 'Live database');
  assertRegularFile(incomingDatabasePath, 'Incoming database');
  if (fs.statSync(liveDatabasePath).dev !== fs.statSync(incomingDatabasePath).dev) {
    throw new Error('Incoming and live databases must be on the same filesystem for atomic promotion.');
  }

  const incomingSha256 = sha256File(incomingDatabasePath);
  if (incomingSha256 !== expectedSha256) {
    throw new Error(`Incoming database SHA-256 mismatch: expected ${expectedSha256}, received ${incomingSha256}.`);
  }
  const validation = validatePreparedDogfoodDatabase(incomingDatabasePath, {
    learnerId: manifest.learnerId,
    clerkSubjectSha256: manifest.clerkSubjectSha256,
    cutoverId: manifest.cutoverId,
  });
  if (JSON.stringify(validation) !== JSON.stringify(manifest.validation)) {
    throw new Error('Incoming database validation does not match the preparation manifest.');
  }
  if (!input.apply) {
    return {
      mode: 'report_only',
      liveDatabasePath,
      incomingDatabasePath,
      incomingSha256,
      previousDatabaseBackupPath: null,
      previousDatabaseSha256: null,
      validation,
    };
  }

  assertNoSqliteSidecars(liveDatabasePath, 'live database');
  assertNoSqliteSidecars(incomingDatabasePath, 'incoming database');
  fs.accessSync(incomingDatabasePath, fs.constants.R_OK | fs.constants.W_OK);
  fs.chmodSync(incomingDatabasePath, 0o600);
  fsyncFile(incomingDatabasePath);

  const previousDatabaseSha256 = sha256File(liveDatabasePath);

  if (fs.existsSync(backupDir)) throw new Error(`Cutover backup directory already exists: ${backupDir}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fsyncDirectory(path.dirname(backupDir));
  fs.renameSync(liveDatabasePath, previousDatabaseBackupPath);
  fsyncDirectory(dataDir);
  fsyncDirectory(backupDir);
  try {
    fs.renameSync(incomingDatabasePath, liveDatabasePath);
    fsyncDirectory(dataDir);
    fsyncDirectory(path.dirname(incomingDatabasePath));
    const promotedSha256 = sha256File(liveDatabasePath);
    if (promotedSha256 !== expectedSha256) {
      throw new Error('Promoted database hash changed unexpectedly after the atomic rename.');
    }
  } catch (error) {
    try {
      if (fs.existsSync(liveDatabasePath)) {
        fs.renameSync(liveDatabasePath, incomingDatabasePath);
        fsyncDirectory(path.dirname(incomingDatabasePath));
      }
      fs.renameSync(previousDatabaseBackupPath, liveDatabasePath);
      fsyncDirectory(dataDir);
      fsyncDirectory(backupDir);
      fs.rmdirSync(backupDir);
      fsyncDirectory(path.dirname(backupDir));
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Dogfood promotion failed and automatic rollback also failed. Keep the Machine idle and recover ${previousDatabaseBackupPath} before restart.`,
      );
    }
    throw new Error('Failed to promote incoming dogfood database; restored the previous live database.', { cause: error });
  }
  return {
    mode: 'applied',
    liveDatabasePath,
    incomingDatabasePath,
    incomingSha256,
    previousDatabaseBackupPath,
    previousDatabaseSha256,
    validation,
  };
}

function assertSqliteIntegrity(database: DatabaseSync, label: string): void {
  const integrityRows = database.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== 'ok') {
    throw new Error(`${label} failed SQLite integrity_check.`);
  }
  const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyRows.length !== 0) {
    throw new Error(`${label} has ${foreignKeyRows.length} foreign-key violations.`);
  }
}

function readCount(database: DatabaseSync, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function readControl(database: DatabaseSync, key: string): boolean {
  const row = database.prepare(`
    SELECT enabled FROM service_controls WHERE control_key = ?
  `).get(key) as { enabled: number } | undefined;
  if (!row) throw new Error(`Prepared database is missing service control "${key}".`);
  return row.enabled === 1;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`Expected non-empty ${label}.`);
  return normalized;
}

function requireSafeCutoverId(value: string): string {
  const cutoverId = requireNonEmpty(value, 'cutover id');
  if (!/^[A-Za-z0-9._-]+$/.test(cutoverId)) {
    throw new Error('Cutover id may contain only letters, numbers, periods, underscores, and hyphens.');
  }
  return cutoverId;
}

function requireSha256(value: string, label: string): string {
  const normalized = requireNonEmpty(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be 64 lowercase hex characters.`);
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePathInside(dataDir: string, candidate: string, label: string): string {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} path must be absolute.`);
  const resolved = path.resolve(candidate);
  const relative = path.relative(dataDir, resolved);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} path must be a child of the data directory.`);
  }
  return resolved;
}

function assertNoSqliteSidecars(databasePath: string, label: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`;
    if (fs.existsSync(sidecar)) throw new Error(`Refusing promotion while ${label} sidecar exists: ${sidecar}`);
  }
}

function assertRegularFile(filePath: string, label: string): void {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file, not a symlink or special file.`);
  }
}

function fsyncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
