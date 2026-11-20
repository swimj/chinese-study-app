import type { ContentQualityKind, ContentQualityRatingLedger } from '../../src/domain/content-quality.ts';
import { getDb } from './connection.ts';

/** Current non-null votes, ordered newest first. */
export function getContentQualityRatingLedger(): ContentQualityRatingLedger {
  const rows = getDb().prepare(`
    SELECT i.content_key, i.kind, i.source_id, i.title, i.content_json, r.rating, r.updated_at
    FROM learner_content_quality_ratings r
    JOIN content_quality_items i ON i.content_key = r.content_key
    ORDER BY r.updated_at DESC, i.content_key ASC, r.rating ASC
  `).all() as Array<{
    content_key: string;
    kind: ContentQualityKind;
    source_id: string;
    title: string;
    content_json: string;
    rating: 'up' | 'down';
    updated_at: string;
  }>;
  const ratings = rows.map((row) => {
    return {
      contentKey: row.content_key,
      kind: row.kind,
      sourceId: row.source_id,
      title: row.title,
      content: JSON.parse(row.content_json),
      rating: row.rating,
      updatedAt: row.updated_at,
    };
  });
  return { ratings, totalRatings: ratings.length };
}

export function validateContentQualitySchema(): void {
  for (const table of ['content_quality_items', 'learner_content_quality_encounters', 'learner_content_quality_ratings']) {
    if (!getDb().prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) {
      throw new Error(`Missing ${table}`);
    }
  }
}
