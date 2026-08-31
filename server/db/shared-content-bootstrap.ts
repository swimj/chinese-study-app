import { createHash } from 'node:crypto';
import { config, getDb } from './connection.ts';

const SHARED_MANDARIN_BOOTSTRAP_SCHEMA_VERSION = 1;
const SHARED_MANDARIN_CONTENT_KIND = 'shared_mandarin_lexicon';

type BootstrapMeaning = {
  id: string;
  text: string;
};

type BootstrapWord = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings: BootstrapMeaning[];
  examples: string[];
  priority: number;
  createdAt: string;
};

export type SharedMandarinBootstrapArtifact = {
  schemaVersion: number;
  importId: string;
  contentKind: string;
  sourceRef: string;
  checksum: string;
  words: BootstrapWord[];
};

export type SharedMandarinBootstrapResult = {
  importId: string;
  checksum: string;
  status: 'imported' | 'already_imported';
  wordCount: number;
  meaningCount: number;
};

type ContentImportRow = {
  content_kind: string;
  source_ref: string;
  details_json: string;
};

type LexicalWordRow = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings_json: string;
  examples_json: string;
  priority: number;
  created_at: string;
};

type LexicalMeaningRow = {
  id: string;
  word_id: string;
  position: number;
  text: string;
  created_at: string;
  updated_at: string;
};

export function calculateSharedMandarinBootstrapChecksum(
  artifact: Omit<SharedMandarinBootstrapArtifact, 'checksum'>,
): string {
  return createHash('sha256').update(stableJson(artifact)).digest('hex');
}

