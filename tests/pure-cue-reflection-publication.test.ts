import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';

const now = '2026-09-30T00:00:00.000Z';
let dataDir: string;
let sqlite: DatabaseSync;
let shared: typeof import('../server/db/shared-content.ts');
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-cue-publication-'));
  process.env.APP_MODE = 'study';
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_LEARNER_ID = 'publication-learner';
  await import('../server/db.ts');
  shared = await import('../server/db/shared-content.ts');
  sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  sqlite.function('current_learner_id', () => 'publication-learner');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const id of ['A', 'B', 'C']) {
    sqlite.prepare(`INSERT INTO lexical_words
      (id, hanzi, pinyin, meaning, meanings_json, examples_json, priority, created_at)
      VALUES (?, ?, '', 'meaning', '[]', '[]', 1, ?)`).run(id, id, now);
  }
});
after(() => { sqlite?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
function invocation(id: string, wordId = 'C'): void {
  const operation = {kind:'reconcile_pure_cue_response', version:1, responseWordId:'C',
    responseWordPlan:{wordId, deactivateCueIds:['retire-C','retire-A','retire-B'],
      distinctiveCueDrafts:[{cueType:'circumstance',text:'distinctive C context'}]}};
  sqlite.prepare(`INSERT INTO reflection_operation_invocations
    (invocation_id, created_at, origin_kind, operation_kind, operation_version, operation_json,
      application_state, application_updated_at, effect_refs_json, satisfying_effect_refs_json)
    VALUES (?, ?, 'manual', 'reconcile_pure_cue_response', 1, ?, 'pending', ?, '[]', '[]')`)
    .run(id, now, JSON.stringify({operation}), now);
}
function cue(id: string, wordId: string, invocationId: string, text = 'distinctive C context'): void {
  const taskId = `production-task:${wordId}:default_production`;
  sqlite.prepare(`INSERT INTO scoped_production_cues
    (cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id, content_scope, owner_learner_id)
    VALUES (?, ?, 'circumstance', ?, ?, 'reflection', ?, 'learner', 'publication-learner')`)
    .run(id,taskId,text,now,invocationId);
  sqlite.prepare(`INSERT INTO scoped_production_cue_accepted_words (cue_id, word_id, position) VALUES (?, ?, 0)`).run(id,wordId);
  sqlite.prepare(`INSERT INTO production_cue_lifecycle_events
    (event_id, cue_id, task_id, lifecycle_kind, occurred_at, invocation_id) VALUES (?, ?, ?, 'activated', ?, ?)`)
    .run(`event-${id}`, id, taskId, now, invocationId);
  sqlite.prepare(`INSERT INTO production_cue_activation_state
    (cue_id, active, latest_lifecycle_event_id, updated_at) VALUES (?, 1, ?, ?)`).run(id, `event-${id}`, now);
}
function publish(cueId: string, invocationId = 'publish') {
  return shared.publishAuthorizedProductionCueWithoutTransaction({cueId,invocationId,authorizedAt:now});
}
test('pure cue response authorization publishes only matching C drafts and retires only C cues', () => {
  invocation('publish');
  for (const id of ['A','B','C']) cue(`draft-${id}`,id,'publish');
  cue('not-in-plan','C','publish','unplanned text');
  assert.equal(publish('draft-C').publicationStatus,'shared_trial');
  assert.throws(() => publish('draft-A'), /does not authorize/);
  assert.throws(() => publish('draft-B'), /does not authorize/);
  assert.throws(() => publish('not-in-plan'), /does not authorize/);
  for (const id of ['A','B','C']) {
    cue(`retire-${id}`,id,'publish');
    sqlite.prepare(`INSERT INTO shared_content_publications VALUES (?, 'production_cue', ?, ?, 'shared_trial', ?, ?)`)
      .run(`pub-${id}`, `retire-${id}`, `production-task:${id}:default_production`, now, now);
  }
  const retire = (id: string) => shared.retireSharedProductionCuePublicationWithoutTransaction({cueId:`retire-${id}`,invocationId:'publish',retiredAt:now});
  assert.equal(retire('C').kind,'retired');
  assert.throws(() => retire('A'), /does not authorize retirement/);
  assert.throws(() => retire('B'), /does not authorize retirement/);
});
test('a C response cannot grant A ownership through an altered response plan', () => {
  invocation('forged','A'); cue('forged-A','A','forged');
  assert.throws(() => publish('forged-A','forged'), /does not authorize/);
});
