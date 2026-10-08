import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { ImprovementCase, ImprovementContent } from '../src/domain/content-improvement.ts';
let db: typeof import('../server/db.ts');
let api: typeof import('../server/db/content-improvements.ts');
let sql: DatabaseSync;
let dir: string;
const now = '2026-10-08T00:00:00.000Z';
before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'improvement-adapters-'));
    process.env.APP_MODE = 'study';
    process.env.APP_AUTH_MODE = 'clerk';
    process.env.APP_DATA_DIR = dir;
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'editor';
    db = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?adapters=${Date.now()}`);
    api = await import('../server/db/content-improvements.ts');
    db.bootstrapLearner({ learnerId: 'owner' });
    db.bootstrapLearner({ learnerId: 'other' });
    sql = new DatabaseSync(path.join(dir, 'app.db'));
    sql.function('current_learner_id', () => 'owner');
    sql.exec('PRAGMA foreign_keys=ON');
    for (const [id, hanzi] of [['a', '你好'], ['b', '您好']]) {
        sql.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES (?,?,NULL,'hello','hello','["hello"]','[]',10,?)`).run(id!, hanzi!, now);
    }
});
after(() => { sql?.close(); if (dir)
    fs.rmSync(dir, { recursive: true, force: true }); });
function publish(kind: string, id: string, purpose: string) {
    sql.prepare(`INSERT INTO shared_content_publications VALUES (?,?,?,?,'available',?,?)`).run(`pub-${id}`, kind, id, purpose, now, now);
}
function cue(id: string, shared: boolean) {
    sql.prepare(`INSERT INTO scoped_production_cues VALUES (?,'production-task:a:default_production','definition_gloss','hello',?,'manual',NULL,?,?)`).run(id, now, shared ? 'shared' : 'learner', shared ? null : 'owner');
    sql.prepare('INSERT INTO scoped_production_cue_accepted_words VALUES (?,\'a\',0)').run(id);
    if (shared)
        publish('production_cue', id, 'production-task:a:default_production');
    else {
        sql.prepare(`INSERT INTO learner_owned_production_cue_lifecycle_events(learner_id,event_id,cue_id,task_id,lifecycle_kind,occurred_at,invocation_id) VALUES ('owner',?,?,'production-task:a:default_production','activated',?,NULL)`).run(`e-${id}`, id, now);
        sql.prepare(`INSERT INTO learner_owned_production_cue_activation_state VALUES ('owner',?,1,?,?)`).run(id, `e-${id}`, now);
    }
}
function draft(kind: ImprovementCase['source']['kind'], sourceId: string, proposed: ImprovementContent) {
    const item = api.createImprovementCase({ kind, sourceId }, 'editor');
    return api.saveImprovementCase(item.id, { expectedRevision: item.revision, diagnosis: 'Context is too vague', rationale: 'A specific greeting makes the intended use clear', generalLesson: 'Prefer a concrete context', proposalOrigin: 'agent', proposed }, 'editor');
}
function apply(item: ImprovementCase) { return api.applyImprovementCase(item.id, { expectedRevision: item.revision, approve: true, acceptAnswerSpaceChange: true }, 'editor'); }
test('private cue replacement preserves scope, target, activation disposition and historical content', () => {
    cue('private', false);
    const saved = draft('production_cue', 'private', { cueText: 'A friendly greeting', acceptedWordIds: ['a'] });
    const result = apply(saved);
    const id = result.outcome!.replacementSourceId!;
    assert.deepEqual({ ...sql.prepare('SELECT content_scope,owner_learner_id,cue_text FROM scoped_production_cues WHERE cue_id=?').get(id) }, { content_scope: 'learner', owner_learner_id: 'owner', cue_text: 'A friendly greeting' });
    assert.equal(sql.prepare('SELECT cue_text FROM scoped_production_cues WHERE cue_id=\'private\'').get()!.cue_text, 'hello');
    assert.equal(sql.prepare('SELECT active FROM learner_owned_production_cue_activation_state WHERE learner_id=\'owner\' AND cue_id=?').get(id)!.active, 1);
    assert.equal(sql.prepare('SELECT count(*) n FROM shared_content_publications WHERE content_id=?').get(id)!.n, 0);
    assert.throws(() => apply(saved), /draft changed|resolved/);
    assert.equal(api.getImprovementHistory(saved.id, 'editor').length, 3);
    assert.equal(db.runWithLearnerId('owner', () => db.getProductionCue('private'))!.active, false);
    assert.equal(db.runWithLearnerId('owner', () => db.getProductionCue(id))!.active, true);
    assert.equal(db.runWithLearnerId('other', () => db.getProductionCue(id)), null);
    assert.throws(() => api.createImprovementCase({ kind: 'production_cue', sourceId: id }, 'other'), /Operator access/);
});
test('shared cue replacement retires original and preserves attached reveal content', () => {
    cue('shared', true);
    sql.prepare(`INSERT INTO scoped_production_cue_supplements VALUES ('shared-supp','production-task:a:default_production','shared','greeting','你好！','Hello!',?,NULL,'shared',NULL)`).run(now);
    publish('production_cue_supplement', 'shared-supp', 'production-task:a:default_production');
    const result = apply(draft('production_cue', 'shared', { cueText: 'Greet someone politely', acceptedWordIds: ['a'] }));
    const id = result.outcome!.replacementSourceId!;
    assert.equal(sql.prepare('SELECT publication_status FROM shared_content_publications WHERE content_id=\'shared\'').get()!.publication_status, 'retired');
    assert.equal(sql.prepare('SELECT example_sentence FROM scoped_production_cue_supplements WHERE cue_id=?').get(id)!.example_sentence, '你好！');
    assert.equal(db.runWithLearnerId('other', () => db.getActiveProductionCuesForWord('a')).some(c => c.cueId === id), true);
    const invalid = draft('production_cue', id, { cueText: 'Either greeting', acceptedWordIds: ['a', 'b'] });
    assert.match(api.validateImprovementCase(invalid.id, { expectedRevision: invalid.revision }, 'editor').errors.join(' '), /exactly their task target/);
});
test('supplement successor frees only its live attachment slot and keeps prior bytes', () => {
    cue('supp-parent', true);
    sql.prepare(`INSERT INTO scoped_production_cue_supplements VALUES ('editable-supp','production-task:a:default_production','supp-parent','greeting','你好！','Hello!',?,NULL,'shared',NULL)`).run(now);
    publish('production_cue_supplement', 'editable-supp', 'production-task:a:default_production');
    const result = apply(draft('supplement', 'editable-supp', { englishFrame: 'Say hello', exampleSentence: '你好，朋友！', exampleTranslation: 'Hello, friend!' }));
    assert.equal(sql.prepare(`SELECT example_sentence FROM scoped_production_cue_supplements WHERE supplement_id='editable-supp'`).get()!.example_sentence, '你好！');
    assert.equal(sql.prepare('SELECT example_sentence FROM scoped_production_cue_supplements WHERE supplement_id=?').get(result.outcome!.replacementSourceId!)!.example_sentence, '你好，朋友！');
    const current = db.runWithLearnerId('owner', () => db.getProductionCueSupplement('production-task:a:default_production', 'supp-parent'));
    const historical = db.runWithLearnerId('owner', () => db.getProductionCueSupplement('production-task:a:default_production', 'supp-parent', 'editable-supp'));
    assert.equal(current!.supplementId, result.outcome!.replacementSourceId);
    assert.equal(historical!.exampleSentence, '你好！');
    assert.throws(() => sql.prepare(`INSERT INTO scoped_production_cue_supplements VALUES ('duplicate','production-task:a:default_production','supp-parent','bad','你好','hello',?,NULL,'shared',NULL)`).run(now), /already has live/);
});
test('pure cue wording repair retains identity and served snapshot while attributing revision', () => {
    sql.prepare(`INSERT INTO pure_cues (id,stimulus,axis_note,teaching_note,created_at) VALUES ('pure','Say hello','greetings','Original note',?)`).run(now);
    for (const [position, id] of ['a', 'b'].entries())
        sql.prepare('INSERT INTO pure_cue_accepted_words VALUES (?,?,?)').run('pure', id, position);
    publish('pure_cue', 'pure', 'greetings');
    sql.prepare(`INSERT INTO learner_pure_cue_state VALUES ('owner','pure',24,2.5,NULL,?,NULL,0,?)`).run(now, now);
    const schedule = { ...sql.prepare(`SELECT * FROM learner_pure_cue_state WHERE pure_cue_id='pure'`).get() };
    const snapshot = db.runWithLearnerId('owner', () => db.issuePureCueServedSnapshot({ pureCueId: 'pure', servedAt: now }));
    const result = apply(draft('pure_cue', 'pure', { stimulus: 'Offer a greeting', teachingNote: 'Choose the level of politeness.' }));
    assert.equal(result.outcome!.replacementSourceId, 'pure');
    assert.deepEqual(db.runWithLearnerId('owner', () => db.getPureCueServedSnapshot(snapshot.snapshotId)), snapshot);
    assert.deepEqual({ ...sql.prepare(`SELECT * FROM learner_pure_cue_state WHERE pure_cue_id='pure'`).get() }, schedule);
    assert.equal(sql.prepare('SELECT stimulus FROM pure_cues WHERE id=\'pure\'').get()!.stimulus, 'Offer a greeting');
    assert.equal(sql.prepare('SELECT previous_stimulus FROM operator_pure_cue_repairs WHERE case_id=?').get(result.id)!.previous_stimulus, 'Say hello');
    assert.equal(sql.prepare('SELECT count(*) n FROM pure_cue_accepted_words WHERE pure_cue_id=\'pure\'').get()!.n, 2);
    assert.throws(() => sql.prepare(`UPDATE pure_cues SET stimulus='unauthorized' WHERE id='pure'`).run(), /authorized revision/);
});
test('contrast correction preserves cluster membership and rejects targets outside it', () => {
    sql.prepare(`INSERT INTO scoped_contrast_clusters VALUES ('cluster','Greetings','','learner','owner')`).run();
    for (const [i, id] of ['a', 'b'].entries())
        sql.prepare(`INSERT INTO scoped_contrast_cluster_members VALUES ('cluster',?,'',?)`).run(id, i);
    sql.prepare(`INSERT INTO scoped_contrast_prompts VALUES ('prompt','cluster','a','Hello','Greeting')`).run();
    const result = apply(draft('contrast_prompt', 'prompt', { promptText: 'Hello, friend', explanation: 'A friendly greeting', targetWordId: 'b' }));
    assert.equal(sql.prepare('SELECT cluster_id FROM scoped_contrast_prompts WHERE id=?').get(result.outcome!.replacementSourceId!)!.cluster_id, 'cluster');
    assert.equal(sql.prepare(`SELECT prompt_text FROM scoped_contrast_prompts WHERE id='prompt'`).get()!.prompt_text, 'Hello');
    const bad = draft('contrast_prompt', result.outcome!.replacementSourceId!, { promptText: 'Hello', explanation: 'Bad target', targetWordId: 'missing' });
    assert.match(api.validateImprovementCase(bad.id, { expectedRevision: bad.revision }, 'editor').errors.join(' '), /member/);
});
test('eligibility, no-op and dependency races cannot publish a replacement', () => {
    cue('unpublished', false);
    // Use a genuine shared cue with a missing publication, as can occur in old imports.
    sql.prepare(`INSERT INTO scoped_production_cues VALUES ('orphan','production-task:a:default_production','definition_gloss','hello',?,'manual',NULL,'shared',NULL)`).run(now);
    sql.prepare(`INSERT INTO scoped_production_cue_accepted_words VALUES ('orphan','a',0)`).run();
    const orphan = draft('production_cue', 'orphan', { cueText: 'A repaired greeting', acceptedWordIds: ['a'] });
    assert.match(api.validateImprovementCase(orphan.id, { expectedRevision: orphan.revision }, 'editor').errors.join(' '), /no eligible shared publication/);
    assert.throws(() => apply(orphan), /no eligible shared publication/);
    const unchanged = draft('production_cue', 'unpublished', { cueText: 'hello', acceptedWordIds: ['a'] });
    assert.match(api.validateImprovementCase(unchanged.id, { expectedRevision: unchanged.revision }, 'editor').errors.join(' '), /Change the content/);
    const changed = draft('production_cue', 'unpublished', { cueText: 'Hello, neighbor', acceptedWordIds: ['a'] });
    sql.prepare(`UPDATE lexical_words SET traditional='妳好' WHERE id='a'`).run();
    assert.equal(api.validateImprovementCase(changed.id, { expectedRevision: changed.revision }, 'editor').sourceChanged, true);
    assert.throws(() => apply(changed), /changed/);
    assert.equal(sql.prepare(`SELECT count(*) n FROM content_improvement_replacements WHERE source_id IN ('orphan','unpublished')`).get()!.n, 0);
    sql.prepare(`UPDATE lexical_words SET traditional=NULL WHERE id='a'`).run();
});
