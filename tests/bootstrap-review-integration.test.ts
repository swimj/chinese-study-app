import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { normalizeReviewExercises } from '../server/word-content/review-authoring.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

type Db = typeof import('../server/db.ts');
type ReviewDb = typeof import('../server/db/review-content.ts');
type IntroductionDb = typeof import('../server/db/word-introductions.ts');
let db: Db;
let review: ReviewDb;
let introductions: IntroductionDb;
let sqlite: DatabaseSync;
let dir = '';
const learner = 'review-learner';
const createdAt = '2026-09-25T00:00:00.000Z';
const call = <T>(fn: () => T): T => db.runWithLearnerId(learner, fn);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-review-integration-'));
  const previous = { APP_MODE: process.env.APP_MODE, APP_AUTH_MODE: process.env.APP_AUTH_MODE, APP_DATA_DIR: process.env.APP_DATA_DIR };
  Object.assign(process.env, { APP_MODE: 'study', APP_AUTH_MODE: 'clerk', APP_DATA_DIR: dir });
  try {
    db = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?bootstrap-review=${Date.now()}`);
    review = await import('../server/db/review-content.ts');
    introductions = await import('../server/db/word-introductions.ts');
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

function prepare(suffix: string, retainTargetOccurrence = false) {
  const original = wordContentFixtures[0]!;
  const wordId = `word-${suffix}`;
  const content = { ...original.content, id: `content-${suffix}`, word: { ...original.content.word, wordId },
    examples: original.content.examples.map(example => retainTargetOccurrence && example.id === 'property'
      ? { ...example, text: `${example.text}上次也报备过。`, translation: `${example.translation} We reported it last time too.` }
      : example),
  };
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
    introductions.claimSharedWordIntroductionStage(wordId, 'bootstrap', `bootstrap-${suffix}`, current, expires);
    introductions.finishSharedWordIntroductionBootstrap(wordId, `bootstrap-${suffix}`, fixture.content, 'fake');
    introductions.claimSharedWordIntroductionStage(wordId, 'teaching', `teaching-${suffix}`, current, expires);
    introductions.finishSharedWordIntroductionTeaching(wordId, `teaching-${suffix}`, fixture.teaching, 'fake');
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

function publicationFor(contentKind: string, contentId: string) {
  return sqlite.prepare(`SELECT publication_id, publication_status FROM shared_content_publications
    WHERE content_kind = ? AND content_id = ?`).get(contentKind, contentId) as
    { publication_id: string; publication_status: string } | undefined;
}

/** Operator quarantine: the publication status transition and its audit event. */
function quarantine(publicationId: string) {
  const occurredAt = new Date().toISOString();
  sqlite.prepare(`INSERT INTO shared_content_publication_events
    (event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at)
    VALUES (?, ?, 'shared_trial', 'quarantined', 'operator', 'operator', 'Incorrect source', ?)`)
    .run(`quarantine-${publicationId}`, publicationId, occurredAt);
  sqlite.prepare(`UPDATE shared_content_publications SET publication_status = 'quarantined', status_updated_at = ?
    WHERE publication_id = ?`).run(occurredAt, publicationId);
}

test('published bootstrap review exercise keeps its exact canonical source', () => {
  const source = prepare('serve', true);
  const canonical = call(() => review.getCanonicalReviewContent('production_cue', source.cueId));
  assert.equal(canonical?.sourceWordContentId, source.content.id);
  assert.equal(canonical?.kind, 'production_cue');
  if (canonical?.kind !== 'production_cue') throw new Error('Missing source');
  assert.equal(canonical.exercise.contract.kind, 'targeted_review');
  assert.deepEqual(canonical.contents, [source.content]);
  assert.equal(publicationFor('production_cue', source.cueId)?.publication_status, 'shared_trial');
});

test('quarantining bootstrap source makes its review cue unavailable but preserves historical review identity', () => {
  const source = prepare('quarantine');
  quarantine(publicationFor('word_content', source.content.id)!.publication_id);
  const diagnostics = call(() => db.getContentDiagnostics({ kind: 'production_cue', query: source.cueId }));
  const cue = diagnostics.items.find(item => item.id === source.cueId);
  assert.ok(cue?.kind === 'production_cue');
  assert.equal(cue.availabilityStatus, 'source_unavailable');
  assert.equal(cue.active, false);
  const words = call(() => db.getContentDiagnostics({ kind: 'word', query: source.wordId }));
  const word = words.items.find(item => item.id === source.wordId);
  assert.ok(word?.kind === 'word');
  assert.equal(word.productionTask!.activeCueCount, 0);
  assert.ok(call(() => review.getCanonicalReviewContent('production_cue', source.cueId)));
});

test('0016 to 0017 preserves lexical teaching documents and legacy cue projections without inventing lineage', () => {
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-content-upgrade-'));
  let upgrade: DatabaseSync | undefined;
  try {
    createBaselineFixture(migrationDir);
    upgrade = new DatabaseSync(path.join(migrationDir, 'app.db'));
    upgrade.function('current_learner_id', () => learner);
    upgrade.exec('PRAGMA foreign_keys=ON');
    const index = schemaMigrations.findIndex((migration) => migration.id === 'app_schema:0017_review_content_records');
    assert.ok(index > 0);
    const throughReviewContent = schemaMigrations.slice(0, index + 1);
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
    assert.deepEqual(migrateDatabase(upgrade, throughReviewContent), ['app_schema:0017_review_content_records']);
    assertSchemaCurrent(upgrade, throughReviewContent);
    assert.deepEqual(migrateDatabase(upgrade, throughReviewContent), []);
    for (const [table, rows] of before) assert.deepEqual(upgrade.prepare(`SELECT * FROM ${table}`).all(), rows);
    assert.equal((upgrade.prepare('SELECT COUNT(*) AS count FROM scoped_review_content_records').get() as { count: number }).count, 0);
    assert.deepEqual(upgrade.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    upgrade?.close();
    fs.rmSync(migrationDir, { recursive: true, force: true });
  }
});

test('canonical review keeps original answer forms after lexical edits', () => {
  const source = prepare('lexical-edit');
  const originalForms = [{
    wordId: source.wordId,
    hanzi: source.content.word.hanzi,
    traditional: source.content.word.traditional,
  }];
  sqlite.prepare('UPDATE lexical_words SET hanzi=?, traditional=? WHERE id=?')
    .run('登记', '登記', source.wordId);
  const canonical = call(() => review.getCanonicalReviewContent('production_cue', source.cueId));
  if (canonical?.kind !== 'production_cue') throw new Error('Missing canonical review exercise');
  assert.deepEqual(canonical.exercise.acceptedAnswers, originalForms);
});
