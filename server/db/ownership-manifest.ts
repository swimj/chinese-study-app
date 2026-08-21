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
  operationalEntry('schema_migrations', 'database schema migration ledger'),
  operationalEntry('content_imports', 'shared content import ledger'),
  {
    table: 'words',
    ownershipClass: 'mixed_requires_separation',
    ownershipRoot: 'shared lexical word plus learner-word state',
    crossScopeReferences: 'shared word identity never authorizes learner state',
    enforcementPoints: 'split shared lexical fields from learner-owned lifecycle, notes, and coverage',
    historicalOwnership: 'existing row combines shared corpus content with the implicit local learner',
    migrationTreatment: 'copy lexical fields once and assign private fields to the explicit legacy learner',
    disposition: 'split',
    ambiguity: null,
  },
  {
    table: 'word_meanings',
    ownershipClass: 'mixed_requires_separation',
    ownershipRoot: 'shared meaning plus learner meaning-prompt preference',
    crossScopeReferences: 'meaning content is shared; visibility is private',
    enforcementPoints: 'move show_on_production_prompt to a narrow learner overlay',
    historicalOwnership: 'meaning text and the implicit learner preference currently share one row',
    migrationTreatment: 'retain compatibility meaning storage and assign visibility to the legacy learner',
    disposition: 'split',
    ambiguity: null,
  },
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
  {
    table: 'app_metadata',
    ownershipClass: 'mixed_requires_separation',
    ownershipRoot: 'learner settings, schema ledger, and content/import ledgers',
    crossScopeReferences: 'operational facts grant no learner-data access',
    enforcementPoints: 'typed scoped tables replace the global keyspace',
    historicalOwnership: 'daily limit and one-shot migration markers share global keys',
    migrationTreatment: 'move learner settings to the legacy learner and markers to explicit ledgers',
    disposition: 'replace',
    ambiguity: null,
  },
  ...privateWordStateEntries(),
  ...studyHistoryEntries(),
  {
    table: 'contrast_candidate_intake',
    ownershipClass: 'learner_private',
    ownershipRoot: 'learner and optional source study event',
    crossScopeReferences: 'shared word references grant no access',
    enforcementPoints: 'retired rather than tenant-adapted',
    historicalOwnership: 'vestigial private mistake-intake state',
    migrationTreatment: 'drop; no hosted import',
    disposition: 'retire',
    ambiguity: null,
  },
  {
    table: 'study_content_feedback',
    ownershipClass: 'learner_private',
    ownershipRoot: 'learner and optional source study event',
    crossScopeReferences: 'polymorphic content target grants no ownership',
    enforcementPoints: 'replace with purpose-specific learner definition-fallback and contrast-prompt exclusions',
    historicalOwnership: 'vestigial private feedback with unenforced target ids',
    migrationTreatment: 'fold active reports into narrow exclusions with explicit legacy migration provenance; retain a validation report',
    disposition: 'replace',
    ambiguity: null,
  },
  ...contrastContentEntries(),
  ...reflectionEntries(),
  ...productionEntries(),
  ...intakeTriageEntries(),
];

