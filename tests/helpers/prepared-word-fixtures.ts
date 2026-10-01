import type { DatabaseSync } from 'node:sqlite';

type ContentStore = Pick<typeof import('../../server/db.ts'), 'saveWordContentDocument' | 'saveWordTeachingPackage'>;

/** Admission-policy fixtures explicitly have teaching ready; readiness itself is tested separately. */
export function prepareWordFixture(sqlite: DatabaseSync, store: ContentStore, wordId: string): void {
  const word = sqlite.prepare('SELECT hanzi, traditional, pinyin, meaning FROM lexical_words WHERE id = ?')
    .get(wordId) as { hanzi: string; traditional: string | null; pinyin: string; meaning: string } | undefined;
  if (!word) throw new Error(`Missing fixture word ${wordId}`);
  const contentId = `fixture-content:${wordId}`;
  store.saveWordContentDocument({ schemaVersion: 1, id: contentId,
    word: { wordId, hanzi: word.hanzi, traditional: word.traditional, pinyin: word.pinyin },
    uses: [{ id: 'use', label: 'Fixture use', notes: ['A prepared admission fixture.'], exampleIds: ['example'] }],
    examples: [{ id: 'example', text: `${word.hanzi}。`, translation: word.meaning || 'Fixture example.', pronunciation: word.pinyin }],
  }, 'fixture');
  store.saveWordTeachingPackage({ schemaVersion: 1, id: `fixture-package:${wordId}`, wordContentId: contentId,
    beats: [{ id: 'beat', parts: [{ kind: 'example', exampleId: 'example', field: 'sentence' }] }],
    rehearsals: [{ id: 'rehearsal', responseMode: 'hanzi_entry', contract: { kind: 'target_rehearsal', wordId },
      instruction: 'Recall the expression.', stimulus: { kind: 'direct_text', text: word.meaning || 'Recall the expression.' },
      acceptedAnswers: [{ wordId, hanzi: word.hanzi, traditional: word.traditional }] }],
  }, 'fixture');
}

/** Test-only teardown removes dependent operational rows before existing lexical fixture cleanup. */
export function clearWordPreparationFixtures(sqlite: DatabaseSync): void {
  const tables = ['learner_word_introduction_events', 'word_teaching_packages', 'word_content_documents',
    'scoped_review_content_records', 'shared_content_publication_events', 'shared_content_reports',
    'shared_content_publication_provenance', 'shared_content_publications'];
  const guards = sqlite.prepare(`SELECT name, sql FROM sqlite_schema
    WHERE type = 'trigger' AND name LIKE '%_no_delete' AND tbl_name IN (${tables.map(() => '?').join(',')})`)
    .all(...tables) as Array<{ name: string; sql: string }>;
  for (const guard of guards) sqlite.exec(`DROP TRIGGER "${guard.name}"`);
  try {
    sqlite.exec(`
      DELETE FROM learner_word_preparation_reserve;
      DELETE FROM learner_word_reserve_requests;
      DELETE FROM word_preparation_attempts;
      DELETE FROM word_preparation_retry_events;
      DELETE FROM word_preparation_work;
      DELETE FROM word_review_preparation;
      DELETE FROM learner_word_introduction_events;
      DELETE FROM word_introduction_preparation;
      DELETE FROM scoped_review_content_records WHERE source_word_content_id IS NOT NULL;
      DELETE FROM word_teaching_packages;
      DELETE FROM word_content_documents;
      DELETE FROM shared_content_publication_events WHERE publication_id IN
        (SELECT publication_id FROM shared_content_publications WHERE content_kind IN ('word_content', 'teaching_package'));
      DELETE FROM shared_content_reports WHERE publication_id IN
        (SELECT publication_id FROM shared_content_publications WHERE content_kind IN ('word_content', 'teaching_package'));
      DELETE FROM shared_content_publication_provenance WHERE publication_id IN
        (SELECT publication_id FROM shared_content_publications WHERE content_kind IN ('word_content', 'teaching_package'));
      DELETE FROM shared_content_publications WHERE content_kind IN ('word_content', 'teaching_package');
    `);
  } finally {
    for (const guard of guards) sqlite.exec(guard.sql);
  }
}
