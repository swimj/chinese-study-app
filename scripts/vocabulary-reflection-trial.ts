/** Isolated experiment. Never initializes the application database or imports hosted data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { registerVocabularyStudyRoutes } from '../server/vocabulary/study-routes.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularySenseProvider, ensureVocabularySenses, VOCABULARY_SENSE_MODEL } from '../server/vocabulary/sense-readiness.ts';
import { createOpenAiCompatibleAdapter } from '../server/llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../server/llm/proxy-fetch.ts';
import { LUNA_REFLECTION_MODEL_CHOICE } from '../server/reflection/model-arms.ts';
import { LUNA_REFLECTION_MODEL_CONFIG } from '../server/reflection/luna-provider.ts';
import type { ProviderAdapter } from '../server/llm/types.ts';
import { createVocabularyContent, createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog, getVocabularySenses } from '../server/db/vocabulary-content.ts';
import { createVocabularySession, appendVocabularySessionActions } from '../server/db/vocabulary-sessions.ts';
import { createVocabularyProcessingWorker } from '../server/vocabulary/processing-worker.ts';
import { createVocabularyReflectionProvider, projectVocabularyReflectionInput } from '../server/vocabulary/reflection-provider.ts';
import { installModelInvocationLedger } from '../server/llm/invocation-ledger.ts';
import type { VocabularyJson } from '../src/domain/vocabulary-content.ts';
import type { VocabularySessionAction, VocabularyEncounterSnapshot } from '../src/domain/vocabulary-session.ts';

type Word = { id: string; hanzi: string; pinyin: string; meaning: string; traditional?: string | null;
  senses?: { senseId?: string; label: string; notes?: string[] }[]; sensesProvenance?: VocabularyJson };
type Exercise = { contentId: string; prompt: string; acceptedAnswers: string[]; role?: 'general' | 'teaching';
  kind?: 'production' | 'recognition'; exerciseType?: string; schedulingScope?: 'word' | 'pure_cue';
  body?: VocabularyJson; assessment?: VocabularyJson; answers?: { wordId: string; acceptedForms: string[] }[] };
type CaseAction = { kind: 'present'; contentId: string; encounterId: string; wordId?: string | null; transitionId?: string }
  | { kind: 'response'; encounterId: string; response: string | null; outcome: 'accepted' | 'rejected'; selfAssessment?: 'accepted' | 'rejected' }
  | { kind: 'feedback'; encounterId: string; feedback: 'positive' | 'negative' | 'comment' | 'withdrawn'; comment?: string }
  | { kind: 'exercise_skip'; encounterId: string; transitionId?: string }
  | { kind: 'word_wrap'; wordId?: string; reason: 'enough' | 'policy' }
  | { kind: 'word_skip'; wordId?: string }
  | { kind: 'undo'; actionIndex: number };
type TrialCase = { id: string; title?: string; word: Word; words?: Word[]; mode?: 'practice' | 'unstudied';
  scope?: 'word' | 'pure_cue'; exercises: Exercise[]; actions: CaseAction[];
  expected: { feedbackJobs: number; improvementJobs: number; teachingCases: number }; sourceSnapshot?: unknown; expectedCoverage?: boolean };
type Cases = { version: 1; cases: TrialCase[] };
type Manifest = { format: 'vocabulary-reflection-trial.v1'; casesSha256: string; preparedAt: string; model: string;
  modelChoice?: string; senseModel?: string; sourceRevision: string; sources: Record<string, string>; routing: unknown };
const args = process.argv.slice(2);
const mode = args[0];
function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? (index >= 0 ? args[index + 1] : undefined);
}
assert(mode === 'prepare' || mode === 'run' || mode === 'inspect', 'Usage: prepare --archive NEW_DIR --cases FILE | run --archive DIR --allow-provider-calls | inspect --archive DIR');
const archiveArg = flag('--archive');
assert(archiveArg && path.isAbsolute(archiveArg), '--archive must be an absolute dedicated directory');
const archive = path.resolve(archiveArg);
const dbFile = path.join(archive, 'trial.sqlite');
const root = path.resolve(import.meta.dirname, '..');
const operator = 'reflection-trial-operator';
Object.assign(process.env, { APP_AUTH_MODE: 'clerk', APP_MODE: 'study', APP_DATA_DIR: archive, APP_OPERATOR_CLERK_USER_IDS: operator });
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (file: string) => fs.readFileSync(file, 'utf8');
function write(name: string, value: unknown): void { fs.writeFileSync(path.join(archive, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
function log(value: unknown): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...value as Record<string, unknown> });
  fs.appendFileSync(path.join(archive, 'progress.jsonl'), `${line}\n`, { mode: 0o600 });
  process.stdout.write(`${line}\n`);
}
function errorSummary(error: unknown): { name: string; message: string } {
  let message = error instanceof Error ? error.message : String(error);
  for (const [key, value] of Object.entries(process.env)) if (value && /KEY|TOKEN|SECRET|PASSWORD/i.test(key)) message = message.replaceAll(value, '[redacted]');
  return { name: error instanceof Error ? error.name : 'Error', message: message.slice(0, 8000) };
}
function loadCases(file: string): Cases {
  const value = JSON.parse(read(file)) as Cases;
  assert.equal(value.version, 1); assert(Array.isArray(value.cases) && value.cases.length > 0);
  assert.equal(new Set(value.cases.map(item => item.id)).size, value.cases.length, 'Case ids must be unique');
  const contents = new Set<string>();
  for (const item of value.cases) {
    assert(/^[\w-]+$/.test(item.id), 'Case id must be filesystem safe');
    assert(item.word?.id && item.word.hanzi && Array.isArray(item.exercises) && Array.isArray(item.actions));
    for (const exercise of item.exercises) {
      assert(exercise.contentId && exercise.prompt && (exercise.answers?.length || exercise.acceptedAnswers?.length));
      assert(!contents.has(exercise.contentId), 'Exercise content ids must be globally unique'); contents.add(exercise.contentId);
    }
    for (const count of Object.values(item.expected)) assert(Number.isSafeInteger(count) && count >= 0);
  }
  return value;
}
function sourceFiles(): string[] {
  // Follow local imports so admission/promotion helpers and invocation dependencies
  // cannot drift between preparation and execution. Include dynamically read prompts.
  const files = new Set<string>(['scripts/vocabulary-reflection-trial.ts', ...migrations.map(name => `server/db/migrations/${name}`)]);
  const visit = (file: string): void => {
    if (files.has(file) && file !== 'scripts/vocabulary-reflection-trial.ts') return;
    files.add(file);
    const source = read(path.join(root, file));
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]!));
      const resolved = relative.replace(/\.js$/, '.ts');
      if (fs.existsSync(path.join(root, resolved))) visit(resolved);
    }
  };
  visit('scripts/vocabulary-reflection-trial.ts');
  for (const directory of ['server/vocabulary/reflection-prompts','server/reflection/prompts']) {
    if (fs.existsSync(path.join(root, directory))) {
      for (const name of fs.readdirSync(path.join(root, directory))) if (name.endsWith('.md')) files.add(`${directory}/${name}`);
    }
  }
  return [...files].sort();
}
const migrations = ['0039_vocabulary_content.sql', '0025_model_invocations.sql', '0026_model_invocation_outcomes.sql',
  '0040_model_provenance.sql', '0041_vocabulary_learner_state.sql', '0047_vocabulary_dismissal.sql','0052_vocabulary_automatic_promotion_pause.sql',
  '0042_vocabulary_sessions.sql', '0043_vocabulary_import.sql', '0044_vocabulary_reflection.sql', '0045_vocabulary_provenance_links.sql',
  '0046_vocabulary_pure_cue_guards.sql', '0023_session_debrief.sql', '0048_vocabulary_connections.sql',
  '0049_vocabulary_sense_readiness.sql', '0050_vocabulary_improvement_admission.sql', '0051_vocabulary_pure_cue_promotion.sql', '0053_vocabulary_second_opinions.sql', '0054_vocabulary_provider_retry_routing.sql'];
function initialize(sql: DatabaseSync): void {
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY,disabled_at TEXT,display_name TEXT);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT);
    CREATE TABLE word_preparation_work(id TEXT);
    CREATE TABLE lexical_word_meanings(id TEXT PRIMARY KEY,word_id TEXT,text TEXT,position INTEGER);
    CREATE TABLE word_introduction_preparation(word_id TEXT PRIMARY KEY,content_id TEXT,package_id TEXT,active_stage TEXT,lease_token TEXT,lease_expires_at TEXT);
    CREATE TABLE word_content_documents(content_id TEXT PRIMARY KEY,word_id TEXT,content_json TEXT,publication_id TEXT);
    CREATE TABLE shared_content_publications(publication_id TEXT PRIMARY KEY,publication_status TEXT);
    CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));
    CREATE TABLE reflection_generation_runs(completed_at TEXT,estimated_cost_usd REAL);`);
  for (const name of migrations) {
    const source = read(path.join(root, 'server/db/migrations', name));
    sql.exec(name === '0041_vocabulary_learner_state.sql' ? source.split('-- Do not use the words view')[0]! : source);
  }
}
function seedCase(sql: DatabaseSync, item: TrialCase, at: string): number {
  const learnerId = `trial-${item.id}`, sessionId = `session-${item.id}`;
  sql.prepare('INSERT INTO learners VALUES (?,NULL,?)').run(learnerId, item.title ?? item.id);
  for (const word of new Map([item.word, ...(item.words ?? [])].map(word => [word.id, word])).values()) {
    const existing = sql.prepare('SELECT * FROM lexical_words WHERE id=?').get(word.id);
    if (existing) assert.deepEqual({ ...existing }, { id: word.id, hanzi: word.hanzi, traditional: word.traditional ?? null, pinyin: word.pinyin, meaning: word.meaning });
    else sql.prepare('INSERT INTO lexical_words VALUES (?,?,?,?,?)').run(word.id, word.hanzi, word.traditional ?? null, word.pinyin, word.meaning);
    if (word.senses !== undefined) {
      assert(word.senses.length > 0 && word.sensesProvenance !== undefined, 'Supplied sense inventories require provenance');
      const actor = { kind: 'operator' as const, id: operator, reason: { fixture: item.id, provenance: word.sensesProvenance } };
      if (getVocabularySenseCatalog(word.id).version === 0) {
        for (const [index, sense] of word.senses.entries()) {
          assert(sense.label.trim() && (sense.notes ?? []).every(note => note.trim()), 'Invalid supplied sense');
          createVocabularySense({ senseId: sense.senseId ?? `trial-${word.id}-sense-${index + 1}`, wordId: word.id,
            description: { label: sense.label, notes: sense.notes ?? [], source: { kind: 'trial_fixture', provenance: word.sensesProvenance } } }, actor);
        }
        establishVocabularySenseCatalog(word.id, getVocabularySenseCatalog(word.id).version, actor);
      } else {
        assert(getVocabularySenseCatalog(word.id).establishedAt, 'Fixture inventory conflicts with partial catalog');
        assert.deepEqual(getVocabularySenses(word.id).map(sense => sense.description), word.senses.map(sense => ({
          label: sense.label, notes: sense.notes ?? [], source: { kind: 'trial_fixture', provenance: word.sensesProvenance },
        })), 'Conflicting supplied sense inventory for repeated word');
      }
    }
  }
  sql.prepare(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES (?,?,1,?,?,?)`).run(learnerId, item.word.id, at, item.mode ?? 'practice', at);
  sql.prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json) VALUES (?,?,?,'trial',?)`)
    .run(learnerId, item.word.id, at, JSON.stringify({ intervalHours: 24, easeFactor: 2.5, enabled: 1, cleanCoveredSessions: 0 }));
  const snapshots = new Map<string, VocabularyEncounterSnapshot>();
  for (const exercise of item.exercises) {
    const pure = item.scope === 'pure_cue' || exercise.schedulingScope === 'pure_cue' || exercise.exerciseType === 'pure_cue';
    const answers = exercise.answers ?? [{ wordId: item.word.id, acceptedForms: exercise.acceptedAnswers }];
    const body = exercise.body ?? { prompt: exercise.prompt }, assessment = exercise.assessment ?? { match: 'exact' };
    createVocabularyContent({ contentId: exercise.contentId, kind: 'exercise', payloadVersion: 1, body,
      exerciseType: pure ? 'pure_cue' : exercise.exerciseType ?? 'definition', skill: exercise.kind ?? 'production',
      exerciseRole: exercise.role ?? 'general', assessment, accessScope: 'shared', availability: 'active', originKind: 'human',
      words: answers.map(answer => ({ wordId: answer.wordId, relation: 'target' })), answers }, { kind: 'operator', id: operator });
    snapshots.set(exercise.contentId, { contentId: exercise.contentId, contentVersion: 1, kind: exercise.kind ?? 'production', role: exercise.role ?? 'general',
      body: { prompt: exercise.prompt, material: body }, assessment: { acceptedAnswers: answers.flatMap(answer => answer.acceptedForms), criteria: assessment },
      ...(pure ? { schedulingScope: 'pure_cue' as const } : {}) });
    if (pure) sql.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,policy_version,scheduler_state_json) VALUES (?,?,?,'trial',?)`)
      .run(learnerId, exercise.contentId, at, JSON.stringify({ intervalHours: 24, easeFactor: 2.5, enabled: 1 }));
  }
  return runWithLearnerId(learnerId, () => {
    createVocabularySession({ sessionId, words: item.scope === 'pure_cue' ? [] : [{ wordId: item.word.id, mode: item.mode ?? 'practice' }] }, at);
    const actions: VocabularySessionAction[] = item.actions.map((input, index) => {
      const common = { protocolVersion: 1 as const, actionId: `${item.id}-a-${index}`, clientActionId: `${item.id}-c-${index}`, sequence: index + 1, occurredAt: at,
        ...('transitionId' in input && input.transitionId ? { transitionId: input.transitionId } : {}) };
      if (input.kind === 'present') {
        const snapshot = snapshots.get(input.contentId); assert(snapshot, `Unknown content ${input.contentId}`);
        return { ...common, kind: 'presentation', payload: { encounterId: `${item.id}-${input.encounterId}`,
          wordId: input.wordId === undefined ? snapshot.schedulingScope === 'pure_cue' ? null : item.word.id : input.wordId, snapshot } };
      }
      if (input.kind === 'undo') return { ...common, kind: 'undo', payload: { undoesActionId: `${item.id}-a-${input.actionIndex}` } };
      if (input.kind === 'word_wrap') return { ...common, kind: input.kind, payload: { wordId: input.wordId ?? item.word.id, reason: input.reason } };
      if (input.kind === 'word_skip') return { ...common, kind: input.kind, payload: { wordId: input.wordId ?? item.word.id } };
      const { kind, encounterId, ...rest } = input;
      return { ...common, kind, payload: { ...rest, encounterId: `${item.id}-${encounterId}` } } as VocabularySessionAction;
    });
    let persisted = appendVocabularySessionActions(sessionId, actions, at);
    for (const kind of ['finish_for_now', 'finish_immediately'] as const) {
      if (persisted.projection.phase === 'completed') break;
      const index = actions.length;
      const action = { kind, payload: {}, protocolVersion: 1 as const, actionId: `${item.id}-a-${index}`, clientActionId: `${item.id}-c-${index}`, sequence: index + 1, occurredAt: at };
      actions.push(action); persisted = appendVocabularySessionActions(sessionId, [action], at);
    }
    return actions.length;
  });
}
function routing(sql: DatabaseSync, cases: Cases): unknown[] {
  return cases.cases.map(item => {
    const learnerId = `trial-${item.id}`;
    const count = (kind: string) => Number(sql.prepare('SELECT count(*) AS n FROM reflection_cases WHERE learner_id=? AND kind=?').get(learnerId, kind)!.n);
    const actual = { feedbackJobs: count('learner_feedback'), improvementJobs: count('exercise_improvement'), teachingCases: count('teaching_review') };
    assert.deepEqual(actual, item.expected, `Routing mismatch for ${item.id}`);
    assert.equal(sql.prepare('SELECT status FROM vocabulary_sessions WHERE learner_id=?').get(learnerId)!.status, 'closed');
    assert.equal(sql.prepare('SELECT status FROM vocabulary_post_session_dispatches WHERE learner_id=?').get(learnerId)!.status, 'succeeded');
    const completion = sql.prepare('SELECT report_json FROM vocabulary_session_completions WHERE learner_id=?').get(learnerId) as { report_json: string };
    const report = JSON.parse(completion.report_json) as { coveredWordIds: string[] };
    const covered = report.coveredWordIds.includes(item.word.id);
    if (item.expectedCoverage !== undefined) assert.equal(covered, item.expectedCoverage, `Coverage mismatch for ${item.id}`);
    return { id: item.id, learnerId, covered, ...actual };
  });
}
function summary(sql: DatabaseSync): Record<string, unknown> {
  return { jobs: sql.prepare('SELECT kind,status,count(*) AS count FROM vocabulary_reflection_jobs GROUP BY kind,status').all(),
    invocations: sql.prepare('SELECT status,count(*) AS count,sum(spend_usd) AS spendUsd FROM model_invocations GROUP BY status').all(),
    messages: sql.prepare('SELECT count(*) AS count FROM learner_messages').get()!.count,
    proposals: sql.prepare('SELECT status,count(*) AS count FROM content_proposals GROUP BY status').all(),
    failures: sql.prepare("SELECT j.job_id,j.kind,j.last_error,c.learner_id FROM vocabulary_reflection_jobs j JOIN reflection_cases c ON c.case_id=j.case_id WHERE j.status='failed'").all() };
}
function exportEvidence(sql: DatabaseSync): void {
  const tables = ['vocabulary_sessions', 'session_actions', 'vocabulary_session_completions', 'vocabulary_post_session_dispatches',
    'reflection_cases', 'reflection_case_evidence', 'vocabulary_reflection_jobs', 'model_invocations', 'teacher_judgments', 'learner_messages',
    'learner_state_effects', 'content_proposals', 'proposal_revision_history', 'proposal_content_bases', 'content_revision_history',
    'learner_word_schedules', 'learner_pure_cue_schedules', 'vocabulary_improvement_stages', 'vocabulary_sense_readiness',
    'vocabulary_word_catalogs', 'senses', 'sense_revision_history', 'legacy_sense_imports', 'invocation_content_links', 'invocation_sense_links',
    'content_items', 'content_words', 'exercise_answer_words', 'backend_events'];
  const present = new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
  write('evidence.json', Object.fromEntries(tables.filter(table => present.has(table)).map(table => [table, sql.prepare(`SELECT * FROM ${table}`).all()])));
  write('unavailable-evidence-tables.json', tables.filter(table => !present.has(table)));
  write('summary.json', summary(sql));
  for (const row of sql.prepare("SELECT job_id,status,last_error,result_json FROM vocabulary_reflection_jobs WHERE status IN ('succeeded','failed')").all()) {
    const directory = `jobs/${row.job_id}`;
    fs.mkdirSync(path.join(archive, directory), { recursive: true });
    write(`${directory}/finalization.json`, { ...row, providerReturned: fs.existsSync(path.join(archive, directory, 'result.json')) });
  }
}
async function main(): Promise<void> {
  if (mode === 'prepare') {
    const casesArg = flag('--cases'); assert(casesArg, 'prepare requires --cases');
    const cases = loadCases(casesArg);
    fs.mkdirSync(archive, { mode: 0o700 }); // Existing archives are deliberately refused.
    fs.copyFileSync(casesArg, path.join(archive, 'cases.json')); fs.chmodSync(path.join(archive, 'cases.json'), 0o600);
    const sql = new DatabaseSync(dbFile); setDb(sql);
    try {
      initialize(sql);
      const at = new Date(Date.now() - 60_000).toISOString();
      const app = express(); app.use(express.json());
      app.use((req, _res, next) => {
        const learnerId = req.header('x-trial-learner');
        assert(learnerId && cases.cases.some(item => `trial-${item.id}` === learnerId), 'Unknown trial learner');
        runWithLearnerId(learnerId, next);
      });
      registerVocabularyStudyRoutes(app);
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      const address = server.address(); assert(address && typeof address === 'object');
      const requests: unknown[] = [];
      try {
        for (const item of cases.cases) {
          let throughSequence: number;
          try { throughSequence = seedCase(sql, item, at); } catch (error) { throw new Error(`Fixture ${item.id}: ${error instanceof Error ? error.message : String(error)}`); }
          const url = `/api/vocabulary/sessions/session-${item.id}/completion`;
          const body = { throughSequence };
          const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}${url}`, { method: 'POST',
            headers: { 'content-type': 'application/json', 'x-trial-learner': `trial-${item.id}` }, body: JSON.stringify(body) });
          const result: unknown = await response.json();
          requests.push({ caseId: item.id, method: 'POST', url, body, status: response.status, response: result });
          write('completion-api.json', requests);
          assert.equal(response.status, 200, `Completion API failed: ${JSON.stringify(result)}`);
        }
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
      // Respect the real completion undo window rather than changing persisted timestamps.
      log({ event: 'waiting_for_completion_window', cases: cases.cases.length });
      await new Promise(resolve => setTimeout(resolve, 16_000));
      const worker = createVocabularyProcessingWorker({ provider: { isConfigured: () => false, run: async () => { throw new Error('prepare cannot call provider'); } },
        controls: () => ({ maintenanceMode: false, providerWorkEnabled: false }), onError: error => { throw error; } });
      await worker.step(); await worker.stop();
      const routes = routing(sql, cases);
      // This controlled trial compares prompts/content under the original Luna arm,
      // rather than sampling production routing. Save that choice in real jobs.
      sql.prepare('UPDATE vocabulary_reflection_jobs SET model_choice=?').run(LUNA_REFLECTION_MODEL_CHOICE);
      const sources: Record<string, string> = {};
      for (const file of sourceFiles()) { const data = fs.readFileSync(path.join(root, file)); sources[file] = sha(data); fs.mkdirSync(path.dirname(path.join(archive, 'source', file)), { recursive: true }); fs.writeFileSync(path.join(archive, 'source', file), data); }
      write('manifest.json', { format: 'vocabulary-reflection-trial.v1', casesSha256: sha(read(path.join(archive, 'cases.json'))), preparedAt: new Date().toISOString(),
        model: LUNA_REFLECTION_MODEL_CONFIG.providerModel, modelChoice: LUNA_REFLECTION_MODEL_CHOICE, senseModel: VOCABULARY_SENSE_MODEL, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sources, routing: routes } satisfies Manifest);
      exportEvidence(sql); log({ event: 'prepared', cases: cases.cases.length, ...summary(sql) });
    } finally { sql.close(); }
    return;
  }
  const manifest = JSON.parse(read(path.join(archive, 'manifest.json'))) as Manifest;
  assert.equal(manifest.format, 'vocabulary-reflection-trial.v1');
  assert.equal(sha(read(path.join(archive, 'cases.json'))), manifest.casesSha256, 'Archived cases changed');
  assert(fs.statSync(dbFile).isFile() && !fs.lstatSync(dbFile).isSymbolicLink(), 'Expected dedicated trial database');
  if (mode === 'run') {
    assert(args.includes('--allow-provider-calls'), 'run requires explicit --allow-provider-calls');
    for (const [file, hash] of Object.entries(manifest.sources)) assert.equal(sha(read(path.join(root, file))), hash, `Source changed since prepare: ${file}`);
  }
  const lock = path.join(archive, '.runner-lock');
  const lockFd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(lockFd, String(process.pid));
  const sql = new DatabaseSync(dbFile); setDb(sql); sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    if (mode === 'inspect') { exportEvidence(sql); log({ event: 'inspected', ...summary(sql) }); return; }
    assert.equal(manifest.model, LUNA_REFLECTION_MODEL_CONFIG.providerModel, 'Trial requires its prepared Luna model');
    assert.equal(manifest.modelChoice, LUNA_REFLECTION_MODEL_CHOICE, 'Prepare a new archive with an explicit model choice');
    assert.equal(Number(sql.prepare('SELECT count(*) AS n FROM vocabulary_reflection_jobs WHERE model_choice IS NULL OR model_choice<>?').get(LUNA_REFLECTION_MODEL_CHOICE)!.n), 0,
      'Trial job routing differs from the prepared model');
    installModelInvocationLedger();
    const maximumProviderCalls = Number(flag('--max-provider-calls') ?? 100);
    assert(Number.isSafeInteger(maximumProviderCalls) && maximumProviderCalls > 0, 'Invalid --max-provider-calls');
    const callDirectory = path.join(archive, 'provider-calls');
    const recordedCalls = fs.existsSync(callDirectory) ? Math.max(0, ...fs.readdirSync(callDirectory).map(name => Number(name)).filter(Number.isFinite)) : 0;
    let providerCalls = Math.max(recordedCalls, Number(sql.prepare('SELECT count(*) AS n FROM model_invocations').get()!.n));
    const adapter = (timeoutMs: number): ProviderAdapter => {
      const native = createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: LUNA_REFLECTION_MODEL_CONFIG.defaultBaseUrl,
        apiKeyEnvironmentVariable: 'OPENAI_API_KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_completion_tokens',
        fetchImplementation: fetchImplementationForProvider('openai', timeoutMs) });
      return { ...native, run: async (request, config) => {
        assert(providerCalls < maximumProviderCalls, 'Provider call limit reached');
        const number = ++providerCalls;
        const name = `provider-calls/${String(number).padStart(4, '0')}`;
        fs.mkdirSync(path.join(archive, name), { recursive: true });
        // Request contains no credentials. The ledger additionally retains exact wire JSON.
        write(`${name}/request.json`, request);
        log({ event: 'provider_call_started', number, maximumProviderCalls, model: request.model, ...request.provenance });
        try { const result = await native.run(request, config); write(`${name}/result.json`, result); return result; }
        catch (error) { write(`${name}/error.json`, errorSummary(error)); throw error; }
        finally { exportEvidence(sql); }
      } };
    };
    const senseProvider = createVocabularySenseProvider({ adapter: adapter(180_000) });
    const provider = createVocabularyReflectionProvider({ adapter: adapter(LUNA_REFLECTION_MODEL_CONFIG.timeoutMs),
      ensureSenses: (wordId, options) => ensureVocabularySenses(wordId, { ...options, provider: senseProvider }) });
    assert(provider.isConfigured(), 'OPENAI_API_KEY is not configured');
    assert.equal(Number(sql.prepare("SELECT count(*) AS n FROM vocabulary_reflection_jobs WHERE status='running'").get()!.n), 0,
      'Archive contains running jobs from an interrupted process; reconcile provider outcomes before further calls');
    const worker = createVocabularyProcessingWorker({ provider: { isConfigured: () => true, run: async (job, context) => {
      assert.equal(job.attemptNumber, 1, 'Trial permits exactly one attempt per job');
      const name = `jobs/${job.jobId}`; fs.mkdirSync(path.join(archive, name), { recursive: true });
      write(`${name}/input.json`, { job, projection: projectVocabularyReflectionInput(job) });
      log({ event: 'job_started', jobId: job.jobId, caseId: job.caseId, learnerId: job.learnerId, kind: job.kind });
      try { const result = await provider.run(job, context); write(`${name}/result.json`, result); log({ event: 'provider_returned', jobId: job.jobId, kind: job.kind }); return result; }
      catch (error) { const detail = errorSummary(error); write(`${name}/error.json`, detail); log({ event: 'provider_failed', jobId: job.jobId, kind: job.kind, error: detail }); throw error; }
    } }, controls: () => ({ maintenanceMode: false, providerWorkEnabled: true }), providerWork: async work => work(),
      onError: error => log({ event: 'worker_error', error: errorSummary(error) }) });
    const expectedJobs = loadCases(path.join(archive, 'cases.json')).cases.reduce((total, item) => total + item.expected.feedbackJobs + item.expected.improvementJobs, 0);
    assert.equal(Number(sql.prepare('SELECT count(*) AS n FROM vocabulary_reflection_jobs').get()!.n), expectedJobs, 'Unexpected provider job count');
    const heartbeat = setInterval(() => log({ event: 'progress', ...summary(sql) }), 30_000);
    try {
      while (Number(sql.prepare("SELECT count(*) AS n FROM vocabulary_reflection_jobs WHERE status='queued'").get()!.n) > 0) {
        if (!await worker.step()) throw new Error('Queued jobs made no progress');
        exportEvidence(sql); log({ event: 'batch_finished', ...summary(sql) });
      }
    } finally { clearInterval(heartbeat); await worker.stop(); exportEvidence(sql); }
    log({ event: 'run_finished', ...summary(sql) });
  } finally { sql.close(); fs.closeSync(lockFd); fs.unlinkSync(lock); }
}
main().catch(error => { process.stderr.write(`${JSON.stringify(errorSummary(error))}\n`); process.exitCode = 1; });
