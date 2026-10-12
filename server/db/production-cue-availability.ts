import type { ProductionCueAvailabilityStatus } from '../../src/domain/content-diagnostics.ts';
import { getDb } from './connection.ts';
import type { SharedPublicationStatus } from './shared-content.ts';

export type ProductionCueAvailabilityFacts = {
  scope: 'learner' | 'shared';
  learnerActive: boolean | null;
  publicationStatus: SharedPublicationStatus | null;
  replacementCueId: string | null;
  sourceEligible: boolean;
};

export type ProductionCueAvailability = {
  active: boolean;
  status: ProductionCueAvailabilityStatus;
  replacementCueId: string | null;
};

/** One policy for serving, diagnostic labels, and active counts. No database reads. */
export function deriveProductionCueAvailability(facts: ProductionCueAvailabilityFacts): ProductionCueAvailability {
  let status: ProductionCueAvailabilityStatus;
  // Replacement is the most useful explanation, even when the old publication
  // was retired and its learner activation preference was retained as history.
  if (facts.replacementCueId !== null) status = 'replaced';
  else if (facts.scope === 'shared' && facts.publicationStatus === 'retired') status = 'retired';
  else if (facts.scope === 'shared' && facts.publicationStatus === 'quarantined') status = 'quarantined';
  else if (facts.scope === 'shared' && facts.publicationStatus === null) status = 'unpublished';
  // A cue cannot outlive a withdrawn pinned source. Unpinned cues are eligible.
  else if (!facts.sourceEligible) status = 'source_unavailable';
  else {
    // Shared publication opts learners in by default; private cues require an
    // explicit activation. An explicit learner opt-out wins in either scope.
    const active = facts.learnerActive ?? (facts.scope === 'shared');
    status = active ? 'active' : 'deactivated';
  }
  return { active: status === 'active', status, replacementCueId: facts.replacementCueId };
}

type VisibleCue = { cue_id: string; content_scope: ProductionCueAvailabilityFacts['scope'] };

/** Load facts for already-visible cues in batches, never one query per cue. */
export function getProductionCueAvailability(cues: readonly VisibleCue[]): Map<string, ProductionCueAvailability> {
  if (cues.length === 0) return new Map();
  const ids = [...new Set(cues.map(cue => cue.cue_id))];
  const placeholders = ids.map(() => '?').join(',');
  const db = getDb();
  const activations = new Map((db.prepare(`
    SELECT cue_id, active FROM production_cue_activation_state WHERE cue_id IN (${placeholders})
  `).all(...ids) as Array<{ cue_id: string; active: number }>).map(row => [row.cue_id, row.active !== 0]));
  const publications = new Map((db.prepare(`
    SELECT content_id, publication_status FROM shared_content_publications
    WHERE content_kind = 'production_cue' AND content_id IN (${placeholders})
  `).all(...ids) as Array<{ content_id: string; publication_status: SharedPublicationStatus }>)
    .map(row => [row.content_id, row.publication_status]));
  const replacements = new Map((db.prepare(`
    SELECT source_id, replacement_source_id FROM content_improvement_replacements
    WHERE kind = 'production_cue' AND source_id IN (${placeholders})
  `).all(...ids) as Array<{ source_id: string; replacement_source_id: string }>)
    .map(row => [row.source_id, row.replacement_source_id]));

  // Read source publication facts without parsing historical exercise documents.
  // The newest record owns the pin; older revisions must not overwrite it.
  const sources = db.prepare(`
    SELECT record.content_id, record.source_word_content_id, publication.publication_status
    FROM scoped_review_content_records record
    LEFT JOIN word_content_documents source ON source.content_id = record.source_word_content_id
    LEFT JOIN shared_content_publications publication ON publication.publication_id = source.publication_id
    WHERE record.kind = 'production_cue' AND record.content_id IN (${placeholders})
    ORDER BY record.revision DESC
  `).all(...ids) as Array<{
    content_id: string; source_word_content_id: string | null; publication_status: SharedPublicationStatus | null;
  }>;
  const sourceEligibility = new Map<string, boolean>();
  for (const source of sources) {
    if (!sourceEligibility.has(source.content_id)) {
      sourceEligibility.set(source.content_id, source.source_word_content_id === null
        || source.publication_status === 'shared_trial' || source.publication_status === 'available');
    }
  }
  return new Map(cues.map(cue => [cue.cue_id, deriveProductionCueAvailability({
    scope: cue.content_scope,
    learnerActive: activations.get(cue.cue_id) ?? null,
    publicationStatus: publications.get(cue.cue_id) ?? null,
    replacementCueId: replacements.get(cue.cue_id) ?? null,
    sourceEligible: sourceEligibility.get(cue.cue_id) ?? true,
  })]));
}
