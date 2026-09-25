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
function sourceFixture(id: string, axisNote = '') {
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
  db.createPureCueWithoutTransaction({ id, stimulus: 'to tell an untruth', axisNote, acceptedWordIds: words.slice(0,2), createdAt: now });
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
  const result = normalizePureCueReflectionResult({ schemaVersion: 'pure_cue_reflection_result.v2', itemResults: [{
    submittedWord: bundle.items[0]!.submittedWord.hanzi, learnerExplanation: 'Your answer fits.', rationale: 'Same requested situation.',
    decision: 'extend', reason: null, repair: null, extension: { teachingNote: 'All three fit; each has different usage.',
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

test('accepted stimulus repair preserves identity, axis and members, audits the revision, and restores the unfair lapse', () => {
  const { words, bundle } = sourceFixture('stimulusrepair', 'telling an untruth');
  const originalCanonical = db.getCanonicalReviewContent('pure_cue', 'stimulusrepair');
  assert.equal(originalCanonical?.kind, 'pure_cue');
  if (originalCanonical?.kind !== 'pure_cue') throw new Error('Missing original canonical pure cue');
  assert.equal(originalCanonical.revision, 1);
  assert.deepEqual(originalCanonical.exercise.stimulus, { kind: 'direct_text', text: 'to tell an untruth' });
  const originalSnapshot = db.getPureCueServedSnapshot(bundle.items[0]!.servedSnapshot.snapshotId);
  assert.deepEqual(originalSnapshot, bundle.items[0]!.servedSnapshot);
  const repaired = 'Tell an untruth: to tell an untruth';
  const result = normalizePureCueReflectionResult({ schemaVersion: 'pure_cue_reflection_result.v2', itemResults: [{
    submittedWord: bundle.items[0]!.submittedWord.hanzi,
    learnerExplanation: 'Your answer fit the wording shown, which omitted the intended axis.',
    rationale: 'Clarify the same axis in the visible stimulus.',
    decision: 'repair', reason: null, extension: null, repair: { stimulus: repaired },
  }] }, bundle);
  const { artifact } = db.materializeReflectionArtifact({ sourceSessionId: 'session-stimulusrepair',
    reflectionFlowVersion: PURE_CUE_REFLECTION_FLOW_VERSION, generatedAt: now,
    provider: 'openai', model: 'gpt-5.6-luna', promptVersion: PURE_CUE_REFLECTION_PROMPT_VERSION,
    evidenceBundle: bundle, result });
  const proposal = artifact.proposals[0]!;
  const oldExtension = normalizePureCueReflectionResult({ schemaVersion: 'pure_cue_reflection_result.v2', itemResults: [{
    submittedWord: bundle.items[0]!.submittedWord.hanzi,
    learnerExplanation: 'C fits the old wording.', rationale: 'Add C.',
    decision: 'extend', reason: null, repair: null,
    extension: { teachingNote: 'All three fit.', responseWordPlan: { deactivateCueIds: [], distinctiveCueDrafts: [] } },
  }] }, bundle);
  const extensionArtifact = db.materializeReflectionArtifact({ sourceSessionId: 'session-stimulusrepair',
    reflectionFlowVersion: PURE_CUE_REFLECTION_FLOW_VERSION, generatedAt: now,
    provider: 'openai', model: 'gpt-5.6-luna', promptVersion: PURE_CUE_REFLECTION_PROMPT_VERSION,
    evidenceBundle: bundle, result: oldExtension }).artifact;
  const oldAuthorized = db.acceptReflectionProposal({ proposalId: extensionArtifact.proposals[0]!.review.proposalId,
    invocationId: 'old-stimulus-extension', operation: extensionArtifact.proposals[0]!.proposal.operation, createdAt: appliedAt });
  const authorized = db.acceptReflectionProposal({ proposalId: proposal.review.proposalId,
    invocationId: 'accept-stimulusrepair', operation: proposal.proposal.operation, createdAt: appliedAt });
  assert.equal(db.applyReflectionInvocation(authorized.invocation.invocation.invocationId, appliedAt).application.state.kind, 'applied');
  const content = db.getPureCueContent('stimulusrepair')!;
  assert.equal(content.stimulus, repaired);
  assert.equal(content.axisNote, bundle.items[0]!.currentCue.axisNote);
  assert.deepEqual(content.acceptedWordIds, words.slice(0, 2));
  assert.equal(db.getPureCue('stimulusrepair')?.intervalHours, 900);
  const revision = sqlite.prepare('SELECT previous_stimulus, stimulus FROM pure_cue_stimulus_revisions WHERE invocation_id = ?')
    .get('accept-stimulusrepair') as { previous_stimulus: string; stimulus: string };
  assert.equal(revision.previous_stimulus, 'to tell an untruth');
  assert.equal(revision.stimulus, repaired);
  const repairedCanonical = db.getCanonicalReviewContent('pure_cue', 'stimulusrepair');
  assert.equal(repairedCanonical?.kind, 'pure_cue');
  if (repairedCanonical?.kind !== 'pure_cue') throw new Error('Missing repaired canonical pure cue');
  assert.equal(repairedCanonical.revision, 2);
  assert.notEqual(repairedCanonical.exercise.id, originalCanonical.exercise.id);
  assert.deepEqual(repairedCanonical.exercise.stimulus, { kind: 'direct_text', text: repaired });
  assert.deepEqual(repairedCanonical.exercise.contract, originalCanonical.exercise.contract);
  assert.deepEqual(repairedCanonical.exercise.acceptedAnswers, originalCanonical.exercise.acceptedAnswers);
  const originalRow = sqlite.prepare(`SELECT document_json FROM scoped_review_content_records
    WHERE kind = 'pure_cue' AND content_id = ? AND revision = 1`).get('stimulusrepair') as { document_json: string };
  assert.deepEqual(JSON.parse(originalRow.document_json).exercise, originalCanonical.exercise);
  assert.deepEqual(db.getPureCueServedSnapshot(originalSnapshot!.snapshotId), originalSnapshot);
  assert.equal(bundle.items[0]!.servedSnapshot.stimulus, 'to tell an untruth');
  assert.equal(evidence.buildPureCueReflectionBundle('session-stimulusrepair', appliedAt), null);
  assert.equal(db.applyReflectionInvocation(oldAuthorized.invocation.invocation.invocationId, appliedAt).application.state.kind, 'stale');
  assert.deepEqual(db.getPureCueContent('stimulusrepair')?.acceptedWordIds, words.slice(0, 2));
  assert.deepEqual(db.getCanonicalReviewContent('pure_cue', 'stimulusrepair'), repairedCanonical);
  assert.throws(() => sqlite.prepare('UPDATE pure_cues SET stimulus = ? WHERE id = ?')
    .run('Unauthorized', 'stimulusrepair'), /authorized revision/);
  assert.equal(db.applyReflectionInvocation('accept-stimulusrepair', appliedAt).application.state.kind, 'applied');
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM pure_cue_stimulus_revisions WHERE pure_cue_id = ?')
    .get('stimulusrepair') as { count: number }).count, 1);
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS count FROM scoped_review_content_records
    WHERE kind = 'pure_cue' AND content_id = ?`).get('stimulusrepair') as { count: number }).count, 2);
  assert.deepEqual(db.getCanonicalReviewContent('pure_cue', 'stimulusrepair'), repairedCanonical);
});

test('legacy empty-axis stimulus repair retains its historical compatibility path', () => {
  const { bundle } = sourceFixture('legacystimulusrepair');
  assert.equal(db.getCanonicalReviewContent('pure_cue', 'legacystimulusrepair'), null);
  const result = normalizePureCueReflectionResult({ schemaVersion: 'pure_cue_reflection_result.v2', itemResults: [{
    submittedWord: bundle.items[0]!.submittedWord.hanzi,
    learnerExplanation: 'The old wording admitted this answer.', rationale: 'Clarify the displayed stimulus.',
    decision: 'repair', reason: null, extension: null, repair: { stimulus: 'A more specific way to tell an untruth' },
  }] }, bundle);
  const { artifact } = db.materializeReflectionArtifact({ sourceSessionId: 'session-legacystimulusrepair',
    reflectionFlowVersion: PURE_CUE_REFLECTION_FLOW_VERSION, generatedAt: now,
    provider: 'openai', model: 'gpt-5.6-luna', promptVersion: PURE_CUE_REFLECTION_PROMPT_VERSION,
    evidenceBundle: bundle, result });
  const proposal = artifact.proposals[0]!;
  const authorized = db.acceptReflectionProposal({ proposalId: proposal.review.proposalId,
    invocationId: 'accept-legacystimulusrepair', operation: proposal.proposal.operation, createdAt: appliedAt });
  assert.equal(db.applyReflectionInvocation(authorized.invocation.invocation.invocationId, appliedAt).application.state.kind, 'applied');
  assert.equal(db.getPureCueContent('legacystimulusrepair')?.stimulus, 'A more specific way to tell an untruth');
  assert.equal(db.getCanonicalReviewContent('pure_cue', 'legacystimulusrepair'), null);
  assert.equal(db.getPureCueServedSnapshot(bundle.items[0]!.servedSnapshot.snapshotId)?.stimulus, 'to tell an untruth');
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
        result: { schemaVersion: 'pure_cue_reflection_result.v2', itemResults: [{
          submittedWord: input.items[0]!.submittedWord.hanzi, learnerExplanation: 'C also fits this cue.', rationale: 'C is valid.',
          decision: 'extend', reason: null, repair: null, extension: { teachingNote: 'A, B and C all fit.',
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
