import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX,
  type ReflectionExistingContentV0,
  type ReflectionWordSnapshotV1,
  type SessionReflectionBundleV4,
  type StudyProfileV0,
} from '../../src/domain/reflection.ts';
import {
  parseSessionReflectionBundleV4,
  parseStoredSessionReflectionBundle,
} from '../../src/domain/reflection-evidence.ts';
import { INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS } from '../../server/reflection/evidence.ts';
import { INITIAL_REFLECTION_FLOW_VERSION } from '../../server/db/reflections.ts';

export const LEGACY_PROMPT_REMEDIATION_ITEM_PREFIX = 'legacy-prompt-remediation:item:';
const LEGACY_PROMPT_REMEDIATION_SESSION_PREFIX = 'legacy-prompt-remediation:batch:';

export type LegacyDefinitionFallbackSelection = {
  wordId: string;
  hanzi: string;
  createdAt: string;
  note: string;
  fallbackText: string;
};

export type SkippedLegacyContrastExclusion = {
  promptId: string;
  targetWordId: string;
  createdAt: string;
  note: string;
};

export type LegacyPromptRemediationBatch = {
  batchNumber: number;
  syntheticSessionId: string;
  wordIds: string[];
  bundle: SessionReflectionBundleV4;
};

export type LegacyPromptRemediationPlan = {
  activeDefinitionExclusionCount: number;
  alreadyMaterializedWordIds: string[];
  selectedDefinitionExclusions: LegacyDefinitionFallbackSelection[];
  skippedContrastExclusions: SkippedLegacyContrastExclusion[];
  batches: LegacyPromptRemediationBatch[];
};

export type LegacyPromptRemediationGeneratedBatch = {
  batchNumber: number;
  runId: string;
  artifactId: string | null;
  state: 'succeeded' | 'failed';
  error: string | null;
};

export type LegacyPromptRemediationReport = {
  mode: 'dry_run' | 'apply';
  activeDefinitionExclusionCount: number;
  alreadyMaterializedWordIds: string[];
  selectedDefinitionExclusions: LegacyDefinitionFallbackSelection[];
  skippedContrastExclusions: SkippedLegacyContrastExclusion[];
  plannedBatches: Array<{
    batchNumber: number;
    syntheticSessionId: string;
    wordIds: string[];
  }>;
  generatedBatches: LegacyPromptRemediationGeneratedBatch[];
};

type DefinitionExclusionRow = {
  word_id: string;
  created_at: string;
  note: string;
};

type ContrastExclusionRow = {
  prompt_id: string;
  target_word_id: string;
  created_at: string;
  note: string;
};

type WordRow = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  meanings_json: string;
};

type ClusterRow = {
  cluster_id: string;
  title: string;
  cluster_note: string;
  member_word_id: string;
  nuance_note: string;
  prompt_count: number;
};

export function createLegacyPromptRemediationPlan(input: {
  db: DatabaseSync;
  learnerId: string;
  studyProfile: StudyProfileV0;
  generatedAt?: string;
}): LegacyPromptRemediationPlan {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const definitionRows = input.db.prepare(`
    SELECT word_id, created_at, note
    FROM definition_fallback_exclusions
    WHERE learner_id = ? AND origin = 'legacy_bad_prompt_migration'
    ORDER BY created_at ASC, word_id ASC
  `).all(input.learnerId) as DefinitionExclusionRow[];
  const contrastRows = input.db.prepare(`
    SELECT prompt_id, target_word_id, created_at, note
    FROM contrast_prompt_exclusions
    WHERE learner_id = ? AND origin = 'legacy_bad_prompt_migration'
    ORDER BY created_at ASC, prompt_id ASC
  `).all(input.learnerId) as ContrastExclusionRow[];
  const alreadyMaterializedWordIds = readAlreadyMaterializedWordIds(input.db);
  const alreadyMaterialized = new Set(alreadyMaterializedWordIds);
  const selected = definitionRows
    .filter((row) => !alreadyMaterialized.has(row.word_id))
    .map((row) => buildDefinitionSelection(input.db, row));
  const batches = chunk(selected, INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS).map((items, index) => {
    const syntheticSessionId = syntheticBatchSessionId(items.map((item) => item.wordId));
    return {
      batchNumber: index + 1,
      syntheticSessionId,
      wordIds: items.map((item) => item.wordId),
      bundle: buildLegacyPromptRemediationBundle({
        db: input.db,
        studyProfile: input.studyProfile,
        generatedAt,
        syntheticSessionId,
        exclusions: definitionRows.filter((row) => items.some((item) => item.wordId === row.word_id)),
      }),
    };
  });

  return {
    activeDefinitionExclusionCount: definitionRows.length,
    alreadyMaterializedWordIds,
    selectedDefinitionExclusions: selected,
    skippedContrastExclusions: contrastRows.map((row) => ({
      promptId: row.prompt_id,
      targetWordId: row.target_word_id,
      createdAt: row.created_at,
      note: row.note,
    })),
    batches,
  };
}

