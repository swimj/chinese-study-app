import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { VocabularyContent, VocabularyContentDraft, VocabularyJson, VocabularyWordRelationship } from '../../src/domain/vocabulary-content.ts';
import type { ContentExercise, WordContentDocument } from '../../src/domain/word-content/types.ts';
import { parseTeachingPackage, parseWordContent } from '../../src/domain/word-content/validation.ts';
import { materializeExercise, materializeTeachingPackage } from '../../src/domain/word-content/materialize.ts';

export type VocabularyImportReport = {
  createdContent: number; existingContent: number; createdSenses: number; importedPureSchedules: number;
  importedDeactivations: number; importedTeachingCompletions: number; mappedRelationships: number; unresolvedRelationships: number;
  excludedTeachingComponents: number;
  excludedUnsupportedContent: Array<{ sourceKind: string; sourceId: string; reason: string }>;
  bootstrapInventory: Array<{ wordId: string; documentCount: number; selectedContentId: string; eligibleDocumentCount: number }>;
};
type Lexical = { id: string; hanzi: string; traditional: string | null; meaning: string };
type BootstrapRow = { content_id: string; word_id: string; content_json: string; model: string; created_at: string };
type PackageRow = { package_id: string; word_id: string; content_id: string; package_json: string; model: string; created_at: string };
type Scope = { content_scope: 'learner' | 'shared'; owner_learner_id: string | null };
type CueRow = Scope & { cue_id: string; task_id: string; cue_type: string; cue_text: string; created_at: string; word_id: string; origin_kind: string };
type SupplementRow = Scope & { supplement_id: string; cue_id: string | null; task_id: string; english_frame: string;
  example_sentence: string; example_translation: string; created_at: string; word_id: string };
const IMPORT_ACTOR = 'vocabulary-cutover-v1';
function id(kind: string, ...keys: string[]): string {
  return `vocabulary:${kind}:${createHash('sha256').update(JSON.stringify(keys)).digest('hex')}`;
}
function encoded(value: unknown): VocabularyJson { return JSON.parse(JSON.stringify(value)) as VocabularyJson; }
function forms(word: Lexical): string[] { return [...new Set([word.hanzi,word.traditional].filter((form): form is string => Boolean(form)))]; }

/** Deterministic conversion and publication materialization. Caller owns the transaction (normally migration runner's after hook).
 * Uses only the supplied database: no app singleton, current learner context or provider calls.
 * Re-running skips imported identities and never overwrites subsequent authored changes. */
