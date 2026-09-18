export type DurableOwnershipClass =
  | 'shared'
  | 'learner_private'
  | 'mixed_requires_separation'
  | 'operational';

export type DurableObjectDisposition = 'retain' | 'split' | 'retire' | 'replace';

export type DurableOwnershipEntry = {
  table: string;
  ownershipClass: DurableOwnershipClass;
  ownershipRoot: string;
  crossScopeReferences: string;
  enforcementPoints: string;
  historicalOwnership: string;
  migrationTreatment: string;
  disposition: DurableObjectDisposition;
  ambiguity: string | null;
};

/**
 * Accepted SWI-47 inventory of every steady-state application table present on
 * 2026-08-21. Temporary migration tables and SQLite internals are excluded.
 *
 * The manifest describes the required ownership boundary, not merely the
 * columns in the pre-tenancy schema. Tests compare it with sqlite_master so a
 * new durable object cannot land without an explicit classification.
 */
export const durableOwnershipManifest: readonly DurableOwnershipEntry[] = [
  operationalEntry('learners', 'stable local learner identity'),
  operationalEntry('learner_auth_mappings', 'external-provider subject to stable learner mapping'),
  privateEntry('learner_settings', 'learner settings root', 'bootstrap explicit defaults for each learner'),
  privateEntry(
    'learner_params',
    'learner params root',
    'create empty; copy whats_new_seen_through_date from learner_settings when present',
  ),
  operationalEntry('schema_migrations', 'database schema migration ledger'),
  operationalEntry('content_imports', 'shared content import ledger'),
  operationalEntry('service_controls', 'hosted maintenance and provider-work controls'),
  operationalEntry('deployment_sentinels', 'hosted persistence and restore proof markers'),
  operationalEntry('operator_actions', 'attributable hosted administrative action ledger'),
  operationalEntry(
    'usage_daily_snapshots',
    'content-free daily cohort product-usage pulse aggregates',
  ),
  operationalEntry('service_banner', 'current operator-posted signed-in service notice'),
  sharedEntry(
    'shared_content_publications',
    'immutable reusable content plus publication disposition',
    'create explicit available or shared-trial publications without source learner evidence',
  ),
  sharedEntry(
    'shared_content_publication_events',
    'shared content publication lifecycle',
    'retain attributable state transitions without learner-private report or evidence bodies',
  ),
  privateEntry(
    'learner_owned_shared_content_publication_provenance',
    'source learner authorization plus shared publication',
    'retain the private source invocation and content link outside the publication',
    'immutable learner-authorized publication provenance',
  ),
  privateEntry(
    'learner_owned_shared_content_reports',
    'reporting learner plus shared publication',
    'retain report detail privately while shared quarantine records only its attributable disposition',
  ),
  sharedEntry('lexical_words', 'shared lexical word', 'copy lexical fields once from legacy words'),
  privateEntry(
    'learner_word_state',
    'learner plus shared lexical word',
    'assign legacy lifecycle, notes, and coverage to the explicit legacy learner',
  ),
  sharedEntry('lexical_word_meanings', 'shared lexical meaning', 'copy legacy meaning content once'),
  privateEntry(
    'learner_word_meaning_preferences',
    'learner plus shared lexical meaning',
    'assign legacy production-prompt visibility to the explicit legacy learner',
  ),
  {
    table: 'word_lookup_aliases',
    ownershipClass: 'shared',
    ownershipRoot: 'shared lexical word',
    crossScopeReferences: 'aliases resolve shared words only',
    enforcementPoints: 'shared-content persistence boundary',
    historicalOwnership: 'service-visible corpus reference data',
    migrationTreatment: 'import once as shared corpus content',
    disposition: 'retain',
    ambiguity: null,
  },
  ...privateWordStateEntries(),
  ...studyHistoryEntries(),
  ...contrastContentEntries(),
  ...reflectionEntries(),
  ...productionEntries(),
  ...pureCueEntries(),
  ...intakeTriageEntries(),
];

function privateWordStateEntries(): DurableOwnershipEntry[] {
  return [
    privateEntry('learner_owned_user_word_priority', 'learner plus shared word', 'assign current rows to the legacy learner'),
    privateEntry('learner_owned_word_study_admission_state', 'learner plus shared word', 'assign current rows to the legacy learner'),
    privateEntry('learner_owned_word_skill_state', 'learner plus shared word and skill', 'assign current rows to the legacy learner'),
    privateEntry('learner_owned_daily_new_word_intake', 'learner plus UTC day', 'assign current rows to the legacy learner'),
    privateEntry(
      'learner_owned_word_skill_relevance',
      'learner plus shared word and skill',
      'assign current rows and any source event to the same legacy learner',
    ),
  ];
}

