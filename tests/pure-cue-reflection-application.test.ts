import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { normalizePureCueReflectionResult } from '../src/domain/pure-cue-reflection.ts';
import { PURE_CUE_REFLECTION_FLOW_VERSION, PURE_CUE_REFLECTION_PROMPT_VERSION } from '../src/domain/reflection-contracts.ts';
import type { PureCueAssessmentEvent } from '../src/domain/pure-cues.ts';
const now = '2026-09-18T00:00:00.000Z';
const appliedAt = '2026-09-18T01:00:00.000Z';
let dir: string;
let sqlite: DatabaseSync;
let db: typeof import('../server/db.ts');
let evidence: typeof import('../server/reflection/pure-cue-evidence.ts');
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-reflection-application-'));
  process.env.APP_MODE = 'study'; process.env.APP_DATA_DIR = dir; process.env.APP_LEARNER_ID = 'learner';
  db = await import('../server/db.ts');
  evidence = await import('../server/reflection/pure-cue-evidence.ts');
  sqlite = new DatabaseSync(path.join(dir, 'app.db'));
  sqlite.function('current_learner_id', () => 'learner'); sqlite.exec('PRAGMA foreign_keys=ON');
});
after(() => { sqlite?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
function sourceFixture(id: string) {
  const words = ['a', 'b', 'c'].map(suffix => `${id}-${suffix}`);
  for (const [index, wordId] of words.entries()) {
    const hanzi = `${['撒谎', '说谎', '骗人'][index]}${id}`;
    sqlite.prepare(`INSERT INTO lexical_words
      (id, hanzi, normalized_hanzi, pinyin, meaning, meanings_json, examples_json, priority, created_at)
      VALUES (?, ?, ?, 'pinyin', 'meaning', '[]', '[]', 1, ?)`).run(wordId, hanzi, hanzi, now);
    sqlite.prepare(`INSERT INTO scoped_production_cues
      (cue_id, task_id, cue_type, cue_text, created_at, origin_kind, content_scope, owner_learner_id)
      VALUES (?, ?, 'minimal_context', ?, ?, 'manual', 'shared', NULL)`)
      .run(`cue-${wordId}`, `production-task:${wordId}:default_production`, `specific ${wordId}`, now);
    sqlite.prepare('INSERT INTO scoped_production_cue_accepted_words VALUES (?, ?, 0)').run(`cue-${wordId}`, wordId);
    sqlite.prepare(`INSERT INTO shared_content_publications VALUES (?, 'production_cue', ?, ?, 'shared_trial', ?, ?)`)
      .run(`pub-${wordId}`, `cue-${wordId}`, `production-task:${wordId}:default_production`, now, now);
  }
  db.createPureCueWithoutTransaction({ id, stimulus: 'to tell an untruth', axisNote: '', acceptedWordIds: words.slice(0,2), createdAt: now });
  sqlite.prepare(`INSERT INTO shared_content_publications VALUES (?, 'pure_cue', ?, ?, 'shared_trial', ?, ?)`)
    .run(`pub-${id}`, id, `pure:${id}`, now, now);
  sqlite.prepare(`INSERT INTO learner_pure_cue_state VALUES ('learner', ?, 900, 2.65, ?, ?, ?, 7, ?)`)
    .run(id, now, now, now, now);
  sqlite.prepare(`INSERT INTO study_sessions (id, started_at, ended_at, processing_state, processed_at)
    VALUES (?, ?, ?, 'processed', ?)`).run(`session-${id}`, now, now, now);
  db.recordReviewSessionSummary({ sessionId: `session-${id}`, completedAt: now, completedReviewActionCount: 1,
    failedReviewActionCount: 1, activeDurationMs: 1000 });
  const snapshot = db.issuePureCueServedSnapshot({ pureCueId: id, servedAt: now });
  const events: PureCueAssessmentEvent[] = [0,1,2,3].map(index => ({ eventId: `${id}-${index}`,
    occurredAt: now, response: index ? `撒谎${id}` : `骗人${id}`,
    outcome: index ? 'accepted' : 'rejected', submittedWordId: index ? words[0]! : null, rating: index ? 'good' : 'forgot' }));
  db.recordPureCueAssessment({ attemptId: `attempt-${id}`, snapshotId: snapshot.snapshotId,
    sessionId: `session-${id}`, sessionActionId: id, events, committedAt: now });
  const bundle = evidence.buildPureCueReflectionBundle(`session-${id}`, now)!;
  assert.ok(bundle);
  return { words, bundle };
}
function fixture(id: string, drafts = false) {
  const { words, bundle } = sourceFixture(id);
  const result = normalizePureCueReflectionResult({ schemaVersion: 'pure_cue_reflection_result.v1', itemResults: [{
    submittedWord: bundle.items[0]!.submittedWord.hanzi, learnerExplanation: 'Your answer fits.', rationale: 'Same requested situation.',
    decision: 'extend', reason: null, extension: { teachingNote: 'All three fit; each has different usage.',
      responseWordPlan: { deactivateCueIds: [`cue-${words[2]}`], distinctiveCueDrafts: drafts
        ? [{ cueType: 'minimal_context', text: 'A specific context for C.' }] : [] } },
  }] }, bundle);
  const { artifact } = db.materializeReflectionArtifact({ sourceSessionId: `session-${id}`,
    reflectionFlowVersion: PURE_CUE_REFLECTION_FLOW_VERSION, generatedAt: now,
    provider: 'openai', model: 'gpt-5.6-luna', promptVersion: PURE_CUE_REFLECTION_PROMPT_VERSION, evidenceBundle: bundle, result });
  const proposal = artifact.proposals[0]!;
  return { words, bundle, proposal, authorize: () => db.acceptReflectionProposal({
    proposalId: proposal.review.proposalId, invocationId: `accept-${id}`, operation: proposal.proposal.operation, createdAt: appliedAt }) };
}

test('acceptance extends pure cue, intentionally proxies C, keeps A/B cues stable, restores schedule and replays once', () => {
  const f = fixture('extend');
  const before = f.words.slice(0,2).map(id => db.getProductionCue(`cue-${id}`));
  assert.equal(db.isWordProductionProxied(f.words[2]!), false);
  const authorized = f.authorize();
  const invocationId = authorized.invocation.invocation.invocationId;
  const state = db.applyReflectionInvocation(invocationId, appliedAt).application.state;
  assert.equal(state.kind, 'applied', JSON.stringify(state));
  assert.deepEqual(db.getPureCueContent('extend')?.acceptedWordIds, f.words);
  assert.equal(db.isWordProductionProxied(f.words[2]!), true);
  assert.deepEqual(f.words.slice(0,2).map(id => db.getProductionCue(`cue-${id}`)), before);
  assert.equal(db.getPureCue('extend')?.intervalHours, 900);
  assert.equal(db.getPureCue('extend')?.strongSuccesses, 7);
  const history = sqlite.prepare('SELECT * FROM pure_cue_attempts WHERE attempt_id = ?').get('attempt-extend');
  db.applyReflectionInvocation(invocationId, '2026-09-20T00:00:00.000Z');
  assert.deepEqual(sqlite.prepare('SELECT * FROM pure_cue_attempts WHERE attempt_id = ?').get('attempt-extend'), history);
  assert.throws(() => db.runWithLearnerId('other', f.authorize), /not found|unavailable/i);
});

test('C can retain targeted practice through a new distinctive cue without editing A/B', () => {
  const f = fixture('distinctive', true);
  const before = f.words.slice(0,2).map(id => db.getProductionCue(`cue-${id}`));
  const state = db.applyReflectionInvocation(f.authorize().invocation.invocation.invocationId, appliedAt).application.state;
  assert.equal(state.kind, 'applied', JSON.stringify(state));
  assert.equal(db.isWordProductionProxied(f.words[2]!), false);
  assert.deepEqual(db.getActiveProductionCuesForWord(f.words[2]!).map(cue => cue.text), ['A specific context for C.']);
  assert.deepEqual(f.words.slice(0,2).map(id => db.getProductionCue(`cue-${id}`)), before);
});

test('stale membership stops all C and scheduler changes before application', () => {
  const f = fixture('stale');
  const authorized = f.authorize();
  db.extendPureCueAcceptedWordsWithoutTransaction({ id: 'stale', acceptedWordIds: [f.words[2]!] });
  const before = db.getPureCue('stale');
  const state = db.applyReflectionInvocation(authorized.invocation.invocation.invocationId, appliedAt).application.state;
  assert.equal(state.kind, 'stale', JSON.stringify(state));
  assert.deepEqual(db.getPureCue('stale'), before);
  assert.equal(db.getProductionCue(`cue-${f.words[2]}`)?.active, true);
});

test('stale teaching text stops membership, C cue and scheduler changes', () => {
  const f = fixture('teaching');
  const authorized = f.authorize();
  sqlite.prepare('UPDATE pure_cues SET teaching_note = ? WHERE id = ?').run('Updated by another accepted reflection.', 'teaching');
  const before = db.getPureCue('teaching');
  const state = db.applyReflectionInvocation(authorized.invocation.invocation.invocationId, appliedAt).application.state;
  assert.equal(state.kind, 'stale', JSON.stringify(state));
  assert.deepEqual(db.getPureCue('teaching'), before);
  assert.equal(db.getProductionCue(`cue-${f.words[2]}`)?.active, true);
});

test('authorization rejects plans that retire A or B instead of C', () => {
  const f = fixture('protected');
  const operation = f.proposal.proposal.operation;
  assert.equal(operation.kind, 'reconcile_pure_cue_response');
  if (operation.kind !== 'reconcile_pure_cue_response') throw new Error('Unexpected operation');
  for (const word of f.words.slice(0,2)) {
    assert.throws(() => db.acceptReflectionProposal({ proposalId: f.proposal.review.proposalId,
      operation: { ...operation, responseWordPlan: { ...operation.responseWordPlan, deactivateCueIds: [`cue-${word}`] } },
      createdAt: appliedAt }), /active C cues/);
    assert.equal(db.getProductionCue(`cue-${word}`)?.active, true);
  }
});

test('real failed provider run retains exact evidence and retry materializes the inbox artifact once', async () => {
  const { createInitialReflectionGenerationService } = await import('../server/reflection/generation.ts');
  const { ReflectionEvidenceError } = await import('../server/reflection/evidence.ts');
  const { bundle } = sourceFixture('retry');
  let fail = true;
  let requests = 0;
  let builds = 0;
  const provider: import('../server/reflection/luna-provider.ts').LunaReflectionProvider = {
    async generate() { throw new Error('Unexpected ordinary generation'); },
    async generatePureCueReflection(input) {
      requests += 1;
      assert.deepEqual(input, bundle);
      if (fail) throw new Error('Temporary pure cue provider failure');
      return {
        result: { schemaVersion: 'pure_cue_reflection_result.v1', itemResults: [{
          submittedWord: input.items[0]!.submittedWord.hanzi, learnerExplanation: 'C also fits this cue.', rationale: 'C is valid.',
          decision: 'extend', reason: null, extension: { teachingNote: 'A, B and C all fit.',
            responseWordPlan: { deactivateCueIds: [], distinctiveCueDrafts: [] } },
        }] },
        metadata: { provider: 'openai', modelConfig: 'gpt-5.6-luna-high', providerModel: 'gpt-5.6-luna',
          promptVersion: PURE_CUE_REFLECTION_PROMPT_VERSION, responseId: 'retry-response', finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: null,
            cacheWriteInputTokens: null, reasoningTokens: null } },
      };
    },
  };
  const service = createInitialReflectionGenerationService({ provider, now: () => now,
    buildBundle: () => { throw new ReflectionEvidenceError('no_qualifying_evidence', 'No ordinary evidence'); },
    buildPureCueBundle: () => { builds += 1; return bundle; },
  });
  await assert.rejects(service.generate(bundle.session.sessionId, {}), /Temporary pure cue provider failure/);
  const failed = db.listReflectionGenerationRuns().find(run => run.sourceSessionId === bundle.session.sessionId)!;
  assert.ok(failed);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.retryable, true);
  assert.deepEqual(db.getPureCueReflectionRetrySource(failed.runId)?.bundle, bundle);
  const stored = sqlite.prepare('SELECT evidence_bundle_json FROM reflection_generation_runs WHERE run_id = ?')
    .get(failed.runId) as { evidence_bundle_json: string };
  assert.deepEqual(JSON.parse(stored.evidence_bundle_json), bundle);
  assert.equal(db.runWithLearnerId('other', () => db.getPureCueReflectionRetrySource(failed.runId)), null);
  fail = false;
  const retried = await service.retry(failed.runId);
  assert.equal(retried.status, 'created');
  assert.equal(retried.proposalCount, 1);
  const detail = db.getReflectionArtifactDetail(retried.artifactId);
  assert.deepEqual(detail.evidenceBundle, bundle);
  assert.equal(detail.proposals.length, 1);
  assert.equal(detail.proposals[0]!.review.disposition.kind, 'pending');
  const runs = db.listReflectionGenerationRuns().filter(run => run.sourceSessionId === bundle.session.sessionId);
  assert.equal(runs.length, 2);
  assert.equal(runs.find(run => run.runId === failed.runId)?.retryable, false);
  assert.equal(runs.filter(run => run.state === 'succeeded').length, 1);
  assert.throws(() => db.getPureCueReflectionRetrySource(failed.runId), /already has a successful artifact/);
  await assert.rejects(service.retry(failed.runId), /already has a successful artifact/);
  assert.equal(requests, 2);
  assert.equal(builds, 1, 'retry must use the saved provider input without rebuilding evidence');
});
