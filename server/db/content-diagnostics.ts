import type {
  ContentDiagnosticKind,
  ContentDiagnosticsResponse,
  ContrastClusterDiagnosticItem,
  ProductionCueDiagnosticItem,
  WordDiagnosticItem,
} from '../../src/domain/content-diagnostics.ts';
import type { ProductionCueType } from '../../src/domain/study-actions.ts';
import type { Word, WordRow, WordStatus } from './types.ts';
import { getDb } from './connection.ts';

const DEFAULT_DIAGNOSTIC_LIMIT = 50;
const MAX_DIAGNOSTIC_LIMIT = 50;

type ClusterRow = { id: string; title: string; note: string };

type ClusterMemberDiagnosticRow = WordRow & {
  cluster_id: string;
  nuance_note: string;
  display_order: number | null;
};

type ClusterPromptDiagnosticRow = {
  id: string;
  cluster_id: string;
  target_word_id: string;
  prompt_text: string;
  explanation: string;
};

type WordConnectionRow = {
  word_id: string;
  cluster_id: string;
  title: string;
  nuance_note: string;
};

type WordTaskSummaryRow = {
  word_id: string;
  task_id: string;
  cue_count: number;
  active_cue_count: number;
};

type CueDiagnosticRow = {
  cue_id: string;
  task_id: string;
  word_id: string;
  cue_type: string;
  cue_text: string;
  created_at: string;
  origin_kind: string;
  origin_invocation_id: string | null;
  active: number;
};

type CueAcceptedWordRow = WordRow & {
  cue_id: string;
  position: number;
};

type CueEvidenceRow = {
  cue_id: string;
  attempt_count: number;
  accepted_anchor_count: number;
  accepted_non_anchor_count: number;
  rejected_count: number;
  active_judgment_count: number;
  updated_at: string;
};

export function getContentDiagnostics({
  kind,
  query,
  limit = DEFAULT_DIAGNOSTIC_LIMIT,
}: {
  kind: ContentDiagnosticKind;
  query: string;
  limit?: number;
}): ContentDiagnosticsResponse {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    throw new Error('Expected non-empty diagnostic query');
  }
  const boundedLimit = Math.min(MAX_DIAGNOSTIC_LIMIT, Math.max(1, Math.trunc(limit)));
  const selectionLimit = boundedLimit + 1;
  const items = kind === 'word'
    ? searchWordDiagnostics(normalizedQuery, selectionLimit)
    : kind === 'contrast_cluster'
      ? searchClusterDiagnostics(normalizedQuery, selectionLimit)
      : searchCueDiagnostics(normalizedQuery, selectionLimit);

  return {
    kind,
    query: normalizedQuery,
    limit: boundedLimit,
    hasMore: items.length > boundedLimit,
    items: items.slice(0, boundedLimit),
  };
}