function operationalEntry(table: string, ownershipRoot: string): DurableOwnershipEntry {
  return {
    table,
    ownershipClass: 'operational',
    ownershipRoot,
    crossScopeReferences: 'operational identity or ledger rows grant no learner-data access',
    enforcementPoints: 'identity and migration persistence boundary',
    historicalOwnership: 'introduced by SWI-47',
    migrationTreatment: 'created explicitly during fresh bootstrap or legacy upgrade',
    disposition: 'retain',
    ambiguity: null,
  };
}

function sharedEntry(table: string, ownershipRoot: string, migrationTreatment: string): DurableOwnershipEntry {
  return {
    table,
    ownershipClass: 'shared',
    ownershipRoot,
    crossScopeReferences: 'shared content identity grants no learner-state access',
    enforcementPoints: 'shared-content persistence boundary',
    historicalOwnership: 'split from the legacy mixed lexical row by SWI-47',
    migrationTreatment,
    disposition: 'retain',
    ambiguity: null,
  };
}

function studyHistoryEntries(): DurableOwnershipEntry[] {
  return [
    privateEntry('learner_owned_study_sessions', 'learner session root', 'assign current sessions to the legacy learner'),
    privateEntry(
      'learner_owned_review_session_summaries',
      'direct learner analytics root',
      'assign legacy summaries to the explicit learner; session ids remain descriptive rather than authorization roots',
    ),
    privateEntry(
      'learner_owned_study_attempt_events',
      'learner plus source session',
      'assign to the source session learner; retain exact shared-content snapshots',
    ),
    privateEntry(
      'learner_owned_study_events',
      'learner event root because session is optional',
      'assign current events to the legacy learner and verify optional session ownership',
    ),
  ];
}

function contrastContentEntries(): DurableOwnershipEntry[] {
  return [
    scopedContentEntry(
      'scoped_contrast_clusters',
      'contrast artifact root',
      'classify accepted corpus rows as shared available and reflection-created rows as learner-owned',
    ),
    scopedContentEntry(
      'scoped_contrast_cluster_members',
      'contrast cluster scope',
      'inherit the migrated cluster scope; word remains shared',
    ),
    scopedContentEntry(
      'scoped_contrast_prompts',
      'contrast cluster scope',
      'inherit the migrated cluster scope and preserve prompt content',
    ),
  ];
}

function reflectionEntries(): DurableOwnershipEntry[] {
  return [
    privateEntry(
      'learner_owned_reflection_artifacts',
      'direct learner root plus optional source study session',
      'assign session-backed artifacts to the source learner; retain direct learner ownership for sessionless utility artifacts',
      'append-only successful provider artifact',
    ),
    privateEntry(
      'learner_owned_reflection_generation_run_starts',
      'direct learner root plus optional source study session',
      'assign session-backed starts to the source learner; retain direct learner ownership for sessionless utility starts',
      'append-only provider hand-off evidence before terminal outcome',
    ),
    privateEntry(
      'learner_owned_reflection_generation_runs',
      'direct learner root plus optional source study session',
      'assign session-backed runs to the source learner; retain direct learner ownership for sessionless utility runs',
      'append-only provider attempt and retry basis',
    ),
    privateEntry(
      'learner_owned_reflection_proposal_reviews',
      'learner plus reflection artifact',
      'inherit artifact ownership and validate invocation links within the same learner',
    ),
    privateEntry(
      'learner_owned_reflection_operation_invocations',
      'direct learner root because manual operations may have no proposal',
      'assign existing invocations to their artifact/session chain or explicit legacy learner',
      'immutable authorization with mutable recoverable application state',
    ),
    privateEntry(
      'learner_owned_reflection_quality_annotations',
      'learner plus reflection artifact',
      'inherit artifact ownership even when an operator supplies the annotation',
    ),
    privateEntry(
      'learner_owned_reflection_help_inbox',
      'learner plus reflection artifact',
      'inherit artifact ownership',
    ),
  ];
}

