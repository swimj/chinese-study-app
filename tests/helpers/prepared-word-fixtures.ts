import type { DatabaseSync } from 'node:sqlite';
import type { TeachingPackage, WordContentDocument } from '../../src/domain/word-content/types.ts';

/** Seed ready teaching material for admission-policy tests. */
export function prepareWordFixture(sqlite: DatabaseSync, wordId: string): void {
  const word = sqlite.prepare('SELECT hanzi, traditional, pinyin, meaning FROM lexical_words WHERE id = ?')
    .get(wordId) as { hanzi: string; traditional: string | null; pinyin: string; meaning: string } | undefined;
  if (!word) throw new Error(`Missing fixture word ${wordId}`);
  const contentId = `fixture-content:${wordId}`;
  const packageId = `fixture-package:${wordId}`;
  const content: WordContentDocument = { schemaVersion: 1, id: contentId,
    word: { wordId, hanzi: word.hanzi, traditional: word.traditional, pinyin: word.pinyin },
    uses: [{ id: 'use', label: 'Fixture use', notes: ['A prepared admission fixture.'], exampleIds: ['example'] }],
    examples: [{ id: 'example', text: `${word.hanzi}。`, translation: word.meaning || 'Fixture example.', pronunciation: word.pinyin }],
  };
  const teaching: TeachingPackage = { schemaVersion: 1, id: packageId, wordContentId: contentId,
    beats: [{ id: 'beat', parts: [{ kind: 'example', exampleId: 'example', field: 'sentence' }] }],
    rehearsals: [{ id: 'rehearsal', responseMode: 'hanzi_entry', contract: { kind: 'target_rehearsal', wordId },
      instruction: 'Recall the expression.', stimulus: { kind: 'direct_text', text: word.meaning || 'Recall the expression.' },
      acceptedAnswers: [{ wordId, hanzi: word.hanzi, traditional: word.traditional }] }],
  };
  insertPublishedWordContent(sqlite, { content, teaching, model: 'fixture' });
}

/** Publish a shared-trial bootstrap document and its optional teaching package in a fixture database. */
export function insertPublishedWordContent(sqlite: DatabaseSync, input: {
  content: WordContentDocument;
  teaching?: TeachingPackage;
  model: string;
  createdAt?: string;
}): void {
  const now = input.createdAt ?? new Date().toISOString();
  const wordId = input.content.word.wordId;
  const contentId = input.content.id;
  const contentPublicationId = publishFixture(sqlite, 'word_content', contentId, wordId, now);
  sqlite.prepare(`INSERT INTO word_content_documents (
      content_id, word_id, content_json, model, created_at, publication_id
    ) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(contentId, wordId, JSON.stringify(input.content), input.model, now, contentPublicationId);
  if (!input.teaching) return;
  const packageId = input.teaching.id;
  const packagePublicationId = publishFixture(sqlite, 'teaching_package', packageId, wordId, now);
  sqlite.prepare(`INSERT INTO word_teaching_packages (
      package_id, word_id, content_id, package_json, model, created_at, publication_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(packageId, wordId, contentId, JSON.stringify(input.teaching), input.model, now, packagePublicationId);
}

function publishFixture(
  sqlite: DatabaseSync,
  kind: 'word_content' | 'teaching_package',
  contentId: string,
  wordId: string,
  now: string,
): string {
  const publicationId = `fixture-publication:${kind}:${contentId}`;
  sqlite.prepare(`INSERT INTO shared_content_publications (
      publication_id, content_kind, content_id, learning_purpose_key,
      publication_status, published_at, status_updated_at
    ) VALUES (?, ?, ?, ?, 'shared_trial', ?, ?)`).run(publicationId, kind, contentId, wordId, now, now);
  sqlite.prepare(`INSERT INTO shared_content_publication_events (
      event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at
    ) VALUES (?, ?, NULL, 'shared_trial', 'source_authorization', NULL, 'fixture word introduction publication', ?)`)
    .run(`fixture-publication-event:${kind}:${contentId}`, publicationId, now);
  return publicationId;
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