function searchWordDiagnostics(query: string, limit: number): WordDiagnosticItem[] {
  const likeQuery = `%${escapeLikePattern(query)}%`;
  const rows = getDb().prepare(`
    SELECT ${wordSelectColumns()}
    FROM words
    WHERE id LIKE ? ESCAPE '\\'
       OR hanzi LIKE ? ESCAPE '\\'
       OR traditional LIKE ? ESCAPE '\\'
       OR pinyin LIKE ? ESCAPE '\\'
       OR meaning LIKE ? ESCAPE '\\'
       OR meanings_json LIKE ? ESCAPE '\\'
       OR personal_notes LIKE ? ESCAPE '\\'
    ORDER BY
      CASE WHEN id = ? OR hanzi = ? OR traditional = ? THEN 0 ELSE 1 END,
      priority DESC,
      created_at ASC
    LIMIT ?
  `).all(
    likeQuery,
    likeQuery,
    likeQuery,
    likeQuery,
    likeQuery,
    likeQuery,
    likeQuery,
    query,
    query,
    query,
    limit,
  ) as WordRow[];
  const wordIds = rows.map((row) => row.id);
  const connectionsByWordId = groupBy(
    selectForIds<WordConnectionRow>(wordIds, 'word_id', `
      SELECT
        contrast_cluster_members.word_id,
        contrast_clusters.id AS cluster_id,
        contrast_clusters.title,
        contrast_cluster_members.nuance_note
      FROM contrast_cluster_members
      JOIN contrast_clusters ON contrast_clusters.id = contrast_cluster_members.cluster_id
      WHERE contrast_cluster_members.word_id IN (__IDS__)
      ORDER BY contrast_clusters.title ASC, contrast_clusters.id ASC
    `),
    (row) => row.word_id,
  );
  const taskByWordId = new Map(selectForIds<WordTaskSummaryRow>(wordIds, 'word_id', `
    SELECT
      production_tasks.word_id,
      production_tasks.task_id,
      COUNT(production_cues.cue_id) AS cue_count,
      COALESCE(SUM(CASE WHEN production_cue_activation_state.active = 1 THEN 1 ELSE 0 END), 0) AS active_cue_count
    FROM production_tasks
    LEFT JOIN production_cues ON production_cues.task_id = production_tasks.task_id
    LEFT JOIN production_cue_activation_state
      ON production_cue_activation_state.cue_id = production_cues.cue_id
    WHERE production_tasks.word_id IN (__IDS__)
    GROUP BY production_tasks.word_id, production_tasks.task_id
  `).map((row) => [row.word_id, row]));

  return rows.map((row) => {
    const task = taskByWordId.get(row.id) ?? null;
    return {
      kind: 'word',
      id: row.id,
      word: mapWordRow(row),
      contrastClusters: (connectionsByWordId.get(row.id) ?? []).map((connection) => ({
        clusterId: connection.cluster_id,
        title: connection.title,
        nuanceNote: connection.nuance_note,
      })),
      productionTask: task ? {
        taskId: task.task_id,
        cueCount: task.cue_count,
        activeCueCount: task.active_cue_count,
      } : null,
    };
  });
}

function searchClusterDiagnostics(query: string, limit: number): ContrastClusterDiagnosticItem[] {
  const likeQuery = `%${escapeLikePattern(query)}%`;
  const clusters = getDb().prepare(`
    SELECT id, title, note
    FROM contrast_clusters
    WHERE id LIKE ? ESCAPE '\\'
       OR title LIKE ? ESCAPE '\\'
       OR note LIKE ? ESCAPE '\\'
       OR EXISTS (
         SELECT 1
         FROM contrast_cluster_members
         JOIN words ON words.id = contrast_cluster_members.word_id
         WHERE contrast_cluster_members.cluster_id = contrast_clusters.id
           AND (
             words.id LIKE ? ESCAPE '\\'
             OR words.hanzi LIKE ? ESCAPE '\\'
             OR words.traditional LIKE ? ESCAPE '\\'
             OR words.pinyin LIKE ? ESCAPE '\\'
             OR words.meaning LIKE ? ESCAPE '\\'
             OR words.meanings_json LIKE ? ESCAPE '\\'
           )
       )
       OR EXISTS (
         SELECT 1
         FROM contrast_prompts
         WHERE contrast_prompts.cluster_id = contrast_clusters.id
           AND (
             contrast_prompts.id LIKE ? ESCAPE '\\'
             OR contrast_prompts.prompt_text LIKE ? ESCAPE '\\'
             OR contrast_prompts.explanation LIKE ? ESCAPE '\\'
           )
       )
    ORDER BY CASE WHEN id = ? OR title = ? THEN 0 ELSE 1 END, title ASC, id ASC
    LIMIT ?
  `).all(
    ...Array(12).fill(likeQuery),
    query,
    query,
    limit,
  ) as ClusterRow[];
  const clusterIds = clusters.map((cluster) => cluster.id);
  const membersByClusterId = groupBy(
    selectForIds<ClusterMemberDiagnosticRow>(clusterIds, 'cluster_id', `
      SELECT
        contrast_cluster_members.cluster_id,
        contrast_cluster_members.nuance_note,
        contrast_cluster_members.display_order,
        ${wordSelectColumns('words')}
      FROM contrast_cluster_members
      JOIN words ON words.id = contrast_cluster_members.word_id
      WHERE contrast_cluster_members.cluster_id IN (__IDS__)
      ORDER BY
        contrast_cluster_members.cluster_id ASC,
        contrast_cluster_members.display_order IS NULL ASC,
        contrast_cluster_members.display_order ASC,
        words.id ASC
    `),
    (row) => row.cluster_id,
  );
  const promptsByClusterId = groupBy(
    selectForIds<ClusterPromptDiagnosticRow>(clusterIds, 'cluster_id', `
      SELECT
        contrast_prompts.id,
        contrast_prompts.cluster_id,
        contrast_prompts.target_word_id,
        contrast_prompts.prompt_text,
        contrast_prompts.explanation
      FROM contrast_prompts
      WHERE contrast_prompts.cluster_id IN (__IDS__)
      ORDER BY contrast_prompts.cluster_id ASC, contrast_prompts.id ASC
    `),
    (row) => row.cluster_id,
  );

  return clusters.map((cluster) => ({
    kind: 'contrast_cluster',
    id: cluster.id,
    title: cluster.title,
    note: cluster.note,
    members: (membersByClusterId.get(cluster.id) ?? []).map((member) => ({
      word: mapWordRow(member),
      nuanceNote: member.nuance_note,
      displayOrder: member.display_order,
    })),
    prompts: (promptsByClusterId.get(cluster.id) ?? []).map((prompt) => ({
      id: prompt.id,
      targetWordId: prompt.target_word_id,
      promptText: prompt.prompt_text,
      explanation: prompt.explanation,
    })),
  }));
}

