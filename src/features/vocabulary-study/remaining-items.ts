import type { VocabularySessionInitialContext, VocabularySessionProjection } from '../../domain/vocabulary-session';

/** Remaining study items, not the exercises or successful responses needed to finish them. */
export function vocabularyRemainingItemCount(
  context: VocabularySessionInitialContext,
  projection: VocabularySessionProjection,
): number {
  if (projection.phase === 'completed') return 0;
  const words = Object.values(projection.words).filter((word) => !word.teachingDeferred
    && (word.workStatus === 'open' || (projection.phase === 'active' && !word.admitted))).length;
  const encounters = projection.encounters.filter((entry) => !entry.presentationUndone
    && entry.snapshot.schedulingScope === 'pure_cue');
  // The frozen review order includes cues not presented yet. Retained older logs may only
  // supply presented cues, so include those identities without counting repeat encounters.
  const cueIds = new Set([
    ...(context.reviewOrder ?? []).filter((entry) => entry.kind === 'pure_cue').map((entry) => entry.id),
    ...encounters.map((entry) => entry.snapshot.contentId),
  ]);
  const cues = [...cueIds].filter((id) => {
    if (projection.excludedContentIds.includes(id)) return false;
    if (projection.pureCueOutcomes.some((outcome) => outcome.contentId === id && outcome.covered)) return false;
    const seen = encounters.filter((entry) => entry.snapshot.contentId === id);
    if (seen.some((entry) => entry.skipped)) return false;
    return projection.phase === 'active' || seen.length > 0;
  }).length;
  return words + cues;
}
