import { randomUUID } from 'node:crypto';
import { getDb } from './connection.ts';
import { learnerScopedStorageTableName } from './learner-scoped-tables.ts';
import { requireLearnerId } from './learner-context.ts';
import { scopedContentStorageTableName } from './scoped-content-tables.ts';

export const ELIGIBLE_SHARED_PUBLICATION_STATES = ['shared_trial', 'available'] as const;

export type SharedPublicationStatus =
  | 'shared_trial'
  | 'available'
  | 'quarantined'
  | 'retired';

export type SharedContentKind =
  | 'production_cue'
  | 'contrast_cluster'
  | 'production_cue_supplement';

export type SharedContentPublication = {
  publicationId: string;
  contentKind: SharedContentKind;
  contentId: string;
  learningPurposeKey: string;
  publicationStatus: SharedPublicationStatus;
  publishedAt: string;
  statusUpdatedAt: string;
};

export type SharedContentReport = {
  reportId: string;
  publicationId: string;
  category: 'incorrect' | 'misleading' | 'unsafe' | 'other';
  note: string | null;
  createdAt: string;
  resolution: 'open' | 'quarantined' | 'dismissed';
  resolvedAt: string | null;
};

type SharedContentPublicationRow = {
  publication_id: string;
  content_kind: string;
  content_id: string;
  learning_purpose_key: string;
  publication_status: string;
  published_at: string;
  status_updated_at: string;
};

type SourceCueRow = {
  cue_id: string;
  task_id: string;
  cue_type: string;
  cue_text: string;
  created_at: string;
  origin_kind: string;
  origin_invocation_id: string | null;
  owner_learner_id: string | null;
  content_scope: string;
  active: number | null;
};