export function parseSharedMandarinBootstrapArtifact(value: unknown): SharedMandarinBootstrapArtifact {
  assertPlainObject(value, 'bootstrap artifact');
  assertExactKeys(
    value,
    ['schemaVersion', 'importId', 'contentKind', 'sourceRef', 'checksum', 'words'],
    'bootstrap artifact',
  );
  if (value.schemaVersion !== SHARED_MANDARIN_BOOTSTRAP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported shared Mandarin bootstrap schema version: ${String(value.schemaVersion)}`,
    );
  }
  const importId = requireNonEmptyString(value.importId, 'bootstrap importId');
  const contentKind = requireNonEmptyString(value.contentKind, 'bootstrap contentKind');
  if (contentKind !== SHARED_MANDARIN_CONTENT_KIND) {
    throw new Error(`Unsupported shared Mandarin bootstrap content kind: ${contentKind}`);
  }
  const sourceRef = requireNonEmptyString(value.sourceRef, 'bootstrap sourceRef');
  const checksum = requireNonEmptyString(value.checksum, 'bootstrap checksum');
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error('Shared Mandarin bootstrap checksum must be a lowercase SHA-256 digest');
  }
  if (!Array.isArray(value.words) || value.words.length === 0) {
    throw new Error('Shared Mandarin bootstrap must contain at least one word');
  }

  const wordIds = new Set<string>();
  const meaningIds = new Set<string>();
  const words = value.words.map((candidate, wordIndex) => {
    const label = `bootstrap word at index ${wordIndex}`;
    assertPlainObject(candidate, label);
    assertExactKeys(
      candidate,
      ['id', 'hanzi', 'traditional', 'pinyin', 'meaning', 'meanings', 'examples', 'priority', 'createdAt'],
      label,
    );
    const id = requireNonEmptyString(candidate.id, `${label} id`);
    if (wordIds.has(id)) throw new Error(`Duplicate bootstrap word id: ${id}`);
    wordIds.add(id);
    if (candidate.traditional !== null && typeof candidate.traditional !== 'string') {
      throw new Error(`${label} traditional must be a string or null`);
    }
    if (!Number.isInteger(candidate.priority)) throw new Error(`${label} priority must be an integer`);
    if (!Array.isArray(candidate.examples) || !candidate.examples.every((item) => typeof item === 'string')) {
      throw new Error(`${label} examples must be an array of strings`);
    }
    if (!Array.isArray(candidate.meanings) || candidate.meanings.length === 0) {
      throw new Error(`${label} must contain at least one meaning`);
    }
    const meanings = candidate.meanings.map((meaningCandidate, meaningIndex) => {
      const meaningLabel = `${label} meaning at index ${meaningIndex}`;
      assertPlainObject(meaningCandidate, meaningLabel);
      assertExactKeys(meaningCandidate, ['id', 'text'], meaningLabel);
      const meaningId = requireNonEmptyString(meaningCandidate.id, `${meaningLabel} id`);
      if (meaningIds.has(meaningId)) throw new Error(`Duplicate bootstrap meaning id: ${meaningId}`);
      meaningIds.add(meaningId);
      return {
        id: meaningId,
        text: requireNonEmptyString(meaningCandidate.text, `${meaningLabel} text`),
      };
    });
    const primaryMeaning = requireNonEmptyString(candidate.meaning, `${label} meaning`);
    if (meanings[0]?.text !== primaryMeaning) {
      throw new Error(`${label} primary meaning must match its first meaning entry`);
    }
    const createdAt = requireIsoTimestamp(candidate.createdAt, `${label} createdAt`);
    return {
      id,
      hanzi: requireNonEmptyString(candidate.hanzi, `${label} hanzi`),
      traditional: candidate.traditional,
      pinyin: requireNonEmptyString(candidate.pinyin, `${label} pinyin`),
      meaning: primaryMeaning,
      meanings,
      examples: [...candidate.examples],
      priority: candidate.priority,
      createdAt,
    };
  });

  const artifact = {
    schemaVersion: SHARED_MANDARIN_BOOTSTRAP_SCHEMA_VERSION,
    importId,
    contentKind,
    sourceRef,
    checksum,
    words,
  } satisfies SharedMandarinBootstrapArtifact;
  const calculatedChecksum = calculateSharedMandarinBootstrapChecksum(withoutChecksum(artifact));
  if (calculatedChecksum !== checksum) {
    throw new Error(
      `Shared Mandarin bootstrap checksum mismatch: expected ${checksum}, calculated ${calculatedChecksum}`,
    );
  }
  return artifact;
}

export function importSharedMandarinBootstrap(
  artifactValue: unknown,
  { importedAt = new Date().toISOString() }: { importedAt?: string } = {},
): SharedMandarinBootstrapResult {
  assertProductionBootstrapContext();
  const artifact = parseSharedMandarinBootstrapArtifact(artifactValue);
  requireIsoTimestamp(importedAt, 'bootstrap importedAt');
  const meaningCount = artifact.words.reduce((total, word) => total + word.meanings.length, 0);

  getDb().exec('BEGIN IMMEDIATE');
  try {
    const existingImport = getDb().prepare(`
      SELECT content_kind, source_ref, details_json
      FROM content_imports
      WHERE import_id = ?
    `).get(artifact.importId) as ContentImportRow | undefined;

    if (existingImport) {
      assertExistingImportMatches(existingImport, artifact, meaningCount);
      assertImportedContentMatches(artifact);
      getDb().exec('COMMIT');
      return buildResult(artifact, meaningCount, 'already_imported');
    }

    assertExistingContentCompatible(artifact);
    insertMissingContent(artifact);
    assertImportedContentMatches(artifact);
    getDb().prepare(`
      INSERT INTO content_imports (import_id, content_kind, source_ref, imported_at, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      artifact.importId,
      artifact.contentKind,
      artifact.sourceRef,
      importedAt,
      JSON.stringify({
        schemaVersion: artifact.schemaVersion,
        checksum: artifact.checksum,
        wordCount: artifact.words.length,
        meaningCount,
      }),
    );
    getDb().exec('COMMIT');
    return buildResult(artifact, meaningCount, 'imported');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

function assertProductionBootstrapContext(): void {
  if (config.mode !== 'study') throw new Error('Shared Mandarin bootstrap requires APP_MODE=study');
  if (config.authMode !== 'clerk') throw new Error('Shared Mandarin bootstrap requires APP_AUTH_MODE=clerk');
  if (config.studyProfile !== 'mandarin') {
    throw new Error('Shared Mandarin bootstrap requires APP_STUDY_PROFILE=mandarin');
  }
  if (config.seedSampleData) throw new Error('Shared Mandarin bootstrap cannot run with dev seeding enabled');
}

function assertExistingImportMatches(
  row: ContentImportRow,
  artifact: SharedMandarinBootstrapArtifact,
  meaningCount: number,
): void {
  if (row.content_kind !== artifact.contentKind || row.source_ref !== artifact.sourceRef) {
    throw new Error(`Content import ledger conflict for ${artifact.importId}`);
  }
  const details = parseJsonObject(row.details_json, `content import ${artifact.importId} details`);
  const expected = {
    schemaVersion: artifact.schemaVersion,
    checksum: artifact.checksum,
    wordCount: artifact.words.length,
    meaningCount,
  };
  if (stableJson(details) !== stableJson(expected)) {
    throw new Error(`Content import ledger checksum or counts conflict for ${artifact.importId}`);
  }
}

function assertExistingContentCompatible(artifact: SharedMandarinBootstrapArtifact): void {
  const selectWord = getDb().prepare(`
    SELECT id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
    FROM lexical_words WHERE id = ?
  `);
  const selectMeaning = getDb().prepare(`
    SELECT id, word_id, position, text, created_at, updated_at
    FROM lexical_word_meanings WHERE id = ?
  `);
  for (const word of artifact.words) {
    const existingWord = selectWord.get(word.id) as LexicalWordRow | undefined;
    if (existingWord && !lexicalWordMatches(existingWord, word)) {
      throw new Error(`Existing shared word conflicts with bootstrap content: ${word.id}`);
    }
    word.meanings.forEach((meaning, position) => {
      const existingMeaning = selectMeaning.get(meaning.id) as LexicalMeaningRow | undefined;
      if (existingMeaning && !lexicalMeaningMatches(existingMeaning, word, meaning, position)) {
        throw new Error(`Existing shared meaning conflicts with bootstrap content: ${meaning.id}`);
      }
    });
  }
}

function insertMissingContent(artifact: SharedMandarinBootstrapArtifact): void {
  const insertWord = getDb().prepare(`
    INSERT INTO lexical_words (
      id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertMeaning = getDb().prepare(`
    INSERT INTO lexical_word_meanings (id, word_id, position, text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const word of artifact.words) {
    insertWord.run(
      word.id,
      word.hanzi,
      word.traditional,
      word.pinyin,
      word.meaning,
      JSON.stringify(word.meanings.map((meaning) => meaning.text)),
      JSON.stringify(word.examples),
      word.priority,
      word.createdAt,
    );
    word.meanings.forEach((meaning, position) => {
      insertMeaning.run(meaning.id, word.id, position, meaning.text, word.createdAt, word.createdAt);
    });
  }
}

function assertImportedContentMatches(artifact: SharedMandarinBootstrapArtifact): void {
  const expectedWordIds = artifact.words.map((word) => word.id);
  const expectedMeaningIds = artifact.words.flatMap((word) => word.meanings.map((meaning) => meaning.id));
  const words = getDb().prepare(`
    SELECT id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
    FROM lexical_words
    WHERE id IN (${sqlPlaceholders(expectedWordIds.length)})
  `).all(...expectedWordIds) as unknown as LexicalWordRow[];
  const meanings = getDb().prepare(`
    SELECT id, word_id, position, text, created_at, updated_at
    FROM lexical_word_meanings
    WHERE id IN (${sqlPlaceholders(expectedMeaningIds.length)})
  `).all(...expectedMeaningIds) as unknown as LexicalMeaningRow[];
  const wordsById = new Map(words.map((row) => [row.id, row]));
  const meaningsById = new Map(meanings.map((row) => [row.id, row]));
  for (const word of artifact.words) {
    const wordRow = wordsById.get(word.id);
    if (!wordRow || !lexicalWordMatches(wordRow, word)) {
      throw new Error(`Imported shared word is absent or tampered: ${word.id}`);
    }
    word.meanings.forEach((meaning, position) => {
      const meaningRow = meaningsById.get(meaning.id);
      if (!meaningRow || !lexicalMeaningMatches(meaningRow, word, meaning, position)) {
        throw new Error(`Imported shared meaning is absent or tampered: ${meaning.id}`);
      }
    });
  }
}

function lexicalWordMatches(row: LexicalWordRow, word: BootstrapWord): boolean {
  return row.id === word.id
    && row.hanzi === word.hanzi
    && row.traditional === word.traditional
    && row.pinyin === word.pinyin
    && row.meaning === word.meaning
    && row.meanings_json === JSON.stringify(word.meanings.map((meaning) => meaning.text))
    && row.examples_json === JSON.stringify(word.examples)
    && row.priority === word.priority
    && row.created_at === word.createdAt;
}

function lexicalMeaningMatches(
  row: LexicalMeaningRow,
  word: BootstrapWord,
  meaning: BootstrapMeaning,
  position: number,
): boolean {
  return row.id === meaning.id
    && row.word_id === word.id
    && row.position === position
    && row.text === meaning.text
    && row.created_at === word.createdAt
    && row.updated_at === word.createdAt;
}

function withoutChecksum(
  artifact: SharedMandarinBootstrapArtifact,
): Omit<SharedMandarinBootstrapArtifact, 'checksum'> {
  const { checksum: _checksum, ...payload } = artifact;
  return payload;
}

function buildResult(
  artifact: SharedMandarinBootstrapArtifact,
  meaningCount: number,
  status: SharedMandarinBootstrapResult['status'],
): SharedMandarinBootstrapResult {
  return {
    importId: artifact.importId,
    checksum: artifact.checksum,
    status,
    wordCount: artifact.words.length,
    meaningCount,
  };
}

function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requireNonEmptyString(value, label);
  if (new Date(timestamp).toISOString() !== timestamp) throw new Error(`${label} must be an ISO timestamp`);
  return timestamp;
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} has incompatible fields: ${actual.join(', ')}`);
  }
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  assertPlainObject(parsed, label);
  return parsed;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