export function importLegacyVocabulary(db: DatabaseSync, options: { wordId?: string; originKind?: 'import' | 'model' } = {}): VocabularyImportReport {
  if (!db.isTransaction) throw new Error('Legacy vocabulary import requires the caller-owned transaction');
  const report: VocabularyImportReport = { createdContent: 0,existingContent: 0,createdSenses: 0,importedPureSchedules: 0,
    importedDeactivations: 0,importedTeachingCompletions: 0,mappedRelationships: 0,unresolvedRelationships: 0,
    excludedTeachingComponents: 0,excludedUnsupportedContent: [],bootstrapInventory: [] };
  const filterArgs = options.wordId === undefined ? [] : [options.wordId];
  const words = new Map<string,Lexical>();
  const documents = db.prepare(`SELECT * FROM word_content_documents ${options.wordId === undefined ? '' : 'WHERE word_id=?'} ORDER BY created_at,content_id`).all(...filterArgs) as BootstrapRow[];
  const parsedDocuments = new Map(documents.map((row) => [row.content_id,parseWordContent(JSON.parse(row.content_json))]));
  function availability(kind: string, sourceId: string, shared: boolean): VocabularyContent['availability'] {
    const publication = db.prepare('SELECT publication_status FROM shared_content_publications WHERE content_kind=? AND content_id=?')
      .get(kind,sourceId) as { publication_status: string } | undefined;
    const status = publication?.publication_status;
    if (status === 'retired') return 'retired';
    if (shared && status !== 'available' && status !== 'shared_trial') return 'quarantined';
    return 'active';
  }
  function isReplaced(kind: string,sourceId: string): boolean {
    return Boolean(db.prepare('SELECT 1 FROM content_improvement_replacements WHERE kind=? AND source_id=?').get(kind,sourceId));
  }
  function sourceAvailability(kind: string, sourceId: string, scope: Scope): VocabularyContent['availability'] {
    const replacementKind = kind === 'production_cue_supplement' ? 'supplement' : kind;
    return isReplaced(replacementKind,sourceId) ? 'retired' : availability(kind,sourceId,scope.content_scope === 'shared');
  }
  function emit(key: string, name: string, entityKind: string, entityId: string, data: unknown, timestamp: string): void {
    db.prepare(`INSERT OR IGNORE INTO backend_events(event_id,occurred_at,recorded_at,name,payload_version,data_json,
      actor_kind,actor_id,entity_kind,entity_id) VALUES (?,?,?,?,1,?,'service',?,?,?)`)
      .run(id('import-event',key),timestamp,timestamp,name,JSON.stringify(data),IMPORT_ACTOR,entityKind,entityId);
  }
  function imported(kind: string, sourceId: string, subId = ''): string | null {
    const row = db.prepare('SELECT content_id FROM legacy_content_imports WHERE source_kind=? AND source_id=? AND source_sub_id=?')
      .get(kind,sourceId,subId) as { content_id: string } | undefined;
    return row?.content_id ?? null;
  }
  function save(kind: string, sourceId: string, subId: string, draft: VocabularyContentDraft, timestamp: string): string {
    const existing = imported(kind,sourceId,subId);
    if (existing) { report.existingContent += 1; return existing; }
    const contentId = id('content',kind,sourceId,subId);
    const content = { ...draft,originKind: options.originKind ?? 'import',contentId,ownerLearnerId: draft.ownerLearnerId ?? null,authorKind: null,authorId: null,
      words: [...draft.words].sort((a,b) => a.wordId.localeCompare(b.wordId)).map((word) => ({ ...word,senseId: word.senseId ?? null,
        senseMappingEstablishedAt: word.senseMappingEstablishedAt ?? null })),version: 1,createdAt: timestamp,updatedAt: timestamp } as VocabularyContent;
    db.prepare(`INSERT INTO content_items(content_id,kind,payload_version,body_json,exercise_type,skill,exercise_role,assessment_json,
      access_scope,owner_learner_id,availability,origin_kind,author_kind,author_id,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,1,?,?)`).run(contentId,content.kind,content.payloadVersion,JSON.stringify(content.body),
      content.kind === 'exercise' ? content.exerciseType : null,content.kind === 'exercise' ? content.skill : null,
      content.kind === 'exercise' ? content.exerciseRole : null,content.kind === 'exercise' ? JSON.stringify(content.assessment) : null,
      content.accessScope,content.ownerLearnerId ?? null,content.availability,content.originKind,timestamp,timestamp);
    for (const word of content.words) {
      db.prepare('INSERT INTO content_words(content_id,word_id,relation,sense_id,sense_mapping_established_at) VALUES (?,?,?,?,?)')
        .run(contentId,word.wordId,word.relation,word.senseId ?? null,word.senseMappingEstablishedAt ?? null);
      if (word.senseMappingEstablishedAt == null) report.unresolvedRelationships += 1; else report.mappedRelationships += 1;
    }
    if (content.kind === 'exercise') {
      content.answers.sort((a,b) => a.wordId.localeCompare(b.wordId));
      if (content.answers.length === 0) throw new Error(`Legacy exercise ${kind}/${sourceId} has no accepted answers`);
      for (const answer of content.answers) db.prepare('INSERT INTO exercise_answer_words(exercise_id,word_id,accepted_forms_json) VALUES (?,?,?)')
        .run(contentId,answer.wordId,JSON.stringify(answer.acceptedForms));
    } else {
      content.teachingExercises.forEach((binding,position) => db.prepare('INSERT INTO introduction_exercises VALUES (?,?,?,?)')
        .run(contentId,position,binding.exerciseId,binding.exerciseVersion));
    }
    db.prepare(`INSERT INTO content_revision_history(change_id,content_id,version,previous_version,snapshot_json,change_kind,
      write_strategy,actor_kind,actor_id,reason_json,recorded_at) VALUES (?,?,1,NULL,?,'created','create','service',?,?,?)`)
      .run(id('content-history',contentId),contentId,JSON.stringify(content),IMPORT_ACTOR,
        JSON.stringify({ sourceKind: kind,sourceId,sourceSubId: subId,legacyMetadata: 'retained in original source tables' }),timestamp);
    db.prepare('INSERT INTO legacy_content_imports VALUES (?,?,?,?,1)').run(kind,sourceId,subId,contentId);
    emit(`content:${contentId}`,'vocabulary.content.imported','content',contentId,{ sourceKind: kind,sourceId,sourceSubId: subId },timestamp);
    report.createdContent += 1;
    return contentId;
  }
  function requireWord(wordId: string): Lexical {
    let word = words.get(wordId);
    if (!word) {
      word = db.prepare('SELECT id,hanzi,traditional,meaning FROM lexical_words WHERE id=?').get(wordId) as Lexical | undefined;
      if (word) words.set(wordId,word);
    }
    if (!word) throw new Error(`Missing lexical word ${wordId}`);
    return word;
  }
  function relation(wordId: string,source: ContentExercise | null,contentId: string | null,timestamp: string): VocabularyWordRelationship {
    const relationship: VocabularyWordRelationship = { wordId,relation: 'target' };
    if (!source || source.stimulus.kind !== 'example_cloze' || source.stimulus.example.contentId !== contentId) return relationship;
    const document = parsedDocuments.get(contentId!);
    if (!document || document.word.wordId !== wordId) return relationship;
    const exampleId = source.stimulus.example.exampleId;
    const matching = document.uses.filter((use) => use.exampleIds.includes(exampleId));
    if (matching.length !== 1) return relationship;
    const mapped = db.prepare('SELECT sense_id FROM legacy_sense_imports WHERE source_content_id=? AND source_use_id=?')
      .get(contentId!,matching[0]!.id) as { sense_id: string } | undefined;
    if (mapped) { relationship.senseId = mapped.sense_id; relationship.senseMappingEstablishedAt = timestamp; }
    return relationship;
  }
  const grouped = new Map<string,BootstrapRow[]>();
  for (const row of documents) grouped.set(row.word_id,[...grouped.get(row.word_id) ?? [],row]);
  for (const [wordId,rows] of grouped) {
    const eligible = rows.filter((row) => availability('word_content',row.content_id,true) === 'active');
    const selected = (eligible.length ? eligible : rows).at(-1)!;
    const inventory = { wordId,documentCount: rows.length,selectedContentId: selected.content_id,eligibleDocumentCount: eligible.length };
    report.bootstrapInventory.push(inventory);
    let createdWordSenses = 0;
    for (const row of rows) {
      const document = parsedDocuments.get(row.content_id)!;
      for (const use of document.uses) {
        if (db.prepare('SELECT 1 FROM legacy_sense_imports WHERE source_content_id=? AND source_use_id=?').get(row.content_id,use.id)) continue;
        const senseId = id('sense',row.content_id,use.id);
        const description = { label: use.label,notes: [...use.notes],examples: use.exampleIds.map((exampleId) => document.examples.find((example) => example.id === exampleId)!),
          source: { contentId: row.content_id,useId: use.id,model: row.model } };
        const sense = { senseId,wordId,description,status: row.content_id === selected.content_id ? 'active' : 'retired',version: 1,
          createdAt: row.created_at,updatedAt: row.created_at };
        db.prepare('INSERT INTO senses(sense_id,word_id,description_json,status,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)')
          .run(senseId,wordId,JSON.stringify(description),sense.status,row.created_at,row.created_at);
        db.prepare(`INSERT INTO sense_revision_history(change_id,sense_id,version,previous_version,snapshot_json,change_kind,
          actor_kind,actor_id,reason_json,recorded_at) VALUES (?,?,1,NULL,?,'created','service',?,?,?)`)
          .run(id('sense-history',senseId),senseId,JSON.stringify(sense),IMPORT_ACTOR,JSON.stringify({ sourceContentId: row.content_id,sourceUseId: use.id }),row.created_at);
        db.prepare('INSERT INTO legacy_sense_imports VALUES (?,?,?,1)').run(row.content_id,use.id,senseId);
        report.createdSenses += 1; createdWordSenses += 1;
      }
    }
    db.prepare(`INSERT INTO vocabulary_word_catalogs(word_id,sense_catalog_version,senses_established_at) VALUES (?,1,?)
      ON CONFLICT(word_id) DO UPDATE SET sense_catalog_version=sense_catalog_version+?`)
      .run(wordId,selected.created_at,createdWordSenses > 0 ? 1 : 0);
    emit(`bootstrap:${wordId}:${selected.content_id}:${rows.length}`,'vocabulary.bootstrap.inventory','word',wordId,inventory,selected.created_at);
  }
  const packages = db.prepare(`SELECT * FROM word_teaching_packages ${options.wordId === undefined ? '' : 'WHERE word_id=?'} ORDER BY created_at,package_id`).all(...filterArgs) as PackageRow[];
  const packageSnapshots = new Map<string,ReturnType<typeof materializeTeachingPackage>>();
  for (const row of packages) {
    const source = parsedDocuments.get(row.content_id);
    if (!source) throw new Error(`Teaching package ${row.package_id} has no source`);
    const teaching = parseTeachingPackage(JSON.parse(row.package_json));
    const snapshot = materializeTeachingPackage(teaching,[source]);
    packageSnapshots.set(row.package_id,snapshot);
    let status = isReplaced('teaching_package',row.package_id) ? 'retired' : availability('teaching_package',row.package_id,true);
    if (status === 'active' && availability('word_content',row.content_id,true) !== 'active') status = availability('word_content',row.content_id,true);
    const bindings = teaching.rehearsals.map((exercise) => {
      const materialized = snapshot.rehearsals.find((item) => item.exerciseId === exercise.id)!;
      const contentId = save('teaching_exercise',row.package_id,exercise.id,{ kind: 'exercise',payloadVersion: 1,
        body: encoded({ prompt: materialized.stimulus.text,instruction: materialized.instruction,stimulus: materialized.stimulus,
          source: { kind: 'teaching_exercise',packageId: row.package_id,exerciseId: exercise.id,bootstrapContentId: row.content_id,model: row.model } }),
        exerciseType: exercise.stimulus.kind === 'example_cloze' ? 'cloze' : 'definition',skill: 'production',exerciseRole: 'teaching',
        assessment: encoded({ responseMode: materialized.responseMode,matchingProfile: materialized.matchingProfile,contract: materialized.contract }),
        accessScope: 'shared',availability: status,originKind: 'import',words: [relation(row.word_id,exercise,row.content_id,row.created_at)],
        answers: materialized.acceptedAnswers.map((answer) => ({ wordId: answer.wordId,acceptedForms: [...new Set([answer.hanzi,answer.traditional].filter((item): item is string => item !== null))] })) },row.created_at);
      return { exerciseId: contentId,exerciseVersion: 1 };
    });
    save('teaching_package',row.package_id,'',{ kind: 'introduction',payloadVersion: 1,
      body: encoded({ beats: snapshot.beats,bootstrapContentId: row.content_id,sourcePackageId: row.package_id,model: row.model }),
      accessScope: 'shared',availability: status,originKind: 'import',words: [{ wordId: row.word_id,relation: 'target' }],teachingExercises: bindings },row.created_at);
  }
  // These components are exclusively teaching rehearsals, including unpublished components.
  report.excludedTeachingComponents = Number((db.prepare(`SELECT COUNT(*) AS n FROM word_introduction_components c JOIN word_content_documents d ON d.content_id=c.content_id WHERE c.stage='practice' ${options.wordId === undefined ? '' : 'AND d.word_id=?'}`).get(...filterArgs) as { n: number }).n);
  const cues = db.prepare(`SELECT c.*,t.word_id FROM scoped_production_cues c JOIN production_tasks t ON t.task_id=c.task_id ${options.wordId === undefined ? '' : 'WHERE t.word_id=?'} ORDER BY c.cue_id`).all(...filterArgs) as CueRow[];
  const cueById = new Map(cues.map((cue) => [cue.cue_id,cue]));
  function cueDraft(cue: CueRow): VocabularyContentDraft {
    const canonical = db.prepare(`SELECT document_json,source_word_content_id FROM scoped_review_content_records
      WHERE kind='production_cue' AND content_id=? ORDER BY revision DESC LIMIT 1`).get(cue.cue_id) as { document_json: string; source_word_content_id: string | null } | undefined;
    let exercise: ContentExercise | null = null;
    let stimulus: unknown = { text: cue.cue_text,source: { kind: 'legacy',cueId: cue.cue_id } };
    if (canonical) {
      const document = JSON.parse(canonical.document_json) as { exercise: ContentExercise; contents: WordContentDocument[] };
      exercise = document.exercise;
      stimulus = materializeExercise(document.exercise,document.contents).stimulus;
    }
    const answers = (db.prepare(`SELECT a.word_id FROM scoped_production_cue_accepted_words a WHERE a.cue_id=? ORDER BY a.position`).all(cue.cue_id) as Array<{ word_id: string }>)
      .map((answer) => ({ wordId: answer.word_id,acceptedForms: forms(requireWord(answer.word_id)) }));
    return { kind: 'exercise',payloadVersion: 1,body: encoded({ prompt: cue.cue_text,instruction: '',stimulus,
      source: { kind: 'production_cue',cueId: cue.cue_id,taskId: cue.task_id,originKind: cue.origin_kind } }),
      exerciseType: cue.cue_type === 'minimal_context' ? 'cloze' : cue.cue_type,skill: 'production',exerciseRole: 'general',
      assessment: { responseMode: 'hanzi_entry',matchingProfile: 'mandarin' },accessScope: cue.content_scope === 'shared' ? 'shared' : 'private',
      ownerLearnerId: cue.owner_learner_id,availability: sourceAvailability('production_cue',cue.cue_id,cue),originKind: 'import',
      words: answers.map((answer) => relation(answer.wordId,exercise,canonical?.source_word_content_id ?? null,cue.created_at)),answers };
  }
  function excludeUnsupported(sourceKind: string,sourceId: string,reason: string,timestamp: string): void {
    const excluded={sourceKind,sourceId,reason};report.excludedUnsupportedContent.push(excluded);
    emit(`unsupported:${sourceKind}:${sourceId}`,'vocabulary.content.import_excluded','legacy_content',sourceId,excluded,timestamp);
  }
  for (const cue of cues) {
    const draft=cueDraft(cue);
    if (draft.kind==='exercise' && draft.answers.length===0) {
      // Existing serving rejects an empty answer space; the task target alone never made it a valid cue.
      excludeUnsupported('production_cue',cue.cue_id,'missing_accepted_answers',cue.created_at);continue;
    }
    save('production_cue',cue.cue_id,'',draft,cue.created_at);
  }
  const supplements = db.prepare(`SELECT s.*,t.word_id FROM scoped_production_cue_supplements s JOIN production_tasks t ON t.task_id=s.task_id ${options.wordId === undefined ? '' : 'WHERE t.word_id=?'} ORDER BY s.supplement_id`).all(...filterArgs) as SupplementRow[];
  for (const supplement of supplements) {
    const cue = supplement.cue_id === null ? null : cueById.get(supplement.cue_id);
    if (supplement.cue_id !== null && !cue) throw new Error('Supplement has missing cue');
    if (cue?.content_scope === 'learner' && (supplement.content_scope === 'shared' || supplement.owner_learner_id !== cue.owner_learner_id)) {
      throw new Error('Supplement cannot publish or cross owners with a private cue');
    }
    const base = cue ? cueDraft(cue) : null;
    if (base?.kind==='exercise' && base.answers.length===0) {
      excludeUnsupported('production_cue_supplement',supplement.supplement_id,'attached_cue_missing_accepted_answers',supplement.created_at);continue;
    }
    const status = sourceAvailability('production_cue_supplement',supplement.supplement_id,supplement);
    const draft: VocabularyContentDraft = { kind: 'exercise',payloadVersion: 1,
      body: encoded({ prompt: cue?.cue_text ?? requireWord(supplement.word_id).meaning,instruction: '',
        reveal: { englishFrame: supplement.english_frame,exampleSentence: supplement.example_sentence,exampleTranslation: supplement.example_translation },
        source: { kind: 'production_cue_supplement',supplementId: supplement.supplement_id,cueId: supplement.cue_id,taskId: supplement.task_id } }),
      exerciseType: cue?.cue_type ?? 'definition_gloss',skill: 'production',exerciseRole: 'general',
      assessment: { responseMode: 'hanzi_entry',matchingProfile: 'mandarin' },accessScope: supplement.content_scope === 'shared' ? 'shared' : 'private',
      ownerLearnerId: supplement.owner_learner_id,availability: status === 'retired' || base?.availability === 'retired' ? 'retired' : status === 'quarantined' || base?.availability === 'quarantined' ? 'quarantined' : 'active',
      originKind: 'import',words: base?.words ?? [{ wordId: supplement.word_id,relation: 'target' }],
      answers: base?.kind === 'exercise' ? base.answers : [{ wordId: supplement.word_id,acceptedForms: forms(requireWord(supplement.word_id)) }] };
    save('production_cue_supplement',supplement.supplement_id,'',draft,supplement.created_at);
  }
  const pureCues = db.prepare(`SELECT id,stimulus,axis_note,teaching_note,created_at FROM pure_cues p ${options.wordId === undefined ? '' : 'WHERE EXISTS (SELECT 1 FROM pure_cue_accepted_words a WHERE a.pure_cue_id=p.id AND a.word_id=?)'} ORDER BY id`).all(...filterArgs) as Array<{ id: string; stimulus: string; axis_note: string; teaching_note: string; created_at: string }>;
  for (const pure of pureCues) {
    const answers = (db.prepare('SELECT word_id FROM pure_cue_accepted_words WHERE pure_cue_id=? ORDER BY position').all(pure.id) as Array<{ word_id: string }>)
      .map((answer) => ({ wordId: answer.word_id,acceptedForms: forms(requireWord(answer.word_id)) }));
    if (answers.length===0) {excludeUnsupported('pure_cue',pure.id,'missing_accepted_answers',pure.created_at);continue;}
    const contentId = save('pure_cue',pure.id,'',{ kind: 'exercise',payloadVersion: 1,
      body: { prompt: pure.stimulus,instruction: '',reveal: { axisNote: pure.axis_note,teachingNote: pure.teaching_note },
        source: { kind: 'pure_cue',pureCueId: pure.id } },exerciseType: 'pure_cue',skill: 'production',exerciseRole: 'general',
      assessment: { responseMode: 'hanzi_entry',matchingProfile: 'mandarin' },accessScope: 'shared',availability: availability('pure_cue',pure.id,true),originKind: 'import',
      words: answers.map((answer) => ({ wordId: answer.wordId,relation: 'target' })),answers },pure.created_at);
    const states = db.prepare('SELECT * FROM learner_pure_cue_state WHERE pure_cue_id=?').all(pure.id) as Array<{ learner_id: string; interval_hours: number; ease_factor: number; last_studied_at: string | null; next_due_at: string;
        strong_since: string | null; strong_successes: number; adopted_at: string }>;
    for (const state of states) {
      report.importedPureSchedules += Number(db.prepare(`INSERT OR IGNORE INTO learner_pure_cue_schedules
        (learner_id,content_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json) VALUES (?,?,?,?,'legacy-import-v1',?)`)
        .run(state.learner_id,contentId,state.next_due_at,state.last_studied_at,JSON.stringify({ intervalHours: state.interval_hours,easeFactor: state.ease_factor,
          strongSince: state.strong_since,strongSuccesses: state.strong_successes,adoptedAt: state.adopted_at })).changes);
    }
  }
  const contrast = db.prepare(`SELECT p.*,c.content_scope,c.owner_learner_id,c.title,c.note FROM scoped_contrast_prompts p
    JOIN scoped_contrast_clusters c ON c.id=p.cluster_id ${options.wordId === undefined ? '' : 'WHERE EXISTS (SELECT 1 FROM scoped_contrast_cluster_members m WHERE m.cluster_id=p.cluster_id AND m.word_id=?)'} ORDER BY p.id`).all(...filterArgs) as Array<Scope & { id: string; cluster_id: string; target_word_id: string; prompt_text: string; explanation: string; title: string; note: string }>;
  for (const prompt of contrast) {
    const members = db.prepare('SELECT word_id,nuance_note FROM scoped_contrast_cluster_members WHERE cluster_id=? ORDER BY display_order,word_id')
      .all(prompt.cluster_id) as Array<{ word_id: string; nuance_note: string }>;
    const timestamp = new Date().toISOString(); // Import creation time; the unavailable legacy time stays explicitly null in source metadata.
    const status = isReplaced('contrast_prompt',prompt.id) ? 'retired' : availability('contrast_cluster',prompt.cluster_id,prompt.content_scope === 'shared');
    save('contrast_prompt',prompt.id,'',{ kind: 'exercise',payloadVersion: 1,
      body: encoded({ prompt: prompt.prompt_text,instruction: '',choices: members.map((member) => ({ wordId: member.word_id,hanzi: requireWord(member.word_id).hanzi,traditional: requireWord(member.word_id).traditional,explanation: member.nuance_note })),
        reveal: { explanation: prompt.explanation,correctWordId: prompt.target_word_id },
        source: { kind: 'contrast_prompt',promptId: prompt.id,clusterId: prompt.cluster_id,title: prompt.title,note: prompt.note,legacyCreatedAt: null } }),
      exerciseType: 'contrast',skill: 'contextual_selection',exerciseRole: 'general',assessment: { responseMode: 'word_choice',correctWordId: prompt.target_word_id },
      accessScope: prompt.content_scope === 'shared' ? 'shared' : 'private',ownerLearnerId: prompt.owner_learner_id,availability: status,originKind: 'import',
      words: members.map((member) => ({ wordId: member.word_id,relation: member.word_id === prompt.target_word_id ? 'target' : 'context' })),
      answers: [{ wordId: prompt.target_word_id,acceptedForms: forms(requireWord(prompt.target_word_id)) }] },timestamp);
  }
  const deactivated = db.prepare(`SELECT a.learner_id,a.cue_id,a.updated_at FROM learner_owned_production_cue_activation_state a JOIN scoped_production_cues c ON c.cue_id=a.cue_id JOIN production_tasks t ON t.task_id=c.task_id WHERE a.active=0 ${options.wordId === undefined ? '' : 'AND t.word_id=?'}`).all(...filterArgs) as Array<{ learner_id: string; cue_id: string; updated_at: string }>;
  for (const state of deactivated) {
    const ids = [imported('production_cue',state.cue_id),...supplements.filter((supplement) => supplement.cue_id === state.cue_id)
      .map((supplement) => imported('production_cue_supplement',supplement.supplement_id))];
    for (const contentId of ids) if (contentId) report.importedDeactivations += Number(db.prepare(`INSERT OR IGNORE INTO learner_content_deactivations
      (learner_id,content_id,deactivated_at) VALUES (?,?,?)`).run(state.learner_id,contentId,state.updated_at).changes);
  }
  const completed = db.prepare(`SELECT event_id,learner_id,word_id,package_id,occurred_at FROM learner_word_introduction_events WHERE event_kind='completed' ${options.wordId === undefined ? '' : 'AND word_id=?'} ORDER BY sequence`).all(...filterArgs) as Array<{ event_id: string; learner_id: string; word_id: string; package_id: string; occurred_at: string }>;
  for (const completion of completed) {
    const snapshot = packageSnapshots.get(completion.package_id);
    if (!snapshot) throw new Error('Completed teaching has missing retained package');
    report.importedTeachingCompletions += Number(db.prepare(`INSERT OR IGNORE INTO teaching_completions
      (teaching_completion_id,learner_id,word_id,completion_id,source_kind,source_id,snapshot_json,completed_at)
      VALUES (?,?,?,NULL,'legacy_import',?,?,?)`).run(id('teaching-completion',completion.learner_id,completion.event_id),completion.learner_id,
      completion.word_id,completion.event_id,JSON.stringify({ ...snapshot,introductionId: imported('teaching_package',completion.package_id),
        source: { kind: 'legacy_import',eventId: completion.event_id },senseScope: 'unknown' }),completion.occurred_at).changes);
  }
  return report;
}

/** Indexed per-word publication seam; new model calls stay in the authoring service. */
export function importLegacyVocabularyWord(db: DatabaseSync, wordId: string, options: { originKind?: 'import' | 'model' } = {}): VocabularyImportReport {
  if (!wordId.trim()) throw new Error('Expected lexical word identity');
  return importLegacyVocabulary(db,{ ...options,wordId });
}