function searchCueDiagnostics(query: string, limit: number): ProductionCueDiagnosticItem[] {
  const likeQuery = `%${escapeLikePattern(query)}%`;
  const cues = getDb().prepare(`
    SELECT
      production_cues.cue_id,
      production_cues.task_id,
      production_tasks.word_id,
      production_cues.cue_type,
      production_cues.cue_text,
      production_cues.created_at,
      production_cues.origin_kind,
      production_cues.origin_invocation_id,
      production_cue_activation_state.active
    FROM production_cues
    JOIN production_tasks ON production_tasks.task_id = production_cues.task_id
    JOIN words ON words.id = production_tasks.word_id
    JOIN production_cue_activation_state
      ON production_cue_activation_state.cue_id = production_cues.cue_id
    WHERE production_cues.cue_id LIKE ? ESCAPE '\\'
       OR production_cues.task_id LIKE ? ESCAPE '\\'
       OR production_cues.cue_type LIKE ? ESCAPE '\\'
       OR production_cues.cue_text LIKE ? ESCAPE '\\'
       OR words.id LIKE ? ESCAPE '\\'
       OR words.hanzi LIKE ? ESCAPE '\\'
       OR words.traditional LIKE ? ESCAPE '\\'
       OR words.pinyin LIKE ? ESCAPE '\\'
       OR words.meaning LIKE ? ESCAPE '\\'
       OR EXISTS (
         SELECT 1
         FROM production_cue_accepted_words
         JOIN words AS accepted_words ON accepted_words.id = production_cue_accepted_words.word_id
         WHERE production_cue_accepted_words.cue_id = production_cues.cue_id
           AND (
             accepted_words.id LIKE ? ESCAPE '\\'
             OR accepted_words.hanzi LIKE ? ESCAPE '\\'
             OR accepted_words.traditional LIKE ? ESCAPE '\\'
             OR accepted_words.pinyin LIKE ? ESCAPE '\\'
             OR accepted_words.meaning LIKE ? ESCAPE '\\'
           )
       )
    ORDER BY
      CASE WHEN production_cues.cue_id = ? OR production_cues.task_id = ? THEN 0 ELSE 1 END,
      production_cues.created_at DESC,
      production_cues.cue_id ASC
    LIMIT ?
  `).all(
    ...Array(14).fill(likeQuery),
    query,
    query,
    limit,
  ) as CueDiagnosticRow[];
  const cueIds = cues.map((cue) => cue.cue_id);
  const acceptedWordsByCueId = groupBy(
    selectForIds<CueAcceptedWordRow>(cueIds, 'cue_id', `
      SELECT
        production_cue_accepted_words.cue_id,
        production_cue_accepted_words.position,
        ${wordSelectColumns('words')}
      FROM production_cue_accepted_words
      JOIN words ON words.id = production_cue_accepted_words.word_id
      WHERE production_cue_accepted_words.cue_id IN (__IDS__)
      ORDER BY production_cue_accepted_words.cue_id ASC, production_cue_accepted_words.position ASC
    `),
    (row) => row.cue_id,
  );
  const anchorWordsById = new Map(
    selectWordsByIds(cues.map((cue) => cue.word_id)).map((word) => [word.id, word]),
  );
  const evidenceByCueId = new Map(
    selectForIds<CueEvidenceRow>(cueIds, 'cue_id', `
      SELECT
        cue_id,
        attempt_count,
        accepted_anchor_count,
        accepted_non_anchor_count,
        rejected_count,
        active_judgment_count,
        updated_at
      FROM production_cue_evidence_projection
      WHERE cue_id IN (__IDS__)
    `).map((row) => [row.cue_id, row]),
  );

  return cues.map((cue) => {
    const anchorWord = anchorWordsById.get(cue.word_id);
    if (!anchorWord) throw new Error(`Production task ${cue.task_id} references missing word ${cue.word_id}.`);
    const evidence = evidenceByCueId.get(cue.cue_id) ?? null;
    if (!isProductionCueType(cue.cue_type)) {
      throw new Error(`Production cue ${cue.cue_id} has unknown type ${cue.cue_type}.`);
    }
    if (cue.origin_kind !== 'reflection' && cue.origin_kind !== 'manual') {
      throw new Error(`Production cue ${cue.cue_id} has unknown origin ${cue.origin_kind}.`);
    }
    return {
      kind: 'production_cue',
      id: cue.cue_id,
      taskId: cue.task_id,
      anchorWord,
      cueType: cue.cue_type,
      text: cue.cue_text,
      acceptedWords: (acceptedWordsByCueId.get(cue.cue_id) ?? []).map(mapWordRow),
      createdAt: cue.created_at,
      active: cue.active !== 0,
      attribution: {
        origin: cue.origin_kind,
        invocationId: cue.origin_invocation_id,
      },
      evidence: evidence ? {
        attemptCount: evidence.attempt_count,
        acceptedAnchorCount: evidence.accepted_anchor_count,
        acceptedNonAnchorCount: evidence.accepted_non_anchor_count,
        rejectedCount: evidence.rejected_count,
        activeJudgmentCount: evidence.active_judgment_count,
        updatedAt: evidence.updated_at,
      } : null,
    };
  });
}