export function ensureSharedContentSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS shared_content_publications (
      publication_id TEXT PRIMARY KEY,
      content_kind TEXT NOT NULL CHECK (
        content_kind IN ('production_cue', 'contrast_cluster', 'production_cue_supplement')
      ),
      content_id TEXT NOT NULL,
      learning_purpose_key TEXT NOT NULL CHECK (length(trim(learning_purpose_key)) > 0),
      publication_status TEXT NOT NULL CHECK (
        publication_status IN ('shared_trial', 'available', 'quarantined', 'retired')
      ),
      published_at TEXT NOT NULL,
      status_updated_at TEXT NOT NULL,
      UNIQUE (content_kind, content_id)
    );

    CREATE TABLE IF NOT EXISTS shared_content_publication_events (
      event_id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL
        REFERENCES shared_content_publications(publication_id) ON DELETE RESTRICT,
      from_status TEXT CHECK (
        from_status IS NULL OR from_status IN ('shared_trial', 'available', 'quarantined', 'retired')
      ),
      to_status TEXT NOT NULL CHECK (
        to_status IN ('shared_trial', 'available', 'quarantined', 'retired')
      ),
      actor_kind TEXT NOT NULL CHECK (
        actor_kind IN ('source_authorization', 'operator', 'learner_report')
      ),
      actor_id TEXT,
      reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shared_content_publication_provenance (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id())
        REFERENCES learners(learner_id) ON DELETE CASCADE,
      publication_id TEXT NOT NULL UNIQUE
        REFERENCES shared_content_publications(publication_id) ON DELETE RESTRICT,
      source_content_id TEXT NOT NULL,
      source_invocation_id TEXT NOT NULL,
      authorized_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, publication_id),
      UNIQUE (learner_id, source_content_id)
    );

    CREATE TABLE IF NOT EXISTS shared_content_reports (
      report_id TEXT NOT NULL,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id())
        REFERENCES learners(learner_id) ON DELETE CASCADE,
      publication_id TEXT NOT NULL
        REFERENCES shared_content_publications(publication_id) ON DELETE RESTRICT,
      category TEXT NOT NULL CHECK (category IN ('incorrect', 'misleading', 'unsafe', 'other')),
      note TEXT,
      created_at TEXT NOT NULL,
      resolution TEXT NOT NULL DEFAULT 'open'
        CHECK (resolution IN ('open', 'quarantined', 'dismissed')),
      resolved_at TEXT,
      resolved_by_operator_id TEXT,
      PRIMARY KEY (learner_id, report_id),
      UNIQUE (learner_id, publication_id),
      CHECK (
        (resolution = 'open' AND resolved_at IS NULL AND resolved_by_operator_id IS NULL)
        OR (resolution != 'open' AND resolved_at IS NOT NULL AND resolved_by_operator_id IS NOT NULL)
      )
    );

    CREATE TRIGGER IF NOT EXISTS shared_content_publications_identity_immutable
    BEFORE UPDATE OF
      publication_id, content_kind, content_id, learning_purpose_key, published_at
    ON shared_content_publications
    BEGIN
      SELECT RAISE(ABORT, 'shared content publication identity is immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS shared_content_publications_no_delete
    BEFORE DELETE ON shared_content_publications
    BEGIN
      SELECT RAISE(ABORT, 'shared content publications cannot be deleted');
    END;

    CREATE TRIGGER IF NOT EXISTS shared_content_publication_events_immutable
    BEFORE UPDATE ON shared_content_publication_events
    BEGIN
      SELECT RAISE(ABORT, 'shared content publication events are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS shared_content_publication_events_no_delete
    BEFORE DELETE ON shared_content_publication_events
    BEGIN
      SELECT RAISE(ABORT, 'shared content publication events cannot be deleted');
    END;

    CREATE INDEX IF NOT EXISTS idx_shared_content_publications_eligibility
      ON shared_content_publications(
        content_kind, learning_purpose_key, publication_status, publication_id
      );
    CREATE INDEX IF NOT EXISTS idx_shared_content_publication_events_publication
      ON shared_content_publication_events(publication_id, occurred_at, event_id);
  `);

  installProductionCuePublicationTransitionGuards();
}

export function validateSharedContentSchema(): void {
  assertColumns('shared_content_publications', [
    'publication_id', 'content_kind', 'content_id', 'learning_purpose_key',
    'publication_status', 'published_at', 'status_updated_at',
  ]);
  assertColumns('shared_content_publication_events', [
    'event_id', 'publication_id', 'from_status', 'to_status', 'actor_kind', 'actor_id',
    'reason', 'occurred_at',
  ]);
  assertColumns('shared_content_publication_provenance', [
    'publication_id', 'source_content_id', 'source_invocation_id', 'authorized_at',
  ]);
  assertColumns('shared_content_reports', [
    'report_id', 'publication_id', 'category', 'note', 'created_at', 'resolution',
    'resolved_at', 'resolved_by_operator_id',
  ]);
}

export function publishAuthorizedProductionCueWithoutTransaction(input: {
  cueId: string;
  invocationId: string;
  authorizedAt: string;
}): SharedContentPublication {
  const existing = getSharedContentPublicationForContent('production_cue', input.cueId);
  if (existing !== null) return existing;

  assertCanonicalIsoTimestamp(input.authorizedAt, 'Shared publication authorization time');
  const learnerId = requireLearnerId();
  const cueTable = scopedContentStorageTableName('production_cues');
  const activationTable = learnerScopedStorageTableName('production_cue_activation_state');
  const cue = getDb().prepare(`
    SELECT
      cue.cue_id, cue.task_id, cue.cue_type, cue.cue_text, cue.created_at,
      cue.origin_kind, cue.origin_invocation_id, cue.owner_learner_id,
      cue.content_scope, activation.active
    FROM ${cueTable} AS cue
    LEFT JOIN ${activationTable} AS activation
      ON activation.learner_id = ? AND activation.cue_id = cue.cue_id
    WHERE cue.cue_id = ?
  `).get(learnerId, input.cueId) as SourceCueRow | undefined;
  if (
    !cue
    || cue.content_scope !== 'learner'
    || cue.owner_learner_id !== learnerId
    || cue.origin_kind !== 'reflection'
    || cue.origin_invocation_id !== input.invocationId
    || cue.active !== 1
  ) {
    throw new Error(`Production cue ${input.cueId} is not an active authorized learner repair.`);
  }

  const invocation = getDb().prepare(`
    SELECT operation_kind, operation_version, application_state, effect_refs_json
    FROM reflection_operation_invocations
    WHERE invocation_id = ?
  `).get(input.invocationId) as {
    operation_kind: string;
    operation_version: number;
    application_state: string;
    effect_refs_json: string;
  } | undefined;
  if (
    !invocation
    || invocation.operation_kind !== 'repair_production_cue'
    || invocation.operation_version !== 2
    || (invocation.application_state !== 'pending' && invocation.application_state !== 'applied')
    || !effectRefsContain(invocation.effect_refs_json, 'production_cue', input.cueId, invocation.application_state)
  ) {
    throw new Error(`Reflection invocation ${input.invocationId} does not authorize cue ${input.cueId}.`);
  }
  assertReusableProductionCue(cue);

  const publicationId = randomUUID();

  getDb().prepare(`
    INSERT INTO shared_content_publications (
      publication_id, content_kind, content_id, learning_purpose_key,
      publication_status, published_at, status_updated_at
    ) VALUES (?, 'production_cue', ?, ?, 'shared_trial', ?, ?)
  `).run(
    publicationId,
    cue.cue_id,
    cue.task_id,
    input.authorizedAt,
    input.authorizedAt,
  );
  getDb().prepare(`
    INSERT INTO shared_content_publication_provenance (
      publication_id, source_content_id, source_invocation_id, authorized_at
    ) VALUES (?, ?, ?, ?)
  `).run(publicationId, cue.cue_id, input.invocationId, input.authorizedAt);
  appendPublicationEvent({
    publicationId,
    fromStatus: null,
    toStatus: 'shared_trial',
    actorKind: 'source_authorization',
    actorId: null,
    reason: 'validated learner-authorized repair',
    occurredAt: input.authorizedAt,
  });

  getDb().prepare(`
    UPDATE ${cueTable}
    SET content_scope = 'shared',
        owner_learner_id = NULL,
        origin_kind = 'manual',
        origin_invocation_id = NULL
    WHERE cue_id = ?
      AND content_scope = 'learner'
      AND owner_learner_id = ?
  `).run(cue.cue_id, learnerId);

  return getSharedContentPublication(publicationId)!;
}

export function getSharedContentPublication(publicationId: string): SharedContentPublication | null {
  const row = getDb().prepare(`
    SELECT publication_id, content_kind, content_id, learning_purpose_key,
      publication_status, published_at, status_updated_at
    FROM shared_content_publications
    WHERE publication_id = ?
  `).get(publicationId) as SharedContentPublicationRow | undefined;
  return row ? mapPublicationRow(row) : null;
}

export function getSharedContentPublicationForContent(
  contentKind: SharedContentKind,
  contentId: string,
): SharedContentPublication | null {
  const row = getDb().prepare(`
    SELECT publication_id, content_kind, content_id, learning_purpose_key,
      publication_status, published_at, status_updated_at
    FROM shared_content_publications
    WHERE content_kind = ? AND content_id = ?
  `).get(contentKind, contentId) as SharedContentPublicationRow | undefined;
  return row ? mapPublicationRow(row) : null;
}

export function getSharedContentPublicationProvenance(publicationId: string): {
  publicationId: string;
  sourceContentId: string;
  sourceInvocationId: string;
  authorizedAt: string;
} | null {
  const row = getDb().prepare(`
    SELECT publication_id, source_content_id, source_invocation_id, authorized_at
    FROM shared_content_publication_provenance
    WHERE publication_id = ?
  `).get(publicationId) as {
    publication_id: string;
    source_content_id: string;
    source_invocation_id: string;
    authorized_at: string;
  } | undefined;
  return row ? {
    publicationId: row.publication_id,
    sourceContentId: row.source_content_id,
    sourceInvocationId: row.source_invocation_id,
    authorizedAt: row.authorized_at,
  } : null;
}

export function reportSharedContentPublication(input: {
  publicationId: string;
  category: SharedContentReport['category'];
  note?: string | null;
  createdAt?: string;
}): SharedContentReport {
  const createdAt = input.createdAt ?? new Date().toISOString();
  assertCanonicalIsoTimestamp(createdAt, 'Shared content report time');
  if (!getSharedContentPublication(input.publicationId)) {
    throw new Error(`Shared content publication ${input.publicationId} does not exist.`);
  }
  if (!['incorrect', 'misleading', 'unsafe', 'other'].includes(input.category)) {
    throw new Error('Invalid shared content report category.');
  }
  const note = input.note?.trim() || null;
  const existing = getDb().prepare(`
    SELECT report_id
    FROM shared_content_reports
    WHERE publication_id = ?
  `).get(input.publicationId) as { report_id: string } | undefined;
  const reportId = existing?.report_id ?? randomUUID();
  if (!existing) {
    getDb().prepare(`
      INSERT INTO shared_content_reports (
        report_id, publication_id, category, note, created_at,
        resolution, resolved_at, resolved_by_operator_id
      ) VALUES (?, ?, ?, ?, ?, 'open', NULL, NULL)
    `).run(reportId, input.publicationId, input.category, note, createdAt);
  }
  return getSharedContentReport(reportId)!;
}

export function getSharedContentReport(reportId: string): SharedContentReport | null {
  const row = getDb().prepare(`
    SELECT report_id, publication_id, category, note, created_at, resolution, resolved_at
    FROM shared_content_reports
    WHERE report_id = ?
  `).get(reportId) as {
    report_id: string;
    publication_id: string;
    category: SharedContentReport['category'];
    note: string | null;
    created_at: string;
    resolution: SharedContentReport['resolution'];
    resolved_at: string | null;
  } | undefined;
  return row ? {
    reportId: row.report_id,
    publicationId: row.publication_id,
    category: row.category,
    note: row.note,
    createdAt: row.created_at,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
  } : null;
}

export function quarantineSharedContentPublication(input: {
  publicationId: string;
  operatorId: string;
  reason: string;
  occurredAt?: string;
}): SharedContentPublication {
  return inImmediateTransaction(() => transitionSharedContentPublicationWithoutTransaction({
    publicationId: input.publicationId,
    toStatus: 'quarantined',
    actorKind: 'operator',
    actorId: requireNonEmpty(input.operatorId, 'operator id'),
    reason: requireNonEmpty(input.reason, 'quarantine reason'),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  }));
}

export function quarantineSharedContentPublicationFromReport(input: {
  reportId: string;
  operatorId: string;
  occurredAt?: string;
}): SharedContentPublication {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const operatorId = requireNonEmpty(input.operatorId, 'operator id');
  assertCanonicalIsoTimestamp(occurredAt, 'Shared quarantine time');
  return inImmediateTransaction(() => {
    const reportsTable = learnerScopedStorageTableName('shared_content_reports');
    const report = getDb().prepare(`
      SELECT learner_id, publication_id, resolution
      FROM ${reportsTable}
      WHERE report_id = ?
    `).get(input.reportId) as {
      learner_id: string;
      publication_id: string;
      resolution: string;
    } | undefined;
    if (!report) throw new Error(`Shared content report ${input.reportId} does not exist.`);
    if (report.resolution === 'dismissed') {
      throw new Error(`Shared content report ${input.reportId} was already dismissed.`);
    }
    const publication = transitionSharedContentPublicationWithoutTransaction({
      publicationId: report.publication_id,
      toStatus: 'quarantined',
      actorKind: 'learner_report',
      actorId: operatorId,
      reason: 'operator quarantine after private learner report',
      occurredAt,
    });
    getDb().prepare(`
      UPDATE ${reportsTable}
      SET resolution = 'quarantined', resolved_at = ?, resolved_by_operator_id = ?
      WHERE learner_id = ? AND report_id = ? AND resolution = 'open'
    `).run(occurredAt, operatorId, report.learner_id, input.reportId);
    return publication;
  });
}

export function isEligibleSharedPublicationStatus(
  value: SharedPublicationStatus,
): value is (typeof ELIGIBLE_SHARED_PUBLICATION_STATES)[number] {
  return value === 'shared_trial' || value === 'available';
}

function transitionSharedContentPublicationWithoutTransaction(input: {
  publicationId: string;
  toStatus: SharedPublicationStatus;
  actorKind: 'source_authorization' | 'operator' | 'learner_report';
  actorId: string | null;
  reason: string;
  occurredAt: string;
}): SharedContentPublication {
  assertCanonicalIsoTimestamp(input.occurredAt, 'Shared publication transition time');
  const current = getSharedContentPublication(input.publicationId);
  if (!current) throw new Error(`Shared content publication ${input.publicationId} does not exist.`);
  if (current.publicationStatus === input.toStatus) return current;
  if (current.publicationStatus === 'retired') {
    throw new Error(`Retired shared content publication ${input.publicationId} is terminal.`);
  }
  getDb().prepare(`
    UPDATE shared_content_publications
    SET publication_status = ?, status_updated_at = ?
    WHERE publication_id = ? AND publication_status = ?
  `).run(input.toStatus, input.occurredAt, input.publicationId, current.publicationStatus);
  appendPublicationEvent({
    publicationId: input.publicationId,
    fromStatus: current.publicationStatus,
    toStatus: input.toStatus,
    actorKind: input.actorKind,
    actorId: input.actorId,
    reason: input.reason,
    occurredAt: input.occurredAt,
  });
  return getSharedContentPublication(input.publicationId)!;
}

function appendPublicationEvent(input: {
  publicationId: string;
  fromStatus: SharedPublicationStatus | null;
  toStatus: SharedPublicationStatus;
  actorKind: 'source_authorization' | 'operator' | 'learner_report';
  actorId: string | null;
  reason: string;
  occurredAt: string;
}): void {
  getDb().prepare(`
    INSERT INTO shared_content_publication_events (
      event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), input.publicationId, input.fromStatus, input.toStatus,
    input.actorKind, input.actorId, input.reason, input.occurredAt,
  );
}

