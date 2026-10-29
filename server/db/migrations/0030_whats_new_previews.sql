-- Add short previews without rewriting any immutable historical revision.
ALTER TABLE whats_new_posts ADD COLUMN summary TEXT NOT NULL
  DEFAULT 'Read this update for details.' CHECK (length(trim(summary)) BETWEEN 1 AND 300);

-- Hand-authored previews apply only while the seeded title and body still match.
-- Custom/edited posts receive a neutral title-based preview for operator refinement.
WITH historical_previews(post_id, summary) AS (VALUES
  ('update-2026-09-09', 'Return a dismissed reflection proposal to Help with Undo dismiss.'),
  ('update-2026-09-11', 'Choose stash-only new words when you want to focus on vocabulary you picked yourself.'),
  ('update-2026-09-13', 'Browse your collection in My words, choose a starting level, and adjust the difficulty after a session.'),
  ('update-2026-09-14', 'Find getting-started advice, a usage guide, known limitations, and update notes in About.'),
  ('update-2026-09-16', 'Filter My words by learning stage or recent lapses, alongside your search.'),
  ('update-2026-09-17', 'See waiting updates, finish a session with Space, and choose the right match when adding stash words.'),
  ('update-2026-09-22', 'Practice cues with more than one accepted answer, and review proposals that can undo an unfair miss.'),
  ('update-2026-09-23', 'Choose simplified characters, traditional characters, or both for study cards and examples.'),
  ('update-2026-09-27', 'Reflection proposals now address vague production prompts. Share questionable suggestions with Justin.'),
  ('update-2026-10-02', 'Meet new words through a short walkthrough before practicing the expression you learned.'),
  ('update-2026-10-05', 'A calmer study layout keeps the current card in focus, while adjusted failure rates account for compensated misses.'),
  ('update-2026-10-06', 'Connections brings studied words to life with notes about culture, language, and your interests after a session.')
)
UPDATE whats_new_posts AS post
SET summary = COALESCE((
    SELECT preview.summary FROM historical_previews AS preview
    JOIN whats_new_post_revisions AS original ON original.post_id = preview.post_id
      AND original.revision = 1 AND original.actor_id = 'migration:0028'
    WHERE preview.post_id = post.post_id
      AND json_extract(original.post_json, '$.title') = post.title
      AND json(json_extract(original.post_json, '$.paragraphs')) = json(post.paragraphs_json)
  ), 'Read “' || substr(post.title, 1, 200) || '” for the full update.'),
  revision = revision + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO whats_new_post_revisions (post_id, revision, actor_id, saved_at, post_json)
SELECT post_id, revision, 'migration:0030', updated_at,
  json_object('id', post_id, 'revision', revision, 'date', date, 'title', title,
    'summary', summary, 'paragraphs', json(paragraphs_json), 'status', status,
    'publicationSequence', publication_sequence, 'sourceFrom', source_from,
    'sourceThrough', source_through, 'updatedAt', updated_at)
FROM whats_new_posts;
