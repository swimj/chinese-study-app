import { randomUUID } from 'node:crypto';
import { getDb } from './connection.ts';
import { learnerScopedStorageTableName } from './learner-scoped-tables.ts';
import { requireLearnerId } from './learner-context.ts';
import { scopedContentStorageTableName } from './scoped-content-tables.ts';
export const DOGFOOD_SHARED_TRIAL_BACKFILL_REASON = 'one-time dogfood shared-trial backfill';

export type SharedPublicationStatus =
  | 'shared_trial'
  | 'available'
  | 'quarantined'
  | 'retired';

export type SharedContentKind =
  | 'production_cue'
  | 'pure_cue'
  | 'contrast_cluster'
  | 'production_cue_supplement'
  | 'word_content'
  | 'teaching_package';

export type DogfoodSharedTrialBackfillReport = {
  learnerId: string;
  publishedAt: string;
  contrastClusterIds: string[];
  productionCueIds: string[];
  productionCueSupplementIds: string[];
};

export function createSharedContentSchema(): void {
  const invocationsTable = learnerScopedStorageTableName('reflection_operation_invocations');
  const provenanceTable = learnerScopedStorageTableName('shared_content_publication_provenance');
  const reportsTable = learnerScopedStorageTableName('shared_content_reports');
  getDb().exec(`
    CREATE TABLE shared_content_publications (
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

    CREATE TABLE shared_content_publication_events (
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

    CREATE TABLE shared_content_publication_provenance (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id())
        REFERENCES learners(learner_id) ON DELETE CASCADE,
      publication_id TEXT NOT NULL UNIQUE
        REFERENCES shared_content_publications(publication_id) ON DELETE RESTRICT,
      source_content_id TEXT NOT NULL,
      source_invocation_id TEXT NOT NULL,
      authorized_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, publication_id),
      UNIQUE (learner_id, source_content_id),
      FOREIGN KEY (source_invocation_id)
        REFERENCES ${invocationsTable}(invocation_id) ON DELETE RESTRICT
    );

    CREATE TABLE shared_content_reports (
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

    CREATE TRIGGER shared_content_publications_identity_immutable
    BEFORE UPDATE OF
      publication_id, content_kind, content_id, learning_purpose_key, published_at
    ON shared_content_publications
    BEGIN
      SELECT RAISE(ABORT, 'shared content publication identity is immutable');
    END;

    CREATE TRIGGER shared_content_publications_no_delete
    BEFORE DELETE ON shared_content_publications
    BEGIN
      SELECT RAISE(ABORT, 'shared content publications cannot be deleted');
    END;

    CREATE TRIGGER shared_content_publications_status_transition_guard
    BEFORE UPDATE OF publication_status, status_updated_at
    ON shared_content_publications
    WHEN NOT EXISTS (
      SELECT 1
      FROM shared_content_publication_events AS event
      WHERE event.publication_id = OLD.publication_id
        AND event.from_status = OLD.publication_status
        AND event.to_status = NEW.publication_status
        AND event.occurred_at = NEW.status_updated_at
    )
    BEGIN
      SELECT RAISE(ABORT, 'shared content status changes require an attributable publication event');
    END;

    CREATE TRIGGER shared_content_publication_events_immutable
    BEFORE UPDATE ON shared_content_publication_events
    BEGIN
      SELECT RAISE(ABORT, 'shared content publication events are immutable');
    END;

    CREATE TRIGGER shared_content_publication_events_no_delete
    BEFORE DELETE ON shared_content_publication_events
    BEGIN
      SELECT RAISE(ABORT, 'shared content publication events cannot be deleted');
    END;

    CREATE TRIGGER shared_content_publication_provenance_no_delete
    BEFORE DELETE ON ${provenanceTable}
    BEGIN
      SELECT RAISE(ABORT, 'shared content publication provenance cannot be deleted');
    END;

    CREATE TRIGGER shared_content_reports_no_delete
    BEFORE DELETE ON ${reportsTable}
    BEGIN
      SELECT RAISE(ABORT, 'shared content reports cannot be deleted');
    END;

    CREATE TRIGGER shared_content_publication_provenance_same_learner_invocation
    BEFORE INSERT ON ${provenanceTable}
    WHEN NOT EXISTS (
      SELECT 1
      FROM ${invocationsTable} AS invocation
      WHERE invocation.invocation_id = NEW.source_invocation_id
        AND invocation.learner_id = NEW.learner_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'shared content publication must reference a same-learner invocation');
    END;

    CREATE TRIGGER reflection_operation_invocations_published_no_delete
    BEFORE DELETE ON ${invocationsTable}
    WHEN EXISTS (
      SELECT 1
      FROM ${provenanceTable} AS provenance
      WHERE provenance.learner_id = OLD.learner_id
        AND provenance.source_invocation_id = OLD.invocation_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'an invocation with shared publication provenance cannot be deleted');
    END;

    CREATE INDEX idx_shared_content_publications_eligibility
      ON shared_content_publications(
        content_kind, learning_purpose_key, publication_status, publication_id
      );
    CREATE INDEX idx_shared_content_publication_events_publication
      ON shared_content_publication_events(publication_id, occurred_at, event_id);
  `);

  createProductionCuePublicationTransitionGuards();
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

/**
 * Reports the active, learner-owned generated content that the one-time
 * dogfood launch policy will publish. Call within the dogfood learner context.
 */
export function inspectDogfoodSharedTrialBackfill(input: {
  publishedAt: string;
}): DogfoodSharedTrialBackfillReport {
  assertCanonicalIsoTimestamp(input.publishedAt, 'Dogfood shared-trial publication time');
  const learnerId = requireLearnerId();
  return {
    learnerId,
    publishedAt: input.publishedAt,
    contrastClusterIds: unpublishedLearnerContrastClusterIds(learnerId),
    productionCueIds: unpublishedActiveLearnerProductionCueIds(learnerId),
    productionCueSupplementIds: unpublishedActiveLearnerProductionCueSupplementIds(learnerId),
  };
}

/**
 * Applies the explicit one-time launch authorization for existing dogfood
 * content. It is idempotent: already-published and inactive content is left
 * untouched.
 */
export function backfillDogfoodSharedTrialContent(input: {
  publishedAt: string;
}): DogfoodSharedTrialBackfillReport {
  const report = inspectDogfoodSharedTrialBackfill(input);
  const contrastTable = scopedContentStorageTableName('contrast_clusters');
  const cueTable = scopedContentStorageTableName('production_cues');
  const supplementTable = scopedContentStorageTableName('production_cue_supplements');

  return inImmediateTransaction(() => {
    for (const clusterId of report.contrastClusterIds) {
      insertDogfoodSharedTrialPublication({
        contentKind: 'contrast_cluster',
        contentId: clusterId,
        learningPurposeKey: `contrast-cluster:${clusterId}`,
        learnerId: report.learnerId,
        publishedAt: report.publishedAt,
      });
      const result = getDb().prepare(`
        UPDATE ${contrastTable}
        SET content_scope = 'shared', owner_learner_id = NULL
        WHERE id = ? AND content_scope = 'learner' AND owner_learner_id = ?
      `).run(clusterId, report.learnerId);
      if (result.changes !== 1) throw new Error(`Contrast cluster ${clusterId} changed during shared-trial backfill.`);
    }

    for (const cueId of report.productionCueIds) {
      const task = getDb().prepare(`
        SELECT task_id FROM ${cueTable}
        WHERE cue_id = ? AND content_scope = 'learner' AND owner_learner_id = ?
      `).get(cueId, report.learnerId) as { task_id: string } | undefined;
      if (!task) throw new Error(`Production cue ${cueId} changed during shared-trial backfill.`);
      insertDogfoodSharedTrialPublication({
        contentKind: 'production_cue',
        contentId: cueId,
        learningPurposeKey: task.task_id,
        learnerId: report.learnerId,
        publishedAt: report.publishedAt,
      });
      const result = getDb().prepare(`
        UPDATE ${cueTable}
        SET content_scope = 'shared',
            owner_learner_id = NULL,
            origin_kind = 'manual',
            origin_invocation_id = NULL
        WHERE cue_id = ? AND content_scope = 'learner' AND owner_learner_id = ?
      `).run(cueId, report.learnerId);
      if (result.changes !== 1) throw new Error(`Production cue ${cueId} changed during shared-trial backfill.`);
    }

    for (const supplementId of report.productionCueSupplementIds) {
      const task = getDb().prepare(`
        SELECT task_id FROM ${supplementTable}
        WHERE supplement_id = ? AND content_scope = 'learner' AND owner_learner_id = ?
      `).get(supplementId, report.learnerId) as { task_id: string } | undefined;
      if (!task) throw new Error(`Production cue supplement ${supplementId} changed during shared-trial backfill.`);
      insertDogfoodSharedTrialPublication({
        contentKind: 'production_cue_supplement',
        contentId: supplementId,
        learningPurposeKey: task.task_id,
        learnerId: report.learnerId,
        publishedAt: report.publishedAt,
      });
      const result = getDb().prepare(`
        UPDATE ${supplementTable}
        SET content_scope = 'shared', owner_learner_id = NULL, origin_invocation_id = NULL
        WHERE supplement_id = ? AND content_scope = 'learner' AND owner_learner_id = ?
      `).run(supplementId, report.learnerId);
      if (result.changes !== 1) throw new Error(`Production cue supplement ${supplementId} changed during shared-trial backfill.`);
    }

    return report;
  });
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

function unpublishedLearnerContrastClusterIds(learnerId: string): string[] {
  const clusterTable = scopedContentStorageTableName('contrast_clusters');
  return (getDb().prepare(`
    SELECT cluster.id
    FROM ${clusterTable} AS cluster
    LEFT JOIN shared_content_publications AS publication
      ON publication.content_kind = 'contrast_cluster' AND publication.content_id = cluster.id
    WHERE cluster.content_scope = 'learner'
      AND cluster.owner_learner_id = ?
      AND publication.publication_id IS NULL
    ORDER BY cluster.id ASC
  `).all(learnerId) as Array<{ id: string }>).map((row) => row.id);
}

function unpublishedActiveLearnerProductionCueIds(learnerId: string): string[] {
  const cueTable = scopedContentStorageTableName('production_cues');
  const activationTable = learnerScopedStorageTableName('production_cue_activation_state');
  return (getDb().prepare(`
    SELECT cue.cue_id
    FROM ${cueTable} AS cue
    LEFT JOIN ${activationTable} AS activation
      ON activation.learner_id = ? AND activation.cue_id = cue.cue_id
    LEFT JOIN shared_content_publications AS publication
      ON publication.content_kind = 'production_cue' AND publication.content_id = cue.cue_id
    WHERE cue.content_scope = 'learner'
      AND cue.owner_learner_id = ?
      AND COALESCE(activation.active, 0) = 1
      AND publication.publication_id IS NULL
    ORDER BY cue.cue_id ASC
  `).all(learnerId, learnerId) as Array<{ cue_id: string }>).map((row) => row.cue_id);
}

function unpublishedActiveLearnerProductionCueSupplementIds(learnerId: string): string[] {
  const supplementTable = scopedContentStorageTableName('production_cue_supplements');
  const cueTable = scopedContentStorageTableName('production_cues');
  const activationTable = learnerScopedStorageTableName('production_cue_activation_state');
  return (getDb().prepare(`
    SELECT supplement.supplement_id
    FROM ${supplementTable} AS supplement
    LEFT JOIN ${cueTable} AS cue ON cue.cue_id = supplement.cue_id
    LEFT JOIN ${activationTable} AS activation
      ON activation.learner_id = ? AND activation.cue_id = cue.cue_id
    LEFT JOIN shared_content_publications AS publication
      ON publication.content_kind = 'production_cue_supplement'
      AND publication.content_id = supplement.supplement_id
    WHERE supplement.content_scope = 'learner'
      AND supplement.owner_learner_id = ?
      AND publication.publication_id IS NULL
      AND (
        supplement.cue_id IS NULL
        OR (
          cue.content_scope = 'shared'
          OR (
            cue.content_scope = 'learner'
            AND cue.owner_learner_id = ?
            AND COALESCE(activation.active, 0) = 1
          )
        )
      )
    ORDER BY supplement.supplement_id ASC
  `).all(learnerId, learnerId, learnerId) as Array<{ supplement_id: string }>).map((row) => row.supplement_id);
}

function insertDogfoodSharedTrialPublication(input: {
  contentKind: SharedContentKind;
  contentId: string;
  learningPurposeKey: string;
  learnerId: string;
  publishedAt: string;
}): void {
  const publicationId = randomUUID();
  getDb().prepare(`
    INSERT INTO shared_content_publications (
      publication_id, content_kind, content_id, learning_purpose_key,
      publication_status, published_at, status_updated_at
    ) VALUES (?, ?, ?, ?, 'shared_trial', ?, ?)
  `).run(
    publicationId,
    input.contentKind,
    input.contentId,
    input.learningPurposeKey,
    input.publishedAt,
    input.publishedAt,
  );
  appendPublicationEvent({
    publicationId,
    fromStatus: null,
    toStatus: 'shared_trial',
    actorKind: 'source_authorization',
    actorId: input.learnerId,
    reason: DOGFOOD_SHARED_TRIAL_BACKFILL_REASON,
    occurredAt: input.publishedAt,
  });
}

function createProductionCuePublicationTransitionGuards(): void {
  const cueTable = scopedContentStorageTableName('production_cues');
  const supplementTable = scopedContentStorageTableName('production_cue_supplements');
  const provenanceTable = learnerScopedStorageTableName('shared_content_publication_provenance');
  getDb().exec(`
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
      OR EXISTS (
        SELECT 1
        FROM shared_content_publications AS publication
        JOIN shared_content_publication_events AS event
          ON event.publication_id = publication.publication_id
        WHERE publication.content_kind = 'production_cue'
          AND publication.content_id = OLD.cue_id
          AND publication.publication_status = 'shared_trial'
          AND event.from_status IS NULL
          AND event.to_status = 'shared_trial'
          AND event.actor_kind = 'source_authorization'
          AND event.actor_id = OLD.owner_learner_id
          AND event.reason = '${DOGFOOD_SHARED_TRIAL_BACKFILL_REASON}'
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'production cue scope changes require authorized publication');
    END;

    CREATE TRIGGER production_cue_supplements_immutable
    BEFORE UPDATE OF
      supplement_id, task_id, cue_id, english_frame, example_sentence,
      example_translation, created_at
    ON ${supplementTable}
    BEGIN
      SELECT RAISE(ABORT, 'production cue supplements are immutable');
    END;

    CREATE TRIGGER production_cue_supplements_publication_transition
    BEFORE UPDATE OF origin_invocation_id, content_scope, owner_learner_id
    ON ${supplementTable}
    WHEN NOT (
      OLD.content_scope = 'learner'
      AND OLD.owner_learner_id = current_learner_id()
      AND NEW.content_scope = 'shared'
      AND NEW.owner_learner_id IS NULL
      AND NEW.origin_invocation_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM shared_content_publications AS publication
        JOIN shared_content_publication_events AS event
          ON event.publication_id = publication.publication_id
        WHERE publication.content_kind = 'production_cue_supplement'
          AND publication.content_id = OLD.supplement_id
          AND publication.publication_status = 'shared_trial'
          AND event.from_status IS NULL
          AND event.to_status = 'shared_trial'
          AND event.actor_kind = 'source_authorization'
          AND event.actor_id = OLD.owner_learner_id
          AND event.reason = '${DOGFOOD_SHARED_TRIAL_BACKFILL_REASON}'
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'production cue supplement scope changes require authorized publication');
    END;
  `);
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