export async function executeLegacyPromptRemediation(input: {
  plan: LegacyPromptRemediationPlan;
  apply: boolean;
  generateBatch?: (
    batch: LegacyPromptRemediationBatch,
  ) => Promise<{ runId: string; artifactId: string }>;
}): Promise<LegacyPromptRemediationReport> {
  if (input.apply && input.generateBatch === undefined) {
    throw new Error('Apply mode requires a reflection batch generator.');
  }
  const generatedBatches: LegacyPromptRemediationGeneratedBatch[] = [];
  if (input.apply) {
    for (const batch of input.plan.batches) {
      try {
        const generated = await input.generateBatch!(batch);
        generatedBatches.push({
          batchNumber: batch.batchNumber,
          runId: generated.runId,
          artifactId: generated.artifactId,
          state: 'succeeded',
          error: null,
        });
      } catch (error) {
        const runId = error instanceof LegacyPromptRemediationGenerationError
          ? error.runId
          : 'unavailable';
        generatedBatches.push({
          batchNumber: batch.batchNumber,
          runId,
          artifactId: null,
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return {
    mode: input.apply ? 'apply' : 'dry_run',
    activeDefinitionExclusionCount: input.plan.activeDefinitionExclusionCount,
    alreadyMaterializedWordIds: input.plan.alreadyMaterializedWordIds,
    selectedDefinitionExclusions: input.plan.selectedDefinitionExclusions,
    skippedContrastExclusions: input.plan.skippedContrastExclusions,
    plannedBatches: input.plan.batches.map((batch) => ({
      batchNumber: batch.batchNumber,
      syntheticSessionId: batch.syntheticSessionId,
      wordIds: batch.wordIds,
    })),
    generatedBatches,
  };
}

export class LegacyPromptRemediationGenerationError extends Error {
  constructor(readonly runId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'LegacyPromptRemediationGenerationError';
  }
}

export function buildLegacyPromptRemediationBundle(input: {
  db: DatabaseSync;
  studyProfile: StudyProfileV0;
  generatedAt: string;
  syntheticSessionId: string;
  exclusions: DefinitionExclusionRow[];
}): SessionReflectionBundleV4 {
  const items = input.exclusions.map((exclusion) => {
    const targetWord = getWordSnapshot(input.db, exclusion.word_id);
    const fallbackText = getMeaningDerivedFallback(input.db, exclusion.word_id);
    const supplement = getFallbackSupplement(input.db, exclusion.word_id);
    return {
      itemId: `${LEGACY_PROMPT_REMEDIATION_ITEM_PREFIX}${exclusion.word_id}`,
      source: 'production_mistake' as const,
      sourceActionKind: 'production' as const,
      sourceAttemptId: `${SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX}legacy-prompt-remediation:${exclusion.word_id}`,
      sessionActionId: `synthetic-reflection-action:legacy-prompt-remediation:${exclusion.word_id}`,
      occurredAt: exclusion.created_at,
      targetWord,
      sessionNote: exclusion.note,
      existingContent: getExistingContent(input.db, [exclusion.word_id]),
      servedCue: {
        cueId: null,
        cueType: 'definition_gloss' as const,
        text: fallbackText,
        acceptedWordIds: [exclusion.word_id],
        supplement,
      },
      rawResponse: null,
      submittedWord: null,
      responseKind: 'no_clue' as const,
      learnerRequestedReview: true as const,
    };
  });
  return parseSessionReflectionBundleV4({
    schemaVersion: 'session_reflection_bundle.v4',
    generatedAt: input.generatedAt,
    session: {
      sessionId: input.syntheticSessionId,
      startedAt: input.generatedAt,
      endedAt: input.generatedAt,
      studyProfile: input.studyProfile,
    },
    items,
  });
}

function readAlreadyMaterializedWordIds(db: DatabaseSync): string[] {
  const rows = db.prepare(`
    SELECT evidence_bundle_json
    FROM reflection_artifacts
    WHERE source_session_id IS NULL AND reflection_flow_version = ?
    ORDER BY generated_at ASC, artifact_id ASC
  `).all(INITIAL_REFLECTION_FLOW_VERSION) as Array<{ evidence_bundle_json: string }>;
  const wordIds = new Set<string>();
  for (const row of rows) {
    const bundle = parseStoredSessionReflectionBundle(JSON.parse(row.evidence_bundle_json) as unknown);
    if (bundle.schemaVersion !== 'session_reflection_bundle.v4') continue;
    for (const item of bundle.items) {
      if (
        item.itemId.startsWith(LEGACY_PROMPT_REMEDIATION_ITEM_PREFIX)
        && item.sourceAttemptId.startsWith(SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX)
      ) {
        wordIds.add(item.targetWord.wordId);
      }
    }
  }
  return [...wordIds].sort();
}

function buildDefinitionSelection(
  db: DatabaseSync,
  row: DefinitionExclusionRow,
): LegacyDefinitionFallbackSelection {
  const word = getWordSnapshot(db, row.word_id);
  return {
    wordId: row.word_id,
    hanzi: word.hanzi,
    createdAt: row.created_at,
    note: row.note,
    fallbackText: getMeaningDerivedFallback(db, row.word_id),
  };
}

function getWordSnapshot(db: DatabaseSync, wordId: string): ReflectionWordSnapshotV1 {
  const row = db.prepare(`
    SELECT id, hanzi, pinyin, meaning, meanings_json
    FROM words
    WHERE id = ?
  `).get(wordId) as WordRow | undefined;
  if (!row) throw new Error(`Definition fallback exclusion references missing word ${wordId}.`);
  const meaningRows = db.prepare(`
    SELECT text FROM word_meanings WHERE word_id = ? ORDER BY position ASC, id ASC
  `).all(wordId) as Array<{ text: string }>;
  return {
    wordId: row.id,
    hanzi: row.hanzi,
    pinyin: row.pinyin,
    meanings: meaningRows.length > 0
      ? meaningRows.map((meaning) => meaning.text)
      : parseMeanings(row.meanings_json, row.meaning),
  };
}

function getMeaningDerivedFallback(
  db: DatabaseSync,
  wordId: string,
): string {
  const meaningRows = db.prepare(`
    SELECT text, show_on_production_prompt
    FROM word_meanings
    WHERE word_id = ?
    ORDER BY position ASC, id ASC
  `).all(wordId) as Array<{ text: string; show_on_production_prompt: number }>;
  const promptMeanings = meaningRows
    .filter((row) => row.show_on_production_prompt !== 0)
    .map((row) => row.text);
  if (meaningRows.length > 0 && promptMeanings.length === 0) {
    throw new Error(`Word ${wordId} has no currently visible meaning-derived production fallback.`);
  }
  const legacyWord = db.prepare(`
    SELECT meaning
    FROM words
    WHERE id = ?
  `).get(wordId) as { meaning: string } | undefined;
  const fallback = promptMeanings.join('; ') || legacyWord?.meaning || '';
  if (fallback.trim().length === 0) {
    throw new Error(`Word ${wordId} has no meaning-derived production fallback.`);
  }
  return fallback;
}

function getFallbackSupplement(
  db: DatabaseSync,
  wordId: string,
): SessionReflectionBundleV4['items'][number]['servedCue']['supplement'] {
  const row = db.prepare(`
    SELECT supplement_id, english_frame, example_sentence, example_translation
    FROM production_cue_supplements
    WHERE task_id = ? AND cue_id IS NULL
  `).get(`production-task:${wordId}:default_production`) as {
    supplement_id: string;
    english_frame: string;
    example_sentence: string;
    example_translation: string;
  } | undefined;
  return row === undefined ? null : {
    supplementId: row.supplement_id,
    englishFrame: row.english_frame,
    exampleSentence: row.example_sentence,
    exampleTranslation: row.example_translation,
  };
}

function getExistingContent(db: DatabaseSync, wordIds: string[]): ReflectionExistingContentV0 {
  const placeholders = wordIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      clusters.id AS cluster_id,
      clusters.title,
      clusters.note AS cluster_note,
      members.word_id AS member_word_id,
      members.nuance_note,
      (SELECT COUNT(*) FROM contrast_prompts WHERE cluster_id = clusters.id) AS prompt_count
    FROM contrast_clusters AS clusters
    JOIN contrast_cluster_members AS members ON members.cluster_id = clusters.id
    WHERE clusters.id IN (
      SELECT DISTINCT cluster_id FROM contrast_cluster_members WHERE word_id IN (${placeholders})
    )
    ORDER BY clusters.id ASC, members.display_order IS NULL ASC,
      members.display_order ASC, members.word_id ASC
  `).all(...wordIds) as ClusterRow[];
  const clusters = new Map<string, ReflectionExistingContentV0['contrastClusters'][number]>();
  for (const row of rows) {
    const cluster = clusters.get(row.cluster_id) ?? {
      clusterId: row.cluster_id,
      title: row.title,
      memberWordIds: [],
      promptCount: row.prompt_count,
      notes: row.cluster_note.length > 0 ? [row.cluster_note] : [],
    };
    cluster.memberWordIds.push(row.member_word_id);
    if (row.nuance_note.length > 0) cluster.notes.push(row.nuance_note);
    clusters.set(row.cluster_id, cluster);
  }
  return { contrastClusters: [...clusters.values()], knownAcceptedAlternates: [] };
}

function parseMeanings(value: string, fallback: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) {
      return parsed.length > 0 ? parsed : [fallback];
    }
  } catch {
    // The compatibility fallback below keeps the historic word readable.
  }
  return fallback.trim().length > 0 ? [fallback] : [];
}

function syntheticBatchSessionId(wordIds: string[]): string {
  const digest = createHash('sha256').update(wordIds.join('\u0000')).digest('hex').slice(0, 16);
  return `${LEGACY_PROMPT_REMEDIATION_SESSION_PREFIX}${digest}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
