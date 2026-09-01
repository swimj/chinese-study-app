import { getDb } from './connection.ts';
import { randomUUID } from 'node:crypto';

export const LOCAL_AUTH_PROVIDER = 'trusted_local';
export const CLERK_AUTH_PROVIDER = 'clerk';
export const LEARNER_OWNERSHIP_MIGRATION_ID = 'swi_47_learner_ownership_v1';

export function ensureIdentitySchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS learners (
      learner_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      disabled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS learner_auth_mappings (
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, provider_subject),
      UNIQUE (provider, learner_id)
    );

    CREATE TABLE IF NOT EXISTS learner_settings (
      learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, setting_key)
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS content_imports (
      import_id TEXT PRIMARY KEY,
      content_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_learner_auth_mappings_learner
      ON learner_auth_mappings(learner_id, provider);
  `);
}

export function bootstrapLearner({
  learnerId,
  displayName = learnerId,
  provider = LOCAL_AUTH_PROVIDER,
  providerSubject = learnerId,
  createdAt = new Date().toISOString(),
}: {
  learnerId: string;
  displayName?: string;
  provider?: string;
  providerSubject?: string;
  createdAt?: string;
}): void {
  const normalizedLearnerId = learnerId.trim();
  if (normalizedLearnerId.length === 0) throw new Error('Expected non-empty learner id');
  if (provider.trim().length === 0) throw new Error('Expected non-empty auth provider');
  if (providerSubject.trim().length === 0) throw new Error('Expected non-empty provider subject');

  getDb().exec('BEGIN');
  try {
    getDb().prepare(`
      INSERT INTO learners (learner_id, display_name, created_at, disabled_at)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT(learner_id) DO NOTHING
    `).run(normalizedLearnerId, displayName.trim() || normalizedLearnerId, createdAt);
    getDb().prepare(`
      INSERT INTO learner_auth_mappings (provider, provider_subject, learner_id, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(provider, provider_subject) DO UPDATE SET
        learner_id = excluded.learner_id
    `).run(provider.trim(), providerSubject.trim(), normalizedLearnerId, createdAt);
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function resolveLearnerId(provider: string, providerSubject: string): string | null {
  const row = getDb().prepare(`
    SELECT learner_id
    FROM learner_auth_mappings
    WHERE provider = ? AND provider_subject = ?
  `).get(provider, providerSubject) as { learner_id: string } | undefined;
  return row?.learner_id ?? null;
}

export function bindExternalLearnerIdentity({
  provider,
  providerSubject,
  learnerId,
  createdAt = new Date().toISOString(),
}: {
  provider: string;
  providerSubject: string;
  learnerId: string;
  createdAt?: string;
}): 'bound' | 'already_bound' {
  const normalizedProvider = provider.trim();
  const normalizedSubject = providerSubject.trim();
  const normalizedLearnerId = learnerId.trim();
  if (normalizedProvider.length === 0) throw new Error('Expected non-empty auth provider');
  if (normalizedSubject.length === 0) throw new Error('Expected non-empty provider subject');
  if (normalizedLearnerId.length === 0) throw new Error('Expected non-empty learner id');

  getDb().exec('BEGIN IMMEDIATE');
  try {
    assertLearnerExists(normalizedLearnerId);
    const subjectMapping = getDb().prepare(`
      SELECT learner_id
      FROM learner_auth_mappings
      WHERE provider = ? AND provider_subject = ?
    `).get(normalizedProvider, normalizedSubject) as { learner_id: string } | undefined;
    if (subjectMapping && subjectMapping.learner_id !== normalizedLearnerId) {
      throw new Error(
        `Auth subject is already bound to learner "${subjectMapping.learner_id}".`,
      );
    }

    const learnerMapping = getDb().prepare(`
      SELECT provider_subject
      FROM learner_auth_mappings
      WHERE provider = ? AND learner_id = ?
    `).get(normalizedProvider, normalizedLearnerId) as { provider_subject: string } | undefined;
    if (learnerMapping && learnerMapping.provider_subject !== normalizedSubject) {
      throw new Error(
        `Learner "${normalizedLearnerId}" is already bound to another ${normalizedProvider} subject.`,
      );
    }

    if (subjectMapping) {
      getDb().exec('COMMIT');
      return 'already_bound';
    }

    getDb().prepare(`
      INSERT INTO learner_auth_mappings (provider, provider_subject, learner_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(normalizedProvider, normalizedSubject, normalizedLearnerId, createdAt);
    getDb().exec('COMMIT');
    return 'bound';
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export class DisabledLearnerError extends Error {
  constructor() {
    super('Account disabled.');
    this.name = 'DisabledLearnerError';
  }
}

/**
 * Resolves one external subject to its stable learner identity, creating that
 * local identity only for a verified first sign-in. The immediate transaction
 * makes concurrent first requests converge on one mapping.
 */
export function resolveOrBootstrapExternalLearner({
  provider,
  providerSubject,
}: {
  provider: string;
  providerSubject: string;
}): string {
  const normalizedProvider = provider.trim();
  const normalizedSubject = providerSubject.trim();
  if (normalizedProvider.length === 0) throw new Error('Expected non-empty auth provider');
  if (normalizedSubject.length === 0) throw new Error('Expected non-empty provider subject');

  getDb().exec('BEGIN IMMEDIATE');
  try {
    const existingLearnerId = resolveLearnerId(normalizedProvider, normalizedSubject);
    if (existingLearnerId !== null) {
      assertLearnerExists(existingLearnerId);
      getDb().exec('COMMIT');
      return existingLearnerId;
    }

    const learnerId = `learner_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO learners (learner_id, display_name, created_at, disabled_at)
      VALUES (?, 'Learner', ?, NULL)
    `).run(learnerId, createdAt);
    getDb().prepare(`
      INSERT INTO learner_auth_mappings (provider, provider_subject, learner_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(normalizedProvider, normalizedSubject, learnerId, createdAt);
    getDb().prepare(`
      INSERT INTO learner_settings (learner_id, setting_key, value_json, updated_at)
      VALUES (?, 'daily_new_word_limit', '10', ?)
    `).run(learnerId, createdAt);
    getDb().exec('COMMIT');
    return learnerId;
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function hasIdentitySchema(): boolean {
  const row = getDb().prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'learners'
  `).get() as { present: number } | undefined;
  return row?.present === 1;
}

export function recordLearnerOwnershipSchema(appliedAt = new Date().toISOString()): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO schema_migrations (migration_id, applied_at, details_json)
    VALUES (?, ?, '{"status":"complete"}')
  `).run(LEARNER_OWNERSHIP_MIGRATION_ID, appliedAt);
}

export function hasLearnerOwnershipSchema(): boolean {
  if (!hasIdentitySchema()) return false;
  return Boolean(getDb().prepare(`
    SELECT 1 FROM schema_migrations WHERE migration_id = ?
  `).get(LEARNER_OWNERSHIP_MIGRATION_ID));
}

export function assertLearnerExists(learnerId: string): void {
  const row = getDb().prepare(`
    SELECT disabled_at
    FROM learners
    WHERE learner_id = ?
  `).get(learnerId) as { disabled_at: string | null } | undefined;
  if (!row) {
    throw new Error(
      `Configured learner "${learnerId}" does not exist. Bootstrap it explicitly before starting the app.`,
    );
  }
  if (row.disabled_at !== null) throw new DisabledLearnerError();
}

export function setLearnerDisabled(learnerId: string, disabled: boolean, at = new Date().toISOString()): void {
  const result = getDb().prepare(`
    UPDATE learners
    SET disabled_at = ?
    WHERE learner_id = ?
  `).run(disabled ? at : null, learnerId);
  if (result.changes !== 1) {
    throw new Error(`Learner "${learnerId}" does not exist.`);
  }
}
