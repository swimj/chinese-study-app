import type { DatabaseSync } from 'node:sqlite';
import { clozePromptParts } from '../../src/domain/cloze-prompt.ts';
import type { VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { InventorySnapshot } from '../vocabulary/sense-inventory-reconciliation.ts';

type Row = Record<string, string | number | null>;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
function strings(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const entry of value) strings(entry, into);
  else if (value !== null && typeof value === 'object') for (const entry of Object.values(value)) strings(entry, into);
  return into;
}
function jsonStrings(value: string | number | null | undefined): Set<string> {
  return typeof value === 'string' ? strings(JSON.parse(value)) : new Set();
}
function intersects(values: Iterable<string>, wanted: ReadonlySet<string>): boolean {
  for (const value of values) if (wanted.has(value)) return true;
  return false;
}
function rows(snapshot: InventorySnapshot, key: string): Row[] {
  const value = snapshot.dependencies[key];
  if (!Array.isArray(value) || value.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error(`Reconciliation snapshot lacks ${key}; export a fresh dependency snapshot`);
  }
  return value as Row[];
}

/** Read-only, exact snapshot. Caller owns a read transaction or the stopped-writer apply transaction. */
export function snapshotInventoryForReconciliation(database: DatabaseSync, wordId: string): InventorySnapshot {
  if (!database.isTransaction) throw new Error('Inventory dependency snapshot requires a transaction');
  const all = (sql: string, ...args: string[]): Row[] => database.prepare(sql).all(...args) as Row[];
  const lexical = database.prepare('SELECT id,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE id=?').get(wordId) as
    { id: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string } | undefined;
  if (!lexical) throw new Error(`Unknown word ${wordId}`);
  const meanings = all('SELECT text FROM lexical_word_meanings WHERE word_id=? ORDER BY position,id', wordId);
  const catalog = database.prepare('SELECT sense_catalog_version AS version,senses_established_at AS establishedAt FROM vocabulary_word_catalogs WHERE word_id=?').get(wordId) as
    { version: number; establishedAt: string | null } | undefined;
  const senseRows = all('SELECT sense_id AS senseId,version,status,description_json FROM senses WHERE word_id=? ORDER BY sense_id', wordId);
  const senses = senseRows.map(row => ({ senseId: String(row.senseId), version: Number(row.version), status: row.status as 'active' | 'retired', description: JSON.parse(String(row.description_json)) as VocabularyJson }));
  const sourceDocuments = all('SELECT * FROM word_content_documents WHERE word_id=? ORDER BY content_id', wordId);
  const packages = all('SELECT * FROM word_teaching_packages WHERE word_id=? ORDER BY package_id', wordId);
  const sourceIds = new Set(sourceDocuments.map(row => String(row.content_id)));
  const packageIds = new Set(packages.map(row => String(row.package_id)));
  const refs = new Set([wordId, ...sourceIds, ...packageIds, ...senses.map(sense => sense.senseId)]);
  const allWords = all('SELECT * FROM content_words ORDER BY content_id,word_id');
  const allAnswers = all('SELECT * FROM exercise_answer_words ORDER BY exercise_id,word_id');
  const allBindings = all('SELECT * FROM introduction_exercises ORDER BY introduction_id,position');
  const allContent = all('SELECT * FROM content_items ORDER BY content_id');
  const contentIds = new Set([
    ...allWords.filter(row => row.word_id === wordId).map(row => String(row.content_id)),
    ...allAnswers.filter(row => row.word_id === wordId).map(row => String(row.exercise_id)),
    ...allContent.filter(row => intersects(jsonStrings(row.body_json), refs)).map(row => String(row.content_id)),
  ]);
  // A shared teaching exercise can bind several introductions; retain the complete binding closure.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const binding of allBindings) if (contentIds.has(String(binding.introduction_id)) || contentIds.has(String(binding.exercise_id))) {
      for (const id of [String(binding.introduction_id), String(binding.exercise_id)]) if (!contentIds.has(id)) { contentIds.add(id); expanded = true; }
    }
  }
  const contents = allContent.filter(row => contentIds.has(String(row.content_id)));
  for (const id of contentIds) refs.add(id);
  const contentWords = allWords.filter(row => contentIds.has(String(row.content_id)));
  const answers = allAnswers.filter(row => contentIds.has(String(row.exercise_id)));
  const introductionBindings = allBindings.filter(row => contentIds.has(String(row.introduction_id)));
  const cases = all('SELECT * FROM reflection_cases ORDER BY case_id').filter(row => row.word_id === wordId
    || contentIds.has(String(row.content_id)) || intersects(jsonStrings(row.evidence_snapshot_json), refs));
  const caseIds = new Set(cases.map(row => String(row.case_id)));
  const pendingReflectionJobs = all("SELECT * FROM vocabulary_reflection_jobs WHERE status!='succeeded' ORDER BY job_id").filter(row => caseIds.has(String(row.case_id)));
  const pendingDispatches = all("SELECT * FROM vocabulary_post_session_dispatches WHERE status!='succeeded' ORDER BY dispatch_id")
    .filter(row => intersects(jsonStrings(row.evidence_json), refs));
  const allProposalBases = all('SELECT * FROM proposal_content_bases ORDER BY proposal_id,content_id');
  const basedProposals = new Set(allProposalBases.filter(row => contentIds.has(String(row.content_id))).map(row => String(row.proposal_id)));
  const pendingProposals = all("SELECT * FROM content_proposals WHERE status NOT IN ('applied','closed') ORDER BY proposal_id")
    .filter(row => caseIds.has(String(row.case_id)) || basedProposals.has(String(row.proposal_id)) || intersects(jsonStrings(row.operations_json), refs));
  const proposalIds = new Set(pendingProposals.map(row => String(row.proposal_id)));
  const retainedSessions = all('SELECT session_id,learner_id,status,context_json FROM vocabulary_sessions ORDER BY session_id')
    .filter(row => intersects(jsonStrings(row.context_json), refs));
  const sessionIds = new Set(retainedSessions.map(row => String(row.session_id)));
  const pendingCompletions = all("SELECT completion_id,session_id,learner_id,status,input_json FROM vocabulary_session_completions WHERE status IN ('pending','failed') ORDER BY completion_id")
    .filter(row => sessionIds.has(String(row.session_id)) || intersects(jsonStrings(row.input_json), refs));
  const publicationIds = new Set([...sourceDocuments, ...packages].map(row => String(row.publication_id)));
  const publications = all('SELECT * FROM shared_content_publications ORDER BY publication_id').filter(row => publicationIds.has(String(row.publication_id)));
  const imports = all('SELECT i.* FROM legacy_sense_imports i JOIN senses s USING(sense_id) WHERE s.word_id=? ORDER BY i.source_content_id,i.source_use_id', wordId);
  const contentImports = all('SELECT * FROM legacy_content_imports ORDER BY source_kind,source_id,source_sub_id').filter(row => contentIds.has(String(row.content_id)));
  const coverage = database.prepare('SELECT * FROM vocabulary_word_sense_coverage WHERE word_id=?').get(wordId) as Row | undefined;
  return {
    word: { wordId, hanzi: lexical.hanzi, traditional: lexical.traditional, pinyin: lexical.pinyin, meanings: meanings.length ? meanings.map(row => String(row.text)) : [lexical.meaning] },
    catalog: catalog ?? { version: 0, establishedAt: null }, senses, coverage: coverage ?? null,
    dependencies: {
      reportVersion: 2,
      contents, contentWords, answers, introductionBindings,
      suitability: all('SELECT * FROM content_mode_suitability ORDER BY content_id,mode').filter(row => contentIds.has(String(row.content_id))),
      sourceDocuments, packages, imports, contentImports, publications,
      introductionPreparation: all('SELECT * FROM word_introduction_preparation WHERE word_id=?', wordId),
      wordPreparation: all('SELECT * FROM word_preparation_work WHERE word_id=? ORDER BY work_id', wordId),
      practicePreparation: all('SELECT * FROM vocabulary_practice_preparation WHERE word_id=? ORDER BY work_id', wordId),
      reviewPreparation: all('SELECT * FROM word_review_preparation WHERE word_id=?', wordId),
      senseReadiness: all('SELECT * FROM vocabulary_sense_readiness WHERE word_id=?', wordId),
      selectionReadiness: all('SELECT * FROM vocabulary_default_selection_readiness WHERE word_id=?', wordId),
      repairTargets: all(`SELECT target.* FROM vocabulary_case_repair_targets target
        JOIN vocabulary_case_reviews review USING(case_id) JOIN reflection_cases c USING(case_id)
        WHERE c.word_id=? AND review.state='open' ORDER BY target.case_id`, wordId),
      pendingReflectionJobs, pendingDispatches, pendingProposals,
      pendingProposalBases: allProposalBases.filter(row => proposalIds.has(String(row.proposal_id))),
      pendingCompletions,
      learnerSenses: all('SELECT * FROM learner_senses WHERE word_id=? ORDER BY learner_id,sense_id', wordId),
      stashed: all('SELECT * FROM learner_words WHERE word_id=? ORDER BY learner_id', wordId),
      wordSchedules: all('SELECT * FROM learner_word_schedules WHERE word_id=? ORDER BY learner_id', wordId),
      pureCueSchedules: all('SELECT * FROM learner_pure_cue_schedules ORDER BY learner_id,content_id').filter(row => contentIds.has(String(row.content_id))),
      reserve: all('SELECT * FROM learner_word_preparation_reserve WHERE word_id=? ORDER BY learner_id', wordId),
      retainedSessions: retainedSessions.map(({ context_json: _context, ...row }) => row),
      preservedCounts: {
        encounters: Number(database.prepare('SELECT COUNT(DISTINCT encounter_id) n FROM encounter_words WHERE word_id=?').get(wordId)?.n ?? 0),
        teachingCompletions: Number(database.prepare('SELECT COUNT(*) n FROM teaching_completions WHERE word_id=?').get(wordId)?.n ?? 0),
        senseHistory: Number(database.prepare('SELECT COUNT(*) n FROM sense_revision_history h JOIN senses s USING(sense_id) WHERE s.word_id=?').get(wordId)?.n ?? 0),
      },
    },
  };
}

