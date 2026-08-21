import { getDb } from './connection.ts';

export const LOCAL_AUTH_PROVIDER = 'trusted_local';

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

export function hasIdentitySchema(): boolean {
  const row = getDb().prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'learners'
  `).get() as { present: number } | undefined;
  return row?.present === 1;
}

export function assertLearnerExists(learnerId: string): void {
  const row = getDb().prepare(`
    SELECT 1 AS present
    FROM learners
    WHERE learner_id = ? AND disabled_at IS NULL
  `).get(learnerId) as { present: number } | undefined;
  if (row?.present !== 1) {
    throw new Error(
      `Configured learner "${learnerId}" does not exist. Bootstrap it explicitly before starting the app.`,
    );
  }
}
