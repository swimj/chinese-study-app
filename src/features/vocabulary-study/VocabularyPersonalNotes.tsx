import type { VocabularyStudyWord } from '../../domain/vocabulary-study-api';

/** Existing notes remain readable after reveal while note authoring is paused. */
export function VocabularyPersonalNotes({ word }: { word: VocabularyStudyWord }) {
  const notes = word.personalNotes ?? '';
  if (!notes.trim()) return null;
  return <section className="vocab-personal-notes" aria-label="Your notes">
    <p><strong>Your notes</strong><span>{notes}</span></p>
  </section>;
}