function effectRefsContain(
  raw: string,
  type: string,
  id: string,
  applicationState: string,
): boolean {
  if (applicationState === 'pending') return true;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.some((ref) => (
      isRecord(ref) && ref.type === type && ref.id === id
    ));
  } catch {
    return false;
  }
}

function assertReusableProductionCue(cue: SourceCueRow): void {
  if (
    !['definition_gloss', 'minimal_context', 'circumstance'].includes(cue.cue_type)
    || cue.cue_text.trim().length === 0
  ) {
    throw new Error(`Production cue ${cue.cue_id} failed shared-content sanitization.`);
  }
  const acceptedWords = getDb().prepare(`
    SELECT accepted.word_id, tasks.word_id AS anchor_word_id
    FROM ${scopedContentStorageTableName('production_cue_accepted_words')} AS accepted
    JOIN production_tasks AS tasks ON tasks.task_id = ?
    WHERE accepted.cue_id = ?
    ORDER BY accepted.position
  `).all(cue.task_id, cue.cue_id) as Array<{ word_id: string; anchor_word_id: string }>;
  if (
    acceptedWords.length === 0
    || !acceptedWords.some((row) => row.word_id === row.anchor_word_id)
  ) {
    throw new Error(`Production cue ${cue.cue_id} has an invalid reusable answer space.`);
  }
}