function productionEntries(): DurableOwnershipEntry[] {
  return [
    {
      table: 'production_tasks',
      ownershipClass: 'shared',
      ownershipRoot: 'shared word and task kind',
      crossScopeReferences: 'task identity grants no learner state access',
      enforcementPoints: 'shared-content persistence boundary',
      historicalOwnership: 'stable default-production content anchor',
      migrationTreatment: 'retain once as shared task content',
      disposition: 'retain',
      ambiguity: null,
    },
    scopedContentEntry(
      'scoped_production_cues',
      'production cue artifact',
      'remove direct shared-to-private origin coupling and classify cue scope explicitly',
    ),
    scopedContentEntry(
      'scoped_production_cue_accepted_words',
      'production cue scope',
      'inherit cue scope; accepted words remain shared references',
    ),
    scopedContentEntry(
      'scoped_production_cue_supplements',
      'production supplement artifact',
      'remove direct shared-to-private origin coupling and classify supplement scope explicitly',
    ),
    privateEntry(
      'learner_owned_production_cue_lifecycle_events',
      'learner plus accessible production cue',
      'assign current lifecycle to the legacy learner; later publication is a separate lifecycle',
      'append-only learner activation history',
    ),
    privateEntry(
      'learner_owned_production_cue_activation_state',
      'learner plus accessible production cue',
      'rebuild from same-learner lifecycle events',
      'current projection of learner activation history',
    ),
    privateEntry(
      'learner_owned_production_cue_evidence_records',
      'learner evidence root plus same-learner attempts and invocations',
      'assign all private references to the same legacy learner',
      'append-only attempt, judgment, and compensation evidence',
    ),
    privateEntry(
      'learner_owned_production_cue_evidence_projection',
      'learner plus accessible production cue',
      'rebuild from same-learner cue evidence',
      'shadow evidence aggregate; not scheduling authority',
    ),
  ];
}

function pureCueEntries(): DurableOwnershipEntry[] {
  return [
    sharedEntry(
      'pure_cues',
      'shared immutable standalone elicitation content',
      'create empty; pure cues are post-release shared content',
    ),
    sharedEntry(
      'pure_cue_accepted_words',
      'shared pure cue plus shared lexical words',
      'create empty; membership is append-only',
    ),
    privateEntry(
      'learner_pure_cue_state',
      'learner plus shared pure cue scheduling state',
      'create empty; learners adopt eligible published cues independently',
    ),
    privateEntry(
      'pure_cue_served_snapshots',
      'learner plus shared pure cue; session action binds only when consumed',
      'create empty; historical sessions have no fabricated snapshots',
      'immutable served exercise snapshot with one consumption marker',
    ),
    privateEntry(
      'pure_cue_attempts',
      'learner plus consumed pure-cue snapshot',
      'create empty; independent post-release attempt history',
      'immutable assessment batch and scheduler projection evidence',
    ),
    privateEntry(
      'pure_cue_scheduler_compensation_snapshots',
      'learner plus originating session-action batch',
      'create empty; historical attempts return unavailable rather than fabricated state',
      'immutable pre-projection scheduler state with one compensation marker',
    ),
    privateEntry(
      'pure_cue_scheduler_compensation_snapshot_attempts',
      'learner plus same-learner source attempt and compensation batch',
      'create empty; links every post-release batch event to one restore-once key',
      'immutable source-attempt links',
    ),
  ];
}

function intakeTriageEntries(): DurableOwnershipEntry[] {
  return [
    privateEntry(
      'learner_owned_intake_triage_runs',
      'learner provider-operation root',
      'assign current runs to the legacy learner',
      'append-only provider run and cost record',
    ),
    privateEntry(
      'learner_owned_intake_triage_assessments',
      'learner plus intake-triage run',
      'inherit run ownership; word remains shared',
      'immutable provider assessment',
    ),
    privateEntry(
      'learner_owned_intake_triage_assessment_dispositions',
      'learner plus intake-triage assessment',
      'inherit assessment ownership and validate private effect refs',
      'immutable learner disposition',
    ),
  ];
}

function privateEntry(
  table: string,
  ownershipRoot: string,
  migrationTreatment: string,
  historicalOwnership = 'mutable learner-private state',
): DurableOwnershipEntry {
  return {
    table,
    ownershipClass: 'learner_private',
    ownershipRoot,
    crossScopeReferences: 'private references must resolve within the same learner; shared references grant no ownership',
    enforcementPoints: 'required learner context plus learner-bearing keys and same-learner persistence validation',
    historicalOwnership,
    migrationTreatment,
    disposition: 'retain',
    ambiguity: null,
  };
}

function scopedContentEntry(
  table: string,
  ownershipRoot: string,
  migrationTreatment: string,
): DurableOwnershipEntry {
  return {
    table,
    ownershipClass: 'mixed_requires_separation',
    ownershipRoot,
    crossScopeReferences: 'learner-owned content is visible only to its owner; shared publication exposes content but never source evidence',
    enforcementPoints: 'explicit learner-ownership or shared-publication record; exactly one scope per artifact root',
    historicalOwnership: 'content shape is durable but current schema does not distinguish private creation from shared corpus content',
    migrationTreatment,
    disposition: 'split',
    ambiguity: null,
  };
}
