import { randomUUID } from 'node:crypto';
import type { SavedTeachingPackage, SavedWordContent, WordIntroductionLibrary } from '../../src/domain/word-content/application.ts';
import { materializeTeachingPackage } from '../../src/domain/word-content/materialize.ts';
import type { TeachingPackage, WordContentDocument } from '../../src/domain/word-content/types.ts';
import { parseTeachingPackage, parseWordContent } from '../../src/domain/word-content/validation.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

export class WordIntroductionError extends Error {
  constructor(readonly code: 'not_found' | 'invalid_source' | 'conflict', message: string) {
    super(message);
    this.name = 'WordIntroductionError';
  }
}

type LexicalRow = { id: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string };
type ContentRow = { content_id: string; content_json: string; created_at: string; model: string; word_id: string };
type PackageRow = { package_id: string; package_json: string; created_at: string; model: string; word_id: string; content_id: string };

function transaction<T>(operation: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function lexicalRow(wordId: string): LexicalRow | null {
  return getDb().prepare(`
    SELECT id, hanzi, traditional, pinyin, meaning FROM lexical_words WHERE id = ?
  `).get(wordId) as LexicalRow | undefined ?? null;
}

export function getIntroductionLexicalWord(wordId: string): {
  wordId: string; hanzi: string; traditional: string | null; pinyin: string; meanings: string[];
} | null {
  requireLearnerId();
  const word = lexicalRow(wordId);
  if (!word) return null;
  const meanings = getDb().prepare(`
    SELECT text FROM lexical_word_meanings WHERE word_id = ? ORDER BY position, id
  `).all(wordId) as Array<{ text: string }>;
  return {
    wordId: word.id, hanzi: word.hanzi, traditional: word.traditional, pinyin: word.pinyin,
    meanings: meanings.length ? meanings.map((entry) => entry.text) : [word.meaning],
  };
}

function assertWordIdentity(content: WordContentDocument): void {
  const lexical = lexicalRow(content.word.wordId);
  if (!lexical) throw new WordIntroductionError('not_found', 'Word not found');
  if (content.word.hanzi !== lexical.hanzi
    || content.word.traditional !== lexical.traditional
    || content.word.pinyin !== lexical.pinyin) {
    throw new WordIntroductionError('invalid_source', 'Word content does not match its lexical source');
  }
}

function modelName(model: string): string {
  if (typeof model !== 'string' || !model.trim()) {
    throw new WordIntroductionError('invalid_source', 'Model name is required');
  }
  return model.trim();
}

function insertPublication(kind: 'word_content' | 'teaching_package', contentId: string, wordId: string, now: string): string {
  const publicationId = randomUUID();
  getDb().prepare(`
    INSERT INTO shared_content_publications (
      publication_id, content_kind, content_id, learning_purpose_key,
      publication_status, published_at, status_updated_at
    ) VALUES (?, ?, ?, ?, 'shared_trial', ?, ?)
  `).run(publicationId, kind, contentId, wordId, now, now);
  getDb().prepare(`
    INSERT INTO shared_content_publication_events (
      event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at
    ) VALUES (?, ?, NULL, 'shared_trial', 'source_authorization', NULL, ?, ?)
  `).run(randomUUID(), publicationId, 'automatic validated word introduction publication', now);
  return publicationId;
}

function contentFromRow(row: ContentRow): SavedWordContent {
  return { createdAt: row.created_at, content: parseWordContent(JSON.parse(row.content_json)) };
}

function packageFromRow(row: PackageRow): SavedTeachingPackage {
  return { createdAt: row.created_at, teaching: parseTeachingPackage(JSON.parse(row.package_json)) };
}

export function saveWordContentDocument(input: WordContentDocument, model: string): SavedWordContent {
  requireLearnerId();
  const content = parseWordContent(input);
  const sourceModel = modelName(model);
  assertWordIdentity(content);
  return transaction(() => insertContent(content, sourceModel));
}

function insertContent(content: WordContentDocument, sourceModel: string): SavedWordContent {
  const json = JSON.stringify(content);
  const existing = getDb().prepare(`
      SELECT content_id, content_json, created_at, model, word_id
      FROM word_content_documents WHERE content_id = ?
    `).get(content.id) as ContentRow | undefined;
  if (existing) {
    if (existing.content_json !== json || existing.word_id !== content.word.wordId) {
      throw new WordIntroductionError('conflict', 'Word content identity already has a different payload');
    }
    return contentFromRow(existing);
  }
  const now = new Date().toISOString();
  const publicationId = insertPublication('word_content', content.id, content.word.wordId, now);
  getDb().prepare(`
      INSERT INTO word_content_documents (
        content_id, word_id, content_json, model, created_at, publication_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(content.id, content.word.wordId, json, sourceModel, now, publicationId);
  return { createdAt: now, content };
}

export function saveWordTeachingPackage(input: TeachingPackage, model: string): SavedTeachingPackage {
  requireLearnerId();
  const teaching = parseTeachingPackage(input);
  const sourceModel = modelName(model);
  return transaction(() => insertTeaching(teaching, sourceModel));
}

function insertTeaching(teaching: TeachingPackage, sourceModel: string): SavedTeachingPackage {
  const source = getDb().prepare(`
    SELECT content_id, content_json, created_at, model, word_id
    FROM word_content_documents WHERE content_id = ?
  `).get(teaching.wordContentId) as ContentRow | undefined;
  if (!source) throw new WordIntroductionError('invalid_source', 'Pinned word content not found');
  const eligibleSource = getDb().prepare(`
    SELECT 1 FROM word_content_documents AS content
    JOIN shared_content_publications AS publication ON publication.publication_id = content.publication_id
    WHERE content.content_id = ? AND publication.publication_status IN ('shared_trial', 'available')
  `).get(teaching.wordContentId);
  if (!eligibleSource) {
    throw new WordIntroductionError('invalid_source', 'Pinned word content is withdrawn');
  }
  const content = parseWordContent(JSON.parse(source.content_json));
  materializeTeachingPackage(teaching, [content]);
  const json = JSON.stringify(teaching);
  const existing = getDb().prepare(`
      SELECT package_id, package_json, created_at, model, word_id, content_id
      FROM word_teaching_packages WHERE package_id = ?
    `).get(teaching.id) as PackageRow | undefined;
  if (existing) {
    if (existing.package_json !== json || existing.content_id !== teaching.wordContentId) {
      throw new WordIntroductionError('conflict', 'Teaching package identity already has a different payload');
    }
    return packageFromRow(existing);
  }
  const now = new Date().toISOString();
  const publicationId = insertPublication('teaching_package', teaching.id, source.word_id, now);
  getDb().prepare(`
      INSERT INTO word_teaching_packages (
        package_id, word_id, content_id, package_json, model, created_at, publication_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(teaching.id, source.word_id, source.content_id, json, sourceModel, now, publicationId);
  return { createdAt: now, teaching };
}

type PreparationRow = {
  word_id: string;
  content_id: string | null;
  package_id: string | null;
  active_stage: 'bootstrap' | 'teaching' | null;
  lease_token: string | null;
  lease_expires_at: string | null;
};
export type WordIntroductionStage = 'bootstrap' | 'teaching';

function preparationRow(wordId: string): PreparationRow | null {
  return getDb().prepare(`
    SELECT word_id, content_id, package_id, active_stage, lease_token, lease_expires_at
    FROM word_introduction_preparation WHERE word_id = ?
  `).get(wordId) as PreparationRow | undefined ?? null;
}

export function getWordIntroductionPreparation(wordId: string): {
  contentId: string | null; packageId: string | null; activeStage: WordIntroductionStage | null;
} | null {
  requireLearnerId();
  if (!lexicalRow(wordId)) return null;
  const row = preparationRow(wordId);
  return { contentId: row?.content_id ?? null, packageId: row?.package_id ?? null,
    activeStage: row?.active_stage ?? null };
}

function canonicalTime(value: string, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new WordIntroductionError('invalid_source', `${name} must be canonical UTC ISO time`);
  }
  return value;
}

export function claimWordIntroductionStage(
  wordId: string, stage: WordIntroductionStage, token: string, now: string, expiresAt: string,
): 'claimed' | 'busy' | 'ready' {
  requireLearnerId();
  if (stage !== 'bootstrap' && stage !== 'teaching') {
    throw new WordIntroductionError('invalid_source', 'Unknown introduction stage');
  }
  if (typeof token !== 'string' || !token.trim()) {
    throw new WordIntroductionError('invalid_source', 'Preparation token is required');
  }
  canonicalTime(now, 'Claim time');
  canonicalTime(expiresAt, 'Lease expiry');
  if (expiresAt <= now) throw new WordIntroductionError('invalid_source', 'Lease must expire after claim time');
  return transaction(() => {
    if (!lexicalRow(wordId)) throw new WordIntroductionError('not_found', 'Word not found');
    getDb().prepare(`INSERT OR IGNORE INTO word_introduction_preparation (word_id) VALUES (?)`).run(wordId);
    const row = preparationRow(wordId)!;
    if (stage === 'bootstrap' && row.content_id !== null) return 'ready';
    if (stage === 'teaching' && row.package_id !== null) return 'ready';
    if (stage === 'teaching' && row.content_id === null) {
      throw new WordIntroductionError('conflict', 'Word bootstrap must finish before teaching');
    }
    if (row.active_stage !== null && row.lease_expires_at !== null && row.lease_expires_at > now) {
      return 'busy';
    }
    getDb().prepare(`
      UPDATE word_introduction_preparation
      SET active_stage = ?, lease_token = ?, lease_expires_at = ? WHERE word_id = ?
    `).run(stage, token, expiresAt, wordId);
    return 'claimed';
  });
}

function requireLiveClaim(wordId: string, stage: WordIntroductionStage, token: string): PreparationRow {
  const row = preparationRow(wordId);
  if (!row || row.active_stage !== stage || row.lease_token !== token
    || row.lease_expires_at === null || row.lease_expires_at <= new Date().toISOString()) {
    throw new WordIntroductionError('conflict', 'Introduction preparation lease is not active');
  }
  return row;
}

export function finishWordIntroductionBootstrap(
  wordId: string, token: string, input: WordContentDocument, model: string,
): SavedWordContent {
  requireLearnerId();
  const content = parseWordContent(input);
  const sourceModel = modelName(model);
  if (content.word.wordId !== wordId) {
    throw new WordIntroductionError('invalid_source', 'Generated content belongs to another word');
  }
  assertWordIdentity(content);
  return transaction(() => {
    const row = requireLiveClaim(wordId, 'bootstrap', token);
    if (row.content_id !== null) throw new WordIntroductionError('conflict', 'Word bootstrap already prepared');
    const saved = insertContent(content, sourceModel);
    getDb().prepare(`
      UPDATE word_introduction_preparation
      SET content_id = ?, active_stage = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE word_id = ?
    `).run(content.id, wordId);
    return saved;
  });
}

export function finishWordIntroductionTeaching(
  wordId: string, token: string, input: TeachingPackage, model: string,
): SavedTeachingPackage {
  requireLearnerId();
  const teaching = parseTeachingPackage(input);
  const sourceModel = modelName(model);
  return transaction(() => {
    const row = requireLiveClaim(wordId, 'teaching', token);
    if (row.package_id !== null) throw new WordIntroductionError('conflict', 'Word teaching already prepared');
    if (row.content_id === null || teaching.wordContentId !== row.content_id) {
      throw new WordIntroductionError('invalid_source', 'Teaching does not use the prepared word content');
    }
    const saved = insertTeaching(teaching, sourceModel);
    getDb().prepare(`
      UPDATE word_introduction_preparation
      SET package_id = ?, active_stage = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE word_id = ?
    `).run(teaching.id, wordId);
    return saved;
  });
}

export function releaseWordIntroductionStage(wordId: string, token: string): void {
  requireLearnerId();
  if (typeof token !== 'string' || !token.trim()) return;
  transaction(() => {
    getDb().prepare(`
      UPDATE word_introduction_preparation
      SET active_stage = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE word_id = ? AND lease_token = ?
    `).run(wordId, token);
  });
}

function eligiblePackageRows(wordId: string): PackageRow[] {
  return getDb().prepare(`
    SELECT package.package_id, package.package_json, package.created_at, package.model,
           package.word_id, package.content_id
    FROM word_teaching_packages AS package
    JOIN shared_content_publications AS package_publication
      ON package_publication.publication_id = package.publication_id
    JOIN word_content_documents AS content ON content.content_id = package.content_id
    JOIN shared_content_publications AS content_publication
      ON content_publication.publication_id = content.publication_id
    WHERE package.word_id = ?
      AND package_publication.publication_status IN ('shared_trial', 'available')
      AND content_publication.publication_status IN ('shared_trial', 'available')
    ORDER BY package.created_at, package.package_id
  `).all(wordId) as PackageRow[];
}

export function getWordIntroductionLibrary(wordId: string): WordIntroductionLibrary | null {
  const learnerId = requireLearnerId();
  if (!lexicalRow(wordId)) return null;
  const packageRows = eligiblePackageRows(wordId);
  const contentRows = getDb().prepare(`
    SELECT content.content_id, content.content_json, content.created_at, content.model, content.word_id
    FROM word_content_documents AS content
    JOIN shared_content_publications AS publication ON publication.publication_id = content.publication_id
    WHERE content.word_id = ? AND publication.publication_status IN ('shared_trial', 'available')
    ORDER BY content.created_at, content.content_id
  `).all(wordId) as ContentRow[];
  const latestOpen = getDb().prepare(`
    SELECT package_id FROM learner_word_introduction_events
    WHERE learner_id = ? AND word_id = ? AND event_kind = 'opened'
    ORDER BY sequence DESC LIMIT 1
  `).get(learnerId, wordId) as { package_id: string } | undefined;
  // A withdrawn private pin must not silently turn into a different lesson.
  // A learner who has never opened one may take the first eligible package.
  const selectedPackageId = latestOpen
    ? packageRows.find((row) => row.package_id === latestOpen.package_id)?.package_id ?? null
    : packageRows[0]?.package_id ?? null;
  const completed = selectedPackageId === null ? false : Boolean(getDb().prepare(`
    SELECT 1 FROM learner_word_introduction_events
    WHERE learner_id = ? AND word_id = ? AND package_id = ? AND event_kind = 'completed'
    LIMIT 1
  `).get(learnerId, wordId, selectedPackageId));
  return {
    wordId, contents: contentRows.map(contentFromRow), packages: packageRows.map(packageFromRow),
    selectedPackageId, completed,
  };
}

function requireEligiblePackage(wordId: string, packageId: string): void {
  if (!eligiblePackageRows(wordId).some((row) => row.package_id === packageId)) {
    throw new WordIntroductionError('not_found', 'Eligible teaching package not found for word');
  }
}

export function pinWordTeachingPackage(wordId: string, packageId: string): void {
  const learnerId = requireLearnerId();
  transaction(() => {
    requireEligiblePackage(wordId, packageId);
    const latest = getDb().prepare(`
      SELECT package_id FROM learner_word_introduction_events
      WHERE learner_id = ? AND word_id = ? AND event_kind = 'opened'
      ORDER BY sequence DESC LIMIT 1
    `).get(learnerId, wordId) as { package_id: string } | undefined;
    if (latest?.package_id === packageId) return;
    getDb().prepare(`
      INSERT INTO learner_word_introduction_events
        (event_id, learner_id, word_id, package_id, event_kind, occurred_at)
      VALUES (?, ?, ?, ?, 'opened', ?)
    `).run(randomUUID(), learnerId, wordId, packageId, new Date().toISOString());
  });
}

export function completeWordTeachingPackage(wordId: string, packageId: string): void {
  const learnerId = requireLearnerId();
  transaction(() => {
    requireEligiblePackage(wordId, packageId);
    const latest = getDb().prepare(`
      SELECT package_id FROM learner_word_introduction_events
      WHERE learner_id = ? AND word_id = ? AND event_kind = 'opened'
      ORDER BY sequence DESC LIMIT 1
    `).get(learnerId, wordId) as { package_id: string } | undefined;
    if (latest?.package_id !== packageId) {
      throw new WordIntroductionError('conflict', 'Teaching package must be opened before completion');
    }
    const prior = getDb().prepare(`
      SELECT 1 FROM learner_word_introduction_events
      WHERE learner_id = ? AND word_id = ? AND package_id = ? AND event_kind = 'completed'
      LIMIT 1
    `).get(learnerId, wordId, packageId);
    if (prior) return;
    getDb().prepare(`
      INSERT INTO learner_word_introduction_events
        (event_id, learner_id, word_id, package_id, event_kind, occurred_at)
      VALUES (?, ?, ?, ?, 'completed', ?)
    `).run(randomUUID(), learnerId, wordId, packageId, new Date().toISOString());
  });
}
