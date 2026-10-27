import type { VocabularyStudy, VocabularyStudyWord } from '../../domain/vocabulary-study-api';

/** Covered words only, with recency taken from the acknowledged, effective session log. */
export function vocabularySessionHistory(study: VocabularyStudy, currentRevealed: boolean): VocabularyStudyWord[] {
  const projection = study.session.projection;
  const undone = new Set(projection.undoneActionIds);
  const encounters = new Map(projection.encounters.filter((entry) => !entry.presentationUndone).map((entry) => [entry.encounterId, entry]));
  const recency = new Map<string, number>();
  for (const action of study.session.actions) {
    if (undone.has(action.actionId)) continue;
    const payload = action.payload;
    const wordId = 'wordId' in payload ? payload.wordId : 'encounterId' in payload ? encounters.get(payload.encounterId)?.wordId : null;
    if (wordId) recency.set(wordId, action.sequence);
  }
  const concealedCurrent = study.currentEncounter?.snapshot.kind === 'production' || study.currentEncounter?.snapshot.kind === 'contrast';
  return study.words.filter((word) => projection.words[word.wordId]?.covered
    && (word.wordId !== study.currentWordId || !concealedCurrent || currentRevealed)
    && [...encounters.values()].some((entry) => entry.wordId === word.wordId
      && (entry.snapshot.kind === 'introduction' || entry.snapshot.kind === 'recognition' || entry.effectiveResponses.length > 0)))
    .sort((left, right) => (recency.get(right.wordId) ?? 0) - (recency.get(left.wordId) ?? 0));
}