function selectWordsByIds(ids: string[]): Word[] {
  return selectForIds<WordRow>(ids, 'id', `
    SELECT ${wordSelectColumns()}
    FROM words
    WHERE id IN (__IDS__)
  `).map(mapWordRow);
}

function selectForIds<Row>(ids: string[], _idColumn: string, sql: string, leadingParams: unknown[] = []): Row[] {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  const placeholders = uniqueIds.map(() => '?').join(', ');
  return getDb().prepare(sql.replace('__IDS__', placeholders)).all(...leadingParams, ...uniqueIds) as Row[];
}

function groupBy<Row>(rows: Row[], keyFor: (row: Row) => string): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFor(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function wordSelectColumns(table = 'words'): string {
  return `
    ${table}.id,
    ${table}.hanzi,
    ${table}.traditional,
    ${table}.pinyin,
    ${table}.meaning,
    ${table}.meanings_json,
    ${table}.personal_notes,
    ${table}.examples_json,
    ${table}.status,
    ${table}.priority,
    ${table}.created_at,
    ${table}.learning_streak,
    ${table}.last_learning_success_on,
    ${table}.last_learning_covered_on
  `;
}

function mapWordRow(row: WordRow): Word {
  return {
    id: row.id,
    hanzi: row.hanzi,
    traditional: row.traditional,
    pinyin: row.pinyin,
    meaning: row.meaning,
    meanings: parseMeanings(row.meanings_json, row.meaning),
    personalNotes: row.personal_notes,
    examples: JSON.parse(row.examples_json) as string[],
    status: row.status as WordStatus,
    priority: row.priority,
    createdAt: row.created_at,
    learningStreak: row.learning_streak,
    lastLearningSuccessOn: row.last_learning_success_on,
    lastLearningCoveredOn: row.last_learning_covered_on,
  };
}

function parseMeanings(value: string, fallback: string): string[] {
  const meanings = JSON.parse(value) as unknown;
  return Array.isArray(meanings) && meanings.every((meaning) => typeof meaning === 'string') && meanings.length > 0
    ? meanings
    : fallback.trim().length > 0 ? [fallback] : [];
}

function escapeLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function isProductionCueType(value: string): value is ProductionCueType {
  return value === 'definition_gloss' || value === 'minimal_context' || value === 'circumstance';
}