function installProductionCuePublicationTransitionGuards(): void {
  const cueTable = scopedContentStorageTableName('production_cues');
  const provenanceTable = learnerScopedStorageTableName('shared_content_publication_provenance');
  getDb().exec(`
    DROP TRIGGER IF EXISTS production_cues_immutable;
    DROP TRIGGER IF EXISTS production_cues_publication_transition;

    CREATE TRIGGER production_cues_immutable
    BEFORE UPDATE OF cue_id, task_id, cue_type, cue_text, created_at
    ON ${cueTable}
    BEGIN
      SELECT RAISE(ABORT, 'production cues are immutable');
    END;

    CREATE TRIGGER production_cues_publication_transition
    BEFORE UPDATE OF origin_kind, origin_invocation_id, content_scope, owner_learner_id
    ON ${cueTable}
    WHEN NOT (
      OLD.content_scope = 'learner'
      AND OLD.owner_learner_id = current_learner_id()
      AND OLD.origin_kind = 'reflection'
      AND OLD.origin_invocation_id IS NOT NULL
      AND NEW.content_scope = 'shared'
      AND NEW.owner_learner_id IS NULL
      AND NEW.origin_kind = 'manual'
      AND NEW.origin_invocation_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM ${provenanceTable} AS provenance
        JOIN shared_content_publications AS publication
          ON publication.publication_id = provenance.publication_id
        WHERE provenance.learner_id = current_learner_id()
          AND provenance.source_content_id = OLD.cue_id
          AND provenance.source_invocation_id = OLD.origin_invocation_id
          AND publication.content_kind = 'production_cue'
          AND publication.content_id = OLD.cue_id
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'production cue scope changes require authorized publication');
    END;
  `);
}