export type InventoryRetirementReport = {
  wordId: string; retireSenseIds: string[]; survivingSenseIds: string[];
  affectedContent: Array<{ contentId: string; version: number; kind: string; reasons: string[]; requiredRetirement: boolean }>;
  requiredRetireContentIds: string[]; reviewContentIds: string[];
  affectedSourceContentIds: string[]; affectedPackageIds: string[];
  contaminatedSourceIds: string[]; contaminatedPackageIds: string[];
  refreshPreparation: boolean; blockers: string[];
};

/** Structural dependency classification. Ambiguous content always needs a separate editorial disposition. */
export function reportInventoryRetirements(snapshot: InventorySnapshot, retireSenseIds: string[]): InventoryRetirementReport {
  if (snapshot.dependencies.reportVersion !== 2) throw new Error('Export a current dependency snapshot before reporting retirements');
  const active = new Set(snapshot.senses.filter(sense => sense.status === 'active').map(sense => sense.senseId));
  if (new Set(retireSenseIds).size !== retireSenseIds.length || retireSenseIds.some(id => !active.has(id))) throw new Error('Retirement IDs must name distinct active senses in the snapshot');
  const retiring = new Set(retireSenseIds), contents = rows(snapshot, 'contents'), words = rows(snapshot, 'contentWords');
  const answers = rows(snapshot, 'answers');
  const currentSource = rows(snapshot, 'introductionPreparation')[0]?.content_id;
  const sourceDocuments = rows(snapshot, 'sourceDocuments'), packages = rows(snapshot, 'packages'), imports = rows(snapshot, 'imports');
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const contaminatedSources = new Set(imports.filter(row => retiring.has(String(row.sense_id))).map(row => String(row.source_content_id)));
  for (const sense of snapshot.senses.filter(item => retiring.has(item.senseId))) {
    const sourceId = object(object(sense.description).source).contentId;
    if (typeof sourceId === 'string') contaminatedSources.add(sourceId);
  }
  for (const source of sourceDocuments) if (intersects(jsonStrings(source.content_json), retiring)) contaminatedSources.add(String(source.content_id));
  const contaminatedPackages = new Set(packages.filter(row => contaminatedSources.has(String(row.content_id))).map(row => String(row.package_id)));
  const contaminatedRefs = new Set([...contaminatedSources, ...contaminatedPackages]);
  const legacySourceBySense = new Map(snapshot.senses.map(sense => [sense.senseId, object(object(sense.description).source).contentId]));
  const reasons = new Map<string, Set<string>>(), required = new Set<string>();
  const add = (id: string, reason: string, mustRetire: boolean): void => {
    if (!reasons.has(id)) reasons.set(id, new Set());
    reasons.get(id)!.add(reason); if (mustRetire) required.add(id);
  };
  if (retiring.size) for (const content of contents.filter(row => row.availability === 'active')) {
    const id = String(content.content_id), mappings = words.filter(row => row.content_id === id && row.word_id === snapshot.word.wordId);
    if (mappings.some(row => retiring.has(String(row.sense_id)))) add(id, 'Mapped to a retired sense', true);
    const body = object(JSON.parse(String(content.body_json))), source = object(body.source);
    const relatedWordIds = new Set([
      ...words.filter(row => row.content_id === id && row.relation === 'target').map(row => String(row.word_id)),
      ...answers.filter(row => row.exercise_id === id).map(row => String(row.word_id)),
    ]);
    const rendersReference = content.kind === 'introduction' || (relatedWordIds.size === 1
      && (content.skill === 'recognition' || content.exercise_type === 'definition')
      && !(content.skill === 'production' && typeof body.prompt === 'string' && clozePromptParts(body.prompt).length > 1));
    if (rendersReference && ((content.kind === 'introduction' && intersects(jsonStrings(content.body_json), contaminatedRefs))
      || contaminatedSources.has(String(source.bootstrapContentId)))) {
      add(id, 'Renders a pinned bootstrap document or teaching package containing a retired sense', true);
    }
    if (rendersReference && content.kind === 'exercise' && typeof source.bootstrapContentId !== 'string'
      && mappings.some(row => {
        const senseId = String(row.sense_id);
        const cleanCurrentMapping = !contaminatedSources.has(String(currentSource))
          && imports.some(link => link.source_content_id === currentSource && link.sense_id === senseId);
        return !cleanCurrentMapping && contaminatedSources.has(String(legacySourceBySense.get(senseId)));
      })) add(id, 'Mapped sense can reveal an obsolete bootstrap through its retained source provenance', true);
    const target = mappings.some(row => row.relation === 'target');
    const answer = answers.some(row => row.exercise_id === id && row.word_id === snapshot.word.wordId);
    if ((target || answer) && content.kind === 'exercise' && content.skill === 'production'
      && (mappings.every(row => row.sense_id === null) || answers.filter(row => row.exercise_id === id).length > 1)) {
      add(id, 'Unmapped or shared-answer production material needs an explicit keep/retire decision', false);
    }
    if (target && content.kind === 'introduction' && !required.has(id)) add(id, 'Introduction scope requires review after the inventory changes', false);
  }
  // A teaching binding cannot remain usable with a retired member. Retire its bound repertoire together.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const binding of rows(snapshot, 'introductionBindings')) {
      const intro = String(binding.introduction_id), exercise = String(binding.exercise_id);
      if (!required.has(intro) && !required.has(exercise)) continue;
      for (const id of [intro, exercise]) if (!required.has(id) && contents.some(row => row.content_id === id && row.availability === 'active')) {
        add(id, 'Part of a teaching repertoire containing retired material', true); expanded = true;
      }
    }
  }
  // Review decisions must cover the same binding closure that apply will preserve or retire.
  expanded = true;
  while (expanded) {
    expanded = false;
    for (const binding of rows(snapshot, 'introductionBindings')) {
      const intro = String(binding.introduction_id), exercise = String(binding.exercise_id);
      if (!reasons.has(intro) && !reasons.has(exercise)) continue;
      for (const id of [intro, exercise]) if (!reasons.has(id) && contents.some(row => row.content_id === id && row.availability === 'active')) {
        add(id, 'Bound teaching material requires a consistent keep/retire decision', false); expanded = true;
      }
    }
  }
  const blockers: string[] = [];
  if (retiring.size) {
    for (const target of rows(snapshot, 'repairTargets')) {
      if (retiring.has(String(target.pending_sense_id)) || retiring.has(String(target.accepted_sense_id))) {
        blockers.push(`Open repair target references a retired sense: ${target.case_id}; reset pending intent, reassess with a retained sense, or resolve the case first`);
      }
    }
    for (const [key, idKey] of [['wordPreparation', 'work_id'], ['practicePreparation', 'work_id'], ['senseReadiness', 'word_id'], ['selectionReadiness', 'word_id']] as const) {
      for (const row of rows(snapshot, key)) if (row.status === 'running' || row.active_token !== null && row.active_token !== undefined) blockers.push(`Active ${key} lease: ${row[idKey]}`);
    }
    for (const key of ['introductionPreparation', 'reviewPreparation']) for (const row of rows(snapshot, key)) if (row.lease_token !== null && row.lease_token !== undefined) blockers.push(`Active ${key} lease: ${snapshot.word.wordId}`);
    for (const [key, idKey] of [['pendingReflectionJobs', 'job_id'], ['pendingDispatches', 'dispatch_id'], ['pendingProposals', 'proposal_id'], ['pendingCompletions', 'completion_id']] as const) {
      for (const row of rows(snapshot, key)) blockers.push(`Unresolved ${key}: ${row[idKey]}`);
    }
  }
  const affectedContent = contents.filter(row => reasons.has(String(row.content_id))).map(row => ({ contentId: String(row.content_id), version: Number(row.version), kind: String(row.kind), reasons: sorted(reasons.get(String(row.content_id))!), requiredRetirement: required.has(String(row.content_id)) })).sort((a, b) => a.contentId.localeCompare(b.contentId));
  return {
    wordId: snapshot.word.wordId, retireSenseIds: sorted(retiring), survivingSenseIds: sorted([...active].filter(id => !retiring.has(id))),
    affectedContent, requiredRetireContentIds: sorted(required), reviewContentIds: affectedContent.filter(item => !item.requiredRetirement).map(item => item.contentId),
    affectedSourceContentIds: sorted(contaminatedSources), affectedPackageIds: sorted(contaminatedPackages),
    contaminatedSourceIds: sorted(contaminatedSources), contaminatedPackageIds: sorted(contaminatedPackages),
    refreshPreparation: retiring.size > 0 && (retiring.size === active.size || contaminatedSources.has(String(currentSource)) || affectedContent.some(item => item.kind === 'introduction')),
    blockers: sorted(blockers),
  };
}
