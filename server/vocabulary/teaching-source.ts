import type { VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { parseWordContent } from '../../src/domain/word-content/validation.ts';
import { getDb } from '../db/connection.ts';

/** Resolve the pinned bootstrap document, never the latest word-level source. */
export function vocabularyTeachingSource(material: VocabularyJson): VocabularyJson | undefined {
  if (material === null || typeof material !== 'object' || Array.isArray(material)) return undefined;
  const id = material.bootstrapContentId;
  if (typeof id !== 'string') return undefined;
  const row = getDb().prepare('SELECT content_json FROM word_content_documents WHERE content_id=?').get(id) as { content_json: string } | undefined;
  if (!row) throw new Error('Introduction bootstrap source document is missing');
  // Parsing enforces that the retained object really is a source document.
  return JSON.parse(JSON.stringify(parseWordContent(JSON.parse(row.content_json)))) as VocabularyJson;
}
