import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createDietIntakePlacementService } from '../server/diet/intake-placement-service.ts';
import { DietIntakePlacementAssessmentError } from '../server/diet/intake-placement-service.ts';
import type { DietIntakePlacementProvider } from '../server/diet/intake-placement-provider.ts';
import { DietProfileChangedDuringAssessmentError } from '../server/db/diet-profile.ts';
import type { DeckManifest } from '../server/decks/manifest.ts';

type IndexModule = typeof import('../server/index.ts');
type DbModule = typeof import('../server/db.ts');
type ExpressApp = ReturnType<IndexModule['createApp']>;
let indexModule: IndexModule;
let dbModule: DbModule;
let sqlite: DatabaseSync;
let dataDir = '';

const answers = [{ prompt: 'Background?', answer: 'I studied Mandarin for two years.' }];
const metadata = { provider: 'openai', modelConfig: 'gpt-5.6-luna-high', providerModel: 'gpt-5.6-luna', promptVersion: 'diet-intake-placement-v1', clientRequestId: 'run-1', responseId: 'response-1', finishReason: 'stop', usage: { inputTokens: 1, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 1, reasoningTokens: null, totalTokens: 2 } } as const;

describe('diet intake placement service and HTTP route', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-diet-intake-placement-'));
    const previousMode = process.env.APP_MODE; const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study'; process.env.APP_DATA_DIR = dataDir;
    try {
      indexModule = await import(`${pathToFileURL(path.resolve('server/index.ts')).href}?diet-placement=${Date.now()}`);
      dbModule = await import('../server/db.ts');
    } finally { restoreEnv('APP_MODE', previousMode); restoreEnv('APP_DATA_DIR', previousDataDir); }
    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  });
  after(() => { sqlite.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  beforeEach(() => {
    sqlite.exec("DELETE FROM learner_settings WHERE setting_key = 'diet_profile';");
    sqlite.prepare("UPDATE service_controls SET enabled = ? WHERE control_key = ?").run(0, 'maintenance_mode');
    sqlite.prepare("UPDATE service_controls SET enabled = ? WHERE control_key = ?").run(1, 'provider_work_enabled');
  });

  test('service applies only a successful assessment and provider failure leaves no profile', async () => {
    let calls = 0;
    const provider: DietIntakePlacementProvider = { async assess() { calls += 1; return { result: { schemaVersion: 'diet_intake_placement_result.v1', nextLearningLevel: 2, rationale: 'Begin at the next beginner band.' }, metadata }; } };
    const service = createDietIntakePlacementService({ provider, now: () => new Date('2026-09-10T00:00:00.000Z') });
    const profile = await service.assessAndApply(answers);
    assert.deepEqual(profile.weights, { 'hsk2-l2': 1 });
    assert.equal(profile.intake?.assessment?.rationale, 'Begin at the next beginner band.');
    assert.equal(calls, 1);
    assertStudyTablesEmpty();
    const failing = createDietIntakePlacementService({ provider: { async assess() { throw new Error('provider down'); } } });
    await assert.rejects(failing.assessAndApply(answers), /provider down/);
    assert.deepEqual(dbModule.getStoredDietProfile()?.weights, { 'hsk2-l2': 1 });
    assertStudyTablesEmpty();
  });

  test('service serializes one learner while allowing another learner independently', async () => {
    sqlite.prepare('INSERT INTO learners (learner_id, display_name, created_at) VALUES (?, ?, ?)').run('learner-a', 'A', '2026-09-10T00:00:00.000Z');
    sqlite.prepare('INSERT INTO learners (learner_id, display_name, created_at) VALUES (?, ?, ?)').run('learner-b', 'B', '2026-09-10T00:00:00.000Z');
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const provider: DietIntakePlacementProvider = { async assess(request) {
      await pending;
      const level = request.answers[0]?.answer === 'learner a' ? 1 : 3;
      return { result: { schemaVersion: 'diet_intake_placement_result.v1', nextLearningLevel: level, rationale: `Level ${level}.` }, metadata };
    } };
    const service = createDietIntakePlacementService({ provider });
    const first = dbModule.runWithLearnerId('learner-a', () => service.assessAndApply([{ prompt: 'Background?', answer: 'learner a' }]));
    await assert.rejects(dbModule.runWithLearnerId('learner-a', () => service.assessAndApply(answers)), /already in progress/);
    const second = dbModule.runWithLearnerId('learner-b', () => service.assessAndApply([{ prompt: 'Background?', answer: 'learner b' }]));
    release();
    const [profileA, profileB] = await Promise.all([first, second]);
    assert.deepEqual(profileA.weights, { 'hsk2-l1': 1 });
    assert.deepEqual(profileB.weights, { 'hsk2-l3': 1 });
    assert.equal(profileA.intake?.answers[0]?.answer, 'learner a');
    assert.equal(profileB.intake?.answers[0]?.answer, 'learner b');
  });

  test('a newer manual placement wins over an in-flight assessment', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const service = createDietIntakePlacementService({ provider: { async assess() {
      await pending;
      return { result: { schemaVersion: 'diet_intake_placement_result.v1', nextLearningLevel: 3, rationale: 'Late result.' }, metadata };
    } } });
    const inFlight = service.assessAndApply(answers);
    dbModule.recordDietIntake({ answers: [], selfSelect: 'some-basics' });
    release();
    await assert.rejects(inFlight, /profile changed while the intake assessment/);
    assert.deepEqual(dbModule.getStoredDietProfile()?.weights, { 'hsk2-l2': 1 });
  });

  test('route enforces disclosure and hosted controls while manual intake stays provider-free', async () => {
    let assessed = 0;
    const app = indexModule.createApp({ dietIntakePlacementService: { async assessAndApply() { assessed += 1; return dbModule.recordDietIntake({ answers, selfSelect: 'some-basics' }); } } });
    const undisclosed = await request(app, '/api/diet/intake/assess', { answers });
    assert.equal(undisclosed.status, 400); assert.equal(assessed, 0);
    dbModule.setHostedServiceControl({ key: 'provider_work_enabled', enabled: false, actorId: 'test' });
    const disabled = await request(app, '/api/diet/intake/assess', { answers, providerDisclosureAccepted: true });
    assert.equal(disabled.status, 503); assert.equal(assessed, 0);
    const manual = await request(app, '/api/diet/intake', { answers: [], selfSelect: 'some-basics' });
    assert.equal(manual.status, 201); assert.equal(assessed, 0);
    dbModule.setHostedServiceControl({ key: 'provider_work_enabled', enabled: true, actorId: 'test' });
  });

  test('route returns success, provider failure, stale, and invalid-input statuses', async () => {
    assert.deepEqual(dbModule.getHostedServiceControls(), { maintenanceMode: false, providerWorkEnabled: true });
    const successful = indexModule.createApp({
      dietIntakePlacementService: {
        async assessAndApply() {
          return dbModule.recordDietIntake({ answers, selfSelect: 'some-basics' });
        },
      },
    });
    assert.equal((await request(successful, '/api/diet/intake/assess', {
      answers,
      providerDisclosureAccepted: true,
    })).status, 201);
    const providerFailure = indexModule.createApp({
      dietIntakePlacementService: {
        async assessAndApply() {
          throw new DietIntakePlacementAssessmentError('provider_failure', 'Provider failed.', 'upstream_failure');
        },
      },
    });
    assert.equal((await request(providerFailure, '/api/diet/intake/assess', {
      answers,
      providerDisclosureAccepted: true,
    })).status, 502);
    const stale = indexModule.createApp({
      dietIntakePlacementService: {
        async assessAndApply() {
          throw new DietProfileChangedDuringAssessmentError();
        },
      },
    });
    assert.equal((await request(stale, '/api/diet/intake/assess', {
      answers,
      providerDisclosureAccepted: true,
    })).status, 409);
    assert.equal((await request(successful, '/api/diet/intake/assess', {
      answers: [{ prompt: 'p', answer: 'a', hidden: 'x' }],
      providerDisclosureAccepted: true,
    })).status, 400);
  });

  test('missing manifest rejects before a provider call', async () => {
    let called = false;
    const service = createDietIntakePlacementService({
      loadManifest: () => null,
      provider: { async assess() { called = true; throw new Error('unexpected'); } },
    });
    await assert.rejects(service.assessAndApply(answers), /manifest is not available/);
    assert.equal(called, false);
  });

  test('a non-null manifest without HSK 2.0 placement decks also rejects before a provider call', async () => {
    let called = false;
    const tailOnly: DeckManifest = {
      meta: { manifestVersion: 1, generatedAt: '2026-09-10T00:00:00.000Z', source: 'test' },
      decks: [{ id: 'tail', order: 0, hsk: null, stratum: null, size: 0 }],
      assignments: {},
    };
    const service = createDietIntakePlacementService({
      loadManifest: () => tailOnly,
      provider: { async assess() { called = true; throw new Error('unexpected'); } },
    });
    await assert.rejects(service.assessAndApply(answers), /no HSK 2.0 deck/);
    assert.equal(called, false);
  });
});

function assertStudyTablesEmpty(): void {
  for (const table of ['learner_owned_study_attempt_events', 'learner_owned_study_sessions', 'learner_owned_study_events', 'learner_owned_daily_new_word_intake']) {
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    assert.equal(row.count, 0, `assessment must not write to ${table}`);
  }
}

async function request(app: ExpressApp, pathName: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const route = findRoute(app, 'POST', pathName); assert.ok(route, `Missing POST route for ${pathName}`); let status = 200;
  return new Promise((resolve, reject) => {
    const response = { status(next: number) { status = next; return response; }, json(value: unknown) { resolve({ status, json: value }); return response; } };
    Promise.resolve(route.handler({ params: {}, query: {}, body }, response)).catch(reject);
  });
}

function findRoute(app: ExpressApp, method: string, pathName: string): { handler: (req: unknown, res: unknown) => unknown } | null {
  const stack = (app as unknown as { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: unknown) => unknown }> } }> } })._router.stack;
  const layer = stack.find((item) => item.route?.path === pathName && item.route.methods[method.toLowerCase()]);
  return layer?.route ? { handler: layer.route.stack[0]!.handle } : null;
}
function restoreEnv(key: string, value: string | undefined): void { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
