import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
export type VocabularyInvocationActor = { kind: 'service'; id: string } | { kind: 'learner'; id: string };
type ContentLink = { invocationId: string; contentId: string; contentVersion: number; role: 'input' | 'output' | 'revised_from' | 'evaluated' };
type SenseLink = { invocationId: string; senseId: string; senseVersion: number; role: 'input' | 'output' | 'evaluated' };
function authorize(db: DatabaseSync,invocationId: string,actor: VocabularyInvocationActor): void {
  if (actor.kind === 'learner' && requireLearnerId() !== actor.id) throw new Error('Invocation actor does not match learner context');
  if (!db.prepare('SELECT 1 FROM model_invocations WHERE id=? AND actor_kind=? AND actor_id=?').get(invocationId,actor.kind,actor.id)) {
    throw new Error('Invocation does not belong to the specified actor');
  }
}
/** Trusted backend attribution; a link records the exact version used, not authorship by an evaluator. */
export function linkVocabularyInvocationContent(input: ContentLink,actor: VocabularyInvocationActor,db = getDb()): void {
  authorize(db,input.invocationId,actor);
  db.prepare('INSERT OR IGNORE INTO invocation_content_links(invocation_id,content_id,content_version,role) VALUES (?,?,?,?)')
    .run(input.invocationId,input.contentId,input.contentVersion,input.role);
}
export function linkVocabularyInvocationSense(input: SenseLink,actor: VocabularyInvocationActor,db = getDb()): void {
  authorize(db,input.invocationId,actor);
  db.prepare('INSERT OR IGNORE INTO invocation_sense_links(invocation_id,sense_id,sense_version,role) VALUES (?,?,?,?)')
    .run(input.invocationId,input.senseId,input.senseVersion,input.role);
}
/** Internal publication adapter: the id must come from the trusted provider observer/component ledger.
 * Learner and service calls stay attributable to their original actors; no private evidence is published. */
export function linkVocabularyPublicationOutput(db: DatabaseSync,invocationId: string | null | undefined,
  sourceKind: 'bootstrap' | 'teaching_package' | 'teaching_exercise' | 'production_cue' | 'production_cue_supplement',
  sourceId: string,sourceSubId = '',options: { allowUnresolvedLegacy?: boolean } = {}): void {
  if (invocationId == null) return;
  const invocation = db.prepare('SELECT actor_kind,actor_id FROM model_invocations WHERE id=?').get(invocationId) as { actor_kind: 'learner' | 'service'; actor_id: string } | undefined;
  if (!invocation) {
    // Older retained component invocation handles had no ledger FK and can be unresolvable.
    // Keep that gap explicit rather than invent a model call or discard useful teaching.
    if (!options.allowUnresolvedLegacy) throw new Error('Publication invocation is missing');
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT INTO backend_events(event_id,occurred_at,recorded_at,name,payload_version,data_json,actor_kind,actor_id)
      VALUES (?,?,?,'vocabulary.provenance.unresolved_legacy_invocation',1,?,'service','vocabulary-publication')`)
      .run(randomUUID(),timestamp,timestamp,JSON.stringify({ invocationId,sourceKind,sourceId,sourceSubId }));
    return;
  }
  // These publication paths have already established shared-only source authority. SQL scope
  // guards also reject private derivation, independently of the request's ambient learner.
  if (sourceKind === 'bootstrap') {
    const senses = db.prepare('SELECT sense_id,imported_sense_version FROM legacy_sense_imports WHERE source_content_id=?').all(sourceId) as Array<{ sense_id: string; imported_sense_version: number }>;
    for (const sense of senses) db.prepare('INSERT OR IGNORE INTO invocation_sense_links VALUES (?,?,?,\'output\')')
      .run(invocationId,sense.sense_id,sense.imported_sense_version);
    return;
  }
  const content = db.prepare('SELECT content_id,imported_content_version FROM legacy_content_imports WHERE source_kind=? AND source_id=? AND source_sub_id=?')
    .get(sourceKind,sourceId,sourceSubId) as { content_id: string; imported_content_version: number } | undefined;
  if (!content) throw new Error('Published vocabulary content mapping is missing');
  db.prepare('INSERT OR IGNORE INTO invocation_content_links VALUES (?,?,?,\'output\')').run(invocationId,content.content_id,content.imported_content_version);
}