function mapPublicationRow(row: SharedContentPublicationRow): SharedContentPublication {
  if (!isSharedContentKind(row.content_kind)) {
    throw new Error(`Unknown shared content kind ${row.content_kind}.`);
  }
  if (!isSharedPublicationStatus(row.publication_status)) {
    throw new Error(`Unknown shared publication status ${row.publication_status}.`);
  }
  return {
    publicationId: row.publication_id,
    contentKind: row.content_kind,
    contentId: row.content_id,
    learningPurposeKey: row.learning_purpose_key,
    publicationStatus: row.publication_status,
    publishedAt: row.published_at,
    statusUpdatedAt: row.status_updated_at,
  };
}

function isSharedContentKind(value: string): value is SharedContentKind {
  return value === 'production_cue'
    || value === 'contrast_cluster'
    || value === 'production_cue_supplement';
}

function isSharedPublicationStatus(value: string): value is SharedPublicationStatus {
  return value === 'shared_trial'
    || value === 'available'
    || value === 'quarantined'
    || value === 'retired';
}

function assertColumns(tableName: string, expected: string[]): void {
  const storageName = tableName === 'shared_content_publication_provenance'
    || tableName === 'shared_content_reports'
    ? learnerScopedStorageTableName(tableName)
    : tableName;
  const columns = new Set((getDb().prepare(`PRAGMA table_info(${storageName})`).all() as Array<{ name: string }>)
    .map((column) => column.name));
  for (const column of expected) {
    if (!columns.has(column)) {
      throw new Error(`Shared content schema is missing ${tableName}.${column}.`);
    }
  }
}

function assertCanonicalIsoTimestamp(value: string, label: string): void {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`Expected non-empty ${label}.`);
  return normalized;
}

function inImmediateTransaction<T>(operation: () => T): T {
  getDb().exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    getDb().exec('COMMIT');
    return result;
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