function privateWordStateEntries(): DurableOwnershipEntry[] {
  return [
    privateEntry('user_word_priority', 'learner plus shared word', 'assign current rows to the legacy learner'),
    privateEntry('word_study_admission_state', 'learner plus shared word', 'assign current rows to the legacy learner'),
    privateEntry('word_skill_state', 'learner plus shared word and skill', 'assign current rows to the legacy learner'),
    privateEntry('daily_new_word_intake', 'learner plus UTC day', 'assign current rows to the legacy learner'),
    privateEntry(
      'word_skill_relevance',
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

function studyHistoryEntries(): DurableOwnershipEntry[] {
  return [
    privateEntry('study_sessions', 'learner session root', 'assign current sessions to the legacy learner'),
    privateEntry(
      'review_session_summaries',
      'learner plus source session',
      'assign to the source session learner and add the missing ownership-bearing reference',
    ),
    privateEntry(
      'study_attempt_events',
      'learner plus source session',
      'assign to the source session learner; retain exact shared-content snapshots',
    ),
    privateEntry(
      'study_events',
      'learner event root because session is optional',
      'assign current events to the legacy learner and verify optional session ownership',
    ),
  ];
}

function contrastContentEntries(): DurableOwnershipEntry[] {
  return [
    scopedContentEntry(
      'contrast_clusters',
      'contrast artifact root',
      'classify accepted corpus rows as shared available and reflection-created rows as learner-owned',
    ),
    scopedContentEntry(
      'contrast_cluster_members',
      'contrast cluster scope',
      'inherit the migrated cluster scope; word remains shared',
    ),
    scopedContentEntry(
      'contrast_prompts',
      'contrast cluster scope',
      'inherit the migrated cluster scope and preserve prompt content',
    ),
  ];
}

function reflectionEntries(): DurableOwnershipEntry[] {
  return [
    privateEntry(
      'reflection_artifacts',
      'learner plus source study session',
      'assign to and enforce the source session learner',
      'append-only successful provider artifact',
    ),
    privateEntry(
      'reflection_generation_runs',
      'learner plus source study session',
      'assign to and enforce the source session learner',
      'append-only provider attempt and retry basis',
    ),
    privateEntry(
      'reflection_proposal_reviews',
      'learner plus reflection artifact',
      'inherit artifact ownership and validate invocation links within the same learner',
    ),
    privateEntry(
      'reflection_operation_invocations',
      'direct learner root because manual operations may have no proposal',
      'assign existing invocations to their artifact/session chain or explicit legacy learner',
      'immutable authorization with mutable recoverable application state',
    ),
    privateEntry(
      'reflection_quality_annotations',
      'learner plus reflection artifact',
      'inherit artifact ownership even when an operator supplies the annotation',
    ),
    privateEntry(
      'reflection_help_inbox',
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
      'production_cues',
      'production cue artifact',
      'remove direct shared-to-private origin coupling and classify cue scope explicitly',
    ),
    scopedContentEntry(
      'production_cue_accepted_words',
      'production cue scope',
      'inherit cue scope; accepted words remain shared references',
    ),
    scopedContentEntry(
      'production_cue_supplements',
      'production supplement artifact',
      'remove direct shared-to-private origin coupling and classify supplement scope explicitly',
    ),
    privateEntry(
      'production_cue_lifecycle_events',
      'learner plus accessible production cue',
      'assign current lifecycle to the legacy learner; later publication is a separate lifecycle',
      'append-only learner activation history',
    ),
    privateEntry(
      'production_cue_activation_state',
      'learner plus accessible production cue',
      'rebuild from same-learner lifecycle events',
      'current projection of learner activation history',
    ),
    privateEntry(
      'production_cue_evidence_records',
      'learner evidence root plus same-learner attempts and invocations',
      'assign all private references to the same legacy learner',
      'append-only attempt, judgment, and compensation evidence',
    ),
    privateEntry(
      'production_cue_evidence_projection',
      'learner plus accessible production cue',
      'rebuild from same-learner cue evidence',
      'shadow evidence aggregate; not scheduling authority',
    ),
    privateEntry(
      'production_recheck_demands',
      'learner plus production task and source attempt',
      'assign source, consumer, and replacement references to one learner',
      'temporary learner scheduling demand',
    ),
  ];
}

function intakeTriageEntries(): DurableOwnershipEntry[] {
  return [
    privateEntry(
      'intake_triage_runs',
      'learner provider-operation root',
      'assign current runs to the legacy learner',
      'append-only provider run and cost record',
    ),
    privateEntry(
      'intake_triage_assessments',
      'learner plus intake-triage run',
      'inherit run ownership; word remains shared',
      'immutable provider assessment',
    ),
    privateEntry(
      'intake_triage_assessment_dispositions',
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
