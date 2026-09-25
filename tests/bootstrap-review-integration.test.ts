import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { normalizeReviewExercises } from '../server/word-content/review-authoring.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { isPureCueSessionReviewItem, type SessionStudyItem } from '../src/domain/study-actions.ts';
import { createBucketSessionState, getActiveSessionUnit, markActiveSessionUnitStarted, rateActiveSessionUnit } from '../src/lib/session-state.ts';
import { resolveSessionProductionResponse } from '../src/domain/production-response.ts';
import { createSessionReflectionEvidenceAccumulator, recordProductionMistakeEvidence } from '../src/features/session/session-reflection-evidence.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import type { ReflectionOperation } from '../src/domain/reflection.ts';

type Db = typeof import('../server/db.ts');
type ReviewDb = typeof import('../server/db/review-content.ts');
let db: Db;
let review: ReviewDb;
let sqlite: DatabaseSync;
let dir = '';
const learner = 'review-learner';
const createdAt = '2026-09-25T00:00:00.000Z';
const today = new Date().toISOString().slice(0, 10);
const call = <T>(fn: () => T): T => db.runWithLearnerId(learner, fn);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-review-integration-'));
  const previous = { APP_MODE: process.env.APP_MODE, APP_AUTH_MODE: process.env.APP_AUTH_MODE, APP_DATA_DIR: process.env.APP_DATA_DIR };
  Object.assign(process.env, { APP_MODE: 'study', APP_AUTH_MODE: 'clerk', APP_DATA_DIR: dir });
  try {
    db = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?bootstrap-review=${Date.now()}`);
    review = await import('../server/db/review-content.ts');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  db.bootstrapLearner({ learnerId: learner });
  db.bootstrapLearner({ learnerId: 'second-learner' });
  sqlite = new DatabaseSync(path.join(dir, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.function('current_learner_id', () => learner);
});
after(() => { sqlite?.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function prepare(suffix: string) {
  const original = wordContentFixtures[0]!;
  const wordId = `word-${suffix}`;
  const content = { ...original.content, id: `content-${suffix}`, word: { ...original.content.word, wordId } };
  const teaching = {
    ...original.teaching, id: `teaching-${suffix}`, wordContentId: content.id,
    rehearsals: original.teaching.rehearsals.map((exercise) => ({
      ...exercise, contract: { kind: 'target_rehearsal' as const, wordId },
      acceptedAnswers: [{ wordId, hanzi: content.word.hanzi, traditional: content.word.traditional }],
      stimulus: exercise.stimulus.kind === 'example_cloze'
        ? { ...exercise.stimulus, example: { ...exercise.stimulus.example, contentId: content.id } }
        : exercise.stimulus,
    })),
  };
  const fixture = { content, teaching };
  sqlite.prepare(`INSERT INTO lexical_words
    (id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES (?,?,?,?,?,'["dry dictionary fallback"]','[]',10,?)`).run(
    wordId, fixture.content.word.hanzi, fixture.content.word.traditional, fixture.content.word.pinyin, 'dry dictionary fallback', createdAt,
  );
  for (const learnerId of [learner, 'second-learner']) {
    sqlite.prepare(`INSERT INTO learner_word_state (learner_id,word_id,status) VALUES (?,?,'review')`).run(learnerId, wordId);
    sqlite.prepare(`INSERT INTO learner_owned_word_study_admission_state (learner_id,word_id,study_phase,earliest_next_study_at) VALUES (?,?,'review',NULL)`).run(learnerId, wordId);
    sqlite.prepare(`INSERT INTO learner_owned_word_skill_state
      (learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
      VALUES (?,?,'production',1,24,?,?,2.5)`).run(learnerId, wordId, '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z');
  }
  sqlite.prepare(`INSERT INTO learner_owned_word_skill_state
    (learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
    VALUES (?,?,'recognition',1,48,?,?,2.5)`).run(learner, wordId, '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z');
  call(() => {
    const current = new Date().toISOString();
    const expires = new Date(Date.now() + 300_000).toISOString();
    db.claimWordIntroductionStage(wordId, 'bootstrap', `bootstrap-${suffix}`, current, expires);
    db.finishWordIntroductionBootstrap(wordId, `bootstrap-${suffix}`, fixture.content, 'fake');
    db.claimWordIntroductionStage(wordId, 'teaching', `teaching-${suffix}`, current, expires);
    db.finishWordIntroductionTeaching(wordId, `teaching-${suffix}`, fixture.teaching, 'fake');
    db.pinWordTeachingPackage(wordId, fixture.teaching.id);
  });
  const exercises = normalizeReviewExercises({ exercises: [{
    id: 'property', cueType: 'minimal_context',
    stimulus: { kind: 'example_cloze', exampleId: 'property', occurrenceIndexes: [0], frame: 'Notify the management office for the record.' },
    supplement: null,
  }] }, fixture.content, (localId) => `review-${suffix}-${localId}`);
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 300_000).toISOString();
  call(() => {
    assert.equal(review.claimWordReviewPreparation(wordId, fixture.content.id, `claim-${suffix}`, now, later), 'claimed');
    review.finishWordReviewPreparation(wordId, `claim-${suffix}`, exercises, 'fake');
  });
  return { ...fixture, wordId, cueId: exercises[0]!.exercise.id };
}

function production(wordId: string, learnerId = learner): SessionStudyItem {
  const payload = db.runWithLearnerId(learnerId, () => db.getSessionPayload(today, { random: () => 0 }));
  const item = payload.buckets.review.find((item): item is SessionStudyItem => (
    !isPureCueSessionReviewItem(item) && item.targetWordId === wordId && item.actionKind === 'production'
  ));
  assert.ok(item, `No review production action for ${wordId}`);
  return item;
}

function recognitionFor(wordId: string): SessionStudyItem {
  sqlite.prepare("UPDATE learner_owned_word_skill_state SET enabled=0 WHERE learner_id=? AND word_id=? AND skill_id='production'").run(learner, wordId);
  try {
    const item = call(() => db.getSessionPayload(today)).buckets.review.find((candidate): candidate is SessionStudyItem =>
      !isPureCueSessionReviewItem(candidate) && candidate.targetWordId === wordId && candidate.actionKind === 'recognition');
    assert.ok(item);
    return item;
  } finally {
    sqlite.prepare("UPDATE learner_owned_word_skill_state SET enabled=1 WHERE learner_id=? AND word_id=? AND skill_id='production'").run(learner, wordId);
  }
}

test('published bootstrap exercise serves as ordinary shared production with exact source and reflection evidence', () => {
  const source = prepare('serve');
  const item = production(source.wordId);
  assert.equal(item.production?.cueId, source.cueId);
  assert.equal(item.production?.cueType, 'minimal_context');
  assert.match(item.production!.text, /____/);
  assert.ok(!item.production!.text.includes('dry dictionary fallback'));
  assert.deepEqual(item.contentRef, { type: 'production_cue', taskId: item.production!.taskId, cueId: source.cueId });
  assert.equal(item.rehearsal, undefined);
  const recognition = recognitionFor(source.wordId);
  assert.equal(recognition.wordContent?.id, source.content.id);
  assert.equal(production(source.wordId, 'second-learner').production?.cueId, source.cueId);
  const canonical = call(() => review.getCanonicalReviewContent('production_cue', source.cueId));
  assert.equal(canonical?.sourceWordContentId, source.content.id);
  assert.equal(canonical?.kind, 'production_cue');
  if (canonical?.kind !== 'production_cue') throw new Error('Missing source');
  assert.equal(canonical.exercise.contract.kind, 'targeted_review');
  assert.deepEqual(canonical.contents, [source.content]);
  const published = db.getSharedContentPublicationForContent('production_cue', source.cueId);
  assert.equal(published?.publicationStatus, 'shared_trial');

  const state = markActiveSessionUnitStarted(createBucketSessionState({ sessionId: 'review-evidence', buckets: { review: [item], learning: [], unstudied: [] } }));
  assert.equal(getActiveSessionUnit(state).type, 'study');
  const result = rateActiveSessionUnit(state, 'forgot', { response: '通知', productionResponse: resolveSessionProductionResponse({
    submittedText: '通知', anchorWordId: source.wordId, production: item.production, profileId: 'mandarin',
  }) });
  const attempt = result.state.reviewProgress[item.sessionActionId]!.attempts[0]!;
  const evidence = recordProductionMistakeEvidence(createSessionReflectionEvidenceAccumulator(), { item, incorrectAttempt: attempt, promptDisplayedMeanings: [] });
  assert.equal(evidence.items.length, 1);
  assert.equal(evidence.items[0]!.cuesAsShown[0]!.cueId, source.cueId);
  assert.equal(evidence.items[0]!.cuesAsShown[0]!.text, item.production!.text);
});

test('quarantining bootstrap source excludes future serving but preserves historical review identity', () => {
  const source = prepare('quarantine');
  const frozen = production(source.wordId).production!;
  const publication = db.getSharedContentPublicationForContent('word_content', source.content.id)!;
  db.quarantineSharedContentPublication({ publicationId: publication.publicationId, operatorId: 'operator', reason: 'Incorrect source' });
  assert.equal(call(() => review.isCanonicalReviewSourceEligible('production_cue', source.cueId)), false);
  assert.equal(production(source.wordId).production?.cueId, null);
  assert.equal(frozen.cueId, source.cueId);
  const recognition = recognitionFor(source.wordId);
  assert.equal(recognition.wordContent, undefined);
  assert.ok(call(() => review.getCanonicalReviewContent('production_cue', source.cueId)));
});

function authorizeRepair(source: ReturnType<typeof prepare>) {
  const item = production(source.wordId);
  const sessionId = `repair-session-${source.wordId}`;
  const operation: ReflectionOperation = { kind: 'repair_production_cue', version: 2,
    wordId: source.wordId, taskId: item.production!.taskId,
    changes: [{ kind: 'replace', cueId: source.cueId, replacements: [{
      cueType: 'circumstance', text: 'Formally notify the responsible office of a changed itinerary so the details are on record.',
      acceptedWordIds: [source.wordId],
    }] }], sourceAttemptJudgments: [],
  };
  sqlite.prepare(`INSERT INTO study_sessions (id,started_at,ended_at,processing_state,processed_at)
    VALUES (?,?,?,'processed',?)`).run(sessionId, createdAt, createdAt, createdAt);
  return call(() => {
    const { artifact } = db.materializeReflectionArtifact({ sourceSessionId: sessionId,
      reflectionFlowVersion: 'initial_post_session_reflection.v4', generatedAt: createdAt,
      provider: 'openai', model: 'fake', promptVersion: 'reflection-staged-v1',
      evidenceBundle: { schemaVersion: 'session_reflection_bundle.v5', generatedAt: createdAt,
        session: { sessionId, startedAt: createdAt, endedAt: createdAt, studyProfile: 'mandarin' },
        items: [{ itemId: 'item', source: 'production_mistake', sourceActionKind: 'production',
          sessionActionId: item.sessionActionId, sourceAttemptId: 'attempt', occurredAt: createdAt,
          targetWord: { wordId: source.wordId, hanzi: source.content.word.hanzi, pinyin: source.content.word.pinyin, meanings: ['notify for the record'] },
          sessionNote: null, existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
          servedCue: { cueId: source.cueId, cueType: item.production!.cueType, text: item.production!.text, acceptedWordIds: [source.wordId], supplement: null },
          promotionEvidence: null, rawResponse: '通知', submittedWord: null, responseKind: 'unmatched_text',
        }],
      },
      result: { schemaVersion: 'session_reflection_result.v8', itemResults: [{
        itemId: 'item', diagnosisTags: ['ordinary_retrieval_noise'], learnerExplanation: 'Clarify the intended register.',
        proposals: [{ proposalGroupKey: null, rationale: 'Clarify the cue.', operation }], questions: [],
      }] },
    });
    const invocationId = `repair-${source.wordId}`;
    db.acceptReflectionProposal({ proposalId: artifact.proposals[0]!.review.proposalId, operation, invocationId, createdAt });
    return db.applyReflectionInvocation(invocationId, new Date().toISOString());
  });
}

test('learner-authorized review repair leaves pinned teaching unchanged and ready preparation cannot resurrect retired cue', () => {
  const source = prepare('repair');
  const before = call(() => db.getWordIntroductionLibrary(source.wordId));
  const applied = authorizeRepair(source);
  assert.equal(applied.application.state.kind, 'applied');
  assert.deepEqual(call(() => db.getWordIntroductionLibrary(source.wordId)), before);
  assert.notEqual(production(source.wordId).production?.cueId, source.cueId);
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 300_000).toISOString();
  assert.equal(call(() => review.claimWordReviewPreparation(source.wordId, source.content.id, 'retry', now, later)), 'ready');
  assert.notEqual(production(source.wordId).production?.cueId, source.cueId);
  assert.ok(call(() => review.getCanonicalReviewContent('production_cue', source.cueId)));
});

test('0012 to 0013 preserves lexical teaching documents and legacy cue projections without inventing lineage', () => {
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-content-upgrade-'));
  let upgrade: DatabaseSync | undefined;
  try {
    createBaselineFixture(migrationDir);
    upgrade = new DatabaseSync(path.join(migrationDir, 'app.db'));
    upgrade.function('current_learner_id', () => learner);
    upgrade.exec('PRAGMA foreign_keys=ON');
    const index = schemaMigrations.findIndex((migration) => migration.id === 'app_schema:0013_review_content_records');
    assert.ok(index > 0);
    const through0013 = schemaMigrations.slice(0, index + 1);
    migrateDatabase(upgrade, schemaMigrations.slice(0, index));
    upgrade.prepare(`INSERT INTO lexical_words
      (id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
      VALUES ('legacy-word','报备','報備','bàobèi','notify','["notify"]','[]',10,?)`).run(createdAt);
    const publication = upgrade.prepare(`INSERT INTO shared_content_publications
      (publication_id,content_kind,content_id,learning_purpose_key,publication_status,published_at,status_updated_at)
      VALUES (?,?,?,?,'available',?,?)`);
    publication.run('old-content-publication', 'word_content', 'old-content', 'legacy-word', createdAt, createdAt);
    publication.run('old-package-publication', 'teaching_package', 'old-package', 'legacy-word', createdAt, createdAt);
    publication.run('old-cue-publication', 'production_cue', 'old-cue', 'old-cue', createdAt, createdAt);
    const contentJson = JSON.stringify({ ...wordContentFixtures[0]!.content, id: 'old-content',
      word: { ...wordContentFixtures[0]!.content.word, wordId: 'legacy-word' } });
    const packageJson = JSON.stringify({ ...wordContentFixtures[0]!.teaching, id: 'old-package', wordContentId: 'old-content',
      rehearsals: wordContentFixtures[0]!.teaching.rehearsals.map((exercise) => ({
        ...exercise, contract: { kind: 'target_rehearsal', wordId: 'legacy-word' },
        acceptedAnswers: [{ wordId: 'legacy-word', hanzi: '报备', traditional: '報備' }],
        stimulus: exercise.stimulus.kind === 'example_cloze'
          ? { ...exercise.stimulus, example: { ...exercise.stimulus.example, contentId: 'old-content' } } : exercise.stimulus,
      })),
    });
    upgrade.prepare(`INSERT INTO word_content_documents
      (content_id,word_id,content_json,model,created_at,publication_id)
      VALUES ('old-content','legacy-word',?,'fake',?,'old-content-publication')`).run(contentJson, createdAt);
    upgrade.prepare(`INSERT INTO word_teaching_packages
      (package_id,word_id,content_id,package_json,model,created_at,publication_id)
      VALUES ('old-package','legacy-word','old-content',?,'fake',?,'old-package-publication')`).run(packageJson, createdAt);
    upgrade.prepare(`INSERT INTO scoped_production_cues
      (cue_id,task_id,cue_type,cue_text,created_at,origin_kind,origin_invocation_id,content_scope,owner_learner_id)
      VALUES ('old-cue','production-task:legacy-word:default_production','definition_gloss','A greeting',?,'manual',NULL,'shared',NULL)`)
      .run(createdAt);
    const before = ['word_content_documents', 'word_teaching_packages', 'scoped_production_cues', 'shared_content_publications']
      .map((table) => [table, upgrade!.prepare(`SELECT * FROM ${table}`).all()] as const);
    assert.deepEqual(migrateDatabase(upgrade, through0013), ['app_schema:0013_review_content_records']);
    assertSchemaCurrent(upgrade, through0013);
    assert.deepEqual(migrateDatabase(upgrade, through0013), []);
    for (const [table, rows] of before) assert.deepEqual(upgrade.prepare(`SELECT * FROM ${table}`).all(), rows);
    assert.equal((upgrade.prepare('SELECT COUNT(*) AS count FROM scoped_review_content_records').get() as { count: number }).count, 0);
    assert.deepEqual(upgrade.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    upgrade?.close();
    fs.rmSync(migrationDir, { recursive: true, force: true });
  }
});

test('canonical review keeps original answer forms after lexical edits and commits the original response', () => {
  const source = prepare('lexical-edit');
  const originalForms = [{
    wordId: source.wordId,
    hanzi: source.content.word.hanzi,
    traditional: source.content.word.traditional,
  }];
  sqlite.prepare('UPDATE lexical_words SET hanzi=?, traditional=? WHERE id=?')
    .run('登记', '登記', source.wordId);
  const item = production(source.wordId);
  assert.equal(item.word.hanzi, '登记');
  assert.equal(item.production?.cueId, source.cueId);
  assert.deepEqual(item.production!.acceptedAnswers, originalForms);
  const submittedText = source.content.word.traditional!;
  const resolution = resolveSessionProductionResponse({
    submittedText, anchorWordId: source.wordId, production: item.production, profileId: 'mandarin',
  });
  assert.equal(resolution.result, 'accepted_anchor');
  assert.equal(resolveSessionProductionResponse({
    submittedText: '登记', anchorWordId: source.wordId, production: item.production, profileId: 'mandarin',
  }).result, 'rejected');
  const sessionId = 'canonical-original-forms';
  const state = markActiveSessionUnitStarted(createBucketSessionState({
    sessionId, buckets: { review: [item], learning: [], unstudied: [] },
  }));
  const result = rateActiveSessionUnit(state, 'good', { response: submittedText, productionResponse: resolution });
  assert.equal(result.commit.type, 'commit-review-action-session');
  if (result.commit.type !== 'commit-review-action-session') throw new Error('Expected ordinary review commit');
  const { events, sessionId: committedSession, ...commitIntent } = result.commit;
  call(() => db.recordAcceptedReviewAttemptBatch({ sessionId: committedSession, events, commitIntent }));
  const saved = sqlite.prepare(`SELECT response, outcome, content_ref_json, metadata_json FROM learner_owned_study_attempt_events
    WHERE learner_id=? AND session_id=?`).get(learner, sessionId) as {
    response: string; outcome: string; content_ref_json: string; metadata_json: string;
  };
  assert.equal(saved.response, submittedText);
  assert.equal(saved.outcome, 'correct');
  assert.equal(JSON.parse(saved.content_ref_json).cueId, source.cueId);
  assert.equal(JSON.parse(saved.metadata_json).production.submittedWordId, source.wordId);
  const evidence = sqlite.prepare(`SELECT cue_id, attempt_result, submitted_word_id
    FROM learner_owned_production_cue_evidence_records WHERE learner_id=? AND source_attempt_id=?`).get(learner, events[0]!.id) as {
    cue_id: string; attempt_result: string; submitted_word_id: string;
  };
  assert.equal(evidence.cue_id, source.cueId);
  assert.equal(evidence.attempt_result, 'accepted_anchor');
  assert.equal(evidence.submitted_word_id, source.wordId);
});
