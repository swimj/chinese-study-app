import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  deckAssignmentKey,
  getDeckIdForWord,
  loadDeckManifest,
  parseDeckManifest,
  type DeckManifest,
} from '../server/decks/manifest.ts';
import {
  applyDietIntake,
  applyDietNudge,
  applyOperatorDietJump,
  createDefaultDietProfile,
  mapNextLearningLevelToDeckId,
  mapSelfSelectToDeckId,
  parseDietProfile,
  resolveEffectiveDietWeights,
  UnknownDietDeckError,
  type DietProfile,
} from '../server/db/diet-profile.ts';

const FIXTURE_MANIFEST_PATH = fileURLToPath(new URL('./fixtures/mandarin-decks-v1.fixture.json', import.meta.url));
const NOW = '2026-09-10T00:00:00.000Z';

function fixtureManifest(): DeckManifest {
  const manifest = loadDeckManifest(FIXTURE_MANIFEST_PATH);
  assert.ok(manifest, 'fixture manifest should load');
  return manifest;
}

describe('deck manifest loader', () => {
  test('returns null when the manifest file is absent', () => {
    assert.equal(loadDeckManifest(path.join(os.tmpdir(), 'no-such-deck-manifest.json')), null);
  });

  test('loads decks sorted by order and joins words by canonical key', () => {
    const manifest = fixtureManifest();
    assert.deepEqual(manifest.decks.map((deck) => deck.id), ['hsk2-l1', 'hsk2-l2', 'hsk2-l3-s1', 'beyond-hsk']);
    assert.equal(getDeckIdForWord(manifest, '我', 'wǒ'), 'hsk2-l1');
    assert.equal(getDeckIdForWord(manifest, '抽象', 'chōu xiàng'), 'hsk2-l3-s1');
  });

  test('words missing from assignments belong to the tail deck', () => {
    const manifest = fixtureManifest();
    assert.equal(getDeckIdForWord(manifest, '犇', 'bēn'), 'beyond-hsk');
  });

  test('assignment keys normalize pinyin case and whitespace', () => {
    assert.equal(deckAssignmentKey('我', '  Wǒ '), '我|wǒ');
    const manifest = fixtureManifest();
    assert.equal(getDeckIdForWord(manifest, '我', 'Wǒ'), 'hsk2-l1');
  });

  test('present-but-malformed manifests fail loudly', () => {
    assert.throws(() => parseDeckManifest(null), /JSON object/);
    assert.throws(() => parseDeckManifest({ meta: { manifestVersion: 2 }, decks: [], assignments: {} }), /manifestVersion/);
    assert.throws(
      () => parseDeckManifest({
        meta: { manifestVersion: 1 },
        decks: [{ id: 'a', order: 0, hsk: null, stratum: null, size: 0 }],
        assignments: { '我|wǒ': 'missing-deck' },
      }),
      /unknown deck id/,
    );
  });
});

describe('diet profile transitions', () => {
  test('default when unset is 100% weight on the first deck by manifest order', () => {
    const profile = createDefaultDietProfile(fixtureManifest(), NOW);
    assert.deepEqual(profile.weights, { 'hsk2-l1': 1 });
    assert.deepEqual(profile.provenance, []);
  });

  test('a harder nudge shifts one quantum from the max-weight deck to its successor', () => {
    const manifest = fixtureManifest();
    const initial = createDefaultDietProfile(manifest, NOW);
    const { profile, changed } = applyDietNudge(initial, manifest, 'harder', '2026-09-10T01:00:00.000Z');

    assert.equal(changed, true);
    assert.deepEqual(profile.weights, { 'hsk2-l1': 0.9, 'hsk2-l2': 0.1 });
    assert.deepEqual(profile.provenance, [{ actor: 'learner-nudge', at: '2026-09-10T01:00:00.000Z', note: 'harder' }]);
    assert.equal(profile.updatedAt, '2026-09-10T01:00:00.000Z');
  });

  test('an easier nudge moves weight back toward the predecessor', () => {
    const manifest = fixtureManifest();
    const placed: DietProfile = {
      version: 1,
      weights: { 'hsk2-l2': 1 },
      provenance: [],
      updatedAt: NOW,
    };
    const { profile, changed } = applyDietNudge(placed, manifest, 'easier', NOW);
    assert.equal(changed, true);
    assert.deepEqual(profile.weights, { 'hsk2-l2': 0.9, 'hsk2-l1': 0.1 });
  });

  test('nudges are clamped at the ends without provenance', () => {
    const manifest = fixtureManifest();
    const first = createDefaultDietProfile(manifest, NOW);
    const easierAtFirst = applyDietNudge(first, manifest, 'easier', NOW);
    assert.equal(easierAtFirst.changed, false);
    assert.equal(easierAtFirst.profile, first);

    const last: DietProfile = { version: 1, weights: { 'beyond-hsk': 1 }, provenance: [], updatedAt: NOW };
    const harderAtLast = applyDietNudge(last, manifest, 'harder', NOW);
    assert.equal(harderAtLast.changed, false);
    assert.equal(harderAtLast.profile, last);
  });

  test('repeated nudges walk the full weight across adjacent decks', () => {
    const manifest = fixtureManifest();
    let profile = createDefaultDietProfile(manifest, NOW);
    for (let index = 0; index < 10; index += 1) {
      profile = applyDietNudge(profile, manifest, 'harder', NOW).profile;
    }
    assert.deepEqual(profile.weights, { 'hsk2-l2': 1 });
    assert.equal(profile.provenance.length, 10);
    const weightSum = Object.values(profile.weights).reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(weightSum - 1) < 1e-9);
  });

  test('stale deck ids are dropped from effective weights with a first-deck fallback', () => {
    const manifest = fixtureManifest();
    const stale: DietProfile = { version: 1, weights: { 'deleted-deck': 1 }, provenance: [], updatedAt: NOW };
    assert.deepEqual(resolveEffectiveDietWeights(stale, manifest), { 'hsk2-l1': 1 });
  });

  test('self-select maps onto the first deck of an HSK target level, walking down', () => {
    const manifest = fixtureManifest();
    assert.equal(mapSelfSelectToDeckId(manifest, null), 'hsk2-l1');
    assert.equal(mapSelfSelectToDeckId(manifest, 'complete-beginner'), 'hsk2-l1');
    assert.equal(mapSelfSelectToDeckId(manifest, 'some-basics'), 'hsk2-l2');
    // The fixture has no L4+ decks; intermediate and advanced walk down to L3.
    assert.equal(mapSelfSelectToDeckId(manifest, 'intermediate'), 'hsk2-l3-s1');
    assert.equal(mapSelfSelectToDeckId(manifest, 'advanced-or-heritage'), 'hsk2-l3-s1');
  });

  test('self-select targets L4/L6 when those decks exist, never the tail', () => {
    const manifest: DeckManifest = {
      meta: { manifestVersion: 1 },
      decks: [1, 2, 3, 4, 5, 6].map((level, index) => ({
        id: `hsk2-l${level}`,
        order: index,
        hsk: { version: '2.0', level },
        stratum: null,
        size: 100,
      })).concat([{ id: 'beyond-hsk', order: 6, hsk: null, stratum: null, size: 0 }]),
      assignments: {},
    };
    assert.equal(mapSelfSelectToDeckId(manifest, 'some-basics'), 'hsk2-l2');
    assert.equal(mapSelfSelectToDeckId(manifest, 'intermediate'), 'hsk2-l4');
    assert.equal(mapSelfSelectToDeckId(manifest, 'advanced-or-heritage'), 'hsk2-l6');
  });

  test('provider next-learning levels map internally and reject manifests without HSK placement decks', () => {
    const manifest = fixtureManifest();
    assert.equal(mapNextLearningLevelToDeckId(manifest, 1), 'hsk2-l1');
    assert.equal(mapNextLearningLevelToDeckId(manifest, 3), 'hsk2-l3-s1');
    assert.equal(mapNextLearningLevelToDeckId(manifest, 6), 'hsk2-l3-s1');
    assert.throws(() => mapNextLearningLevelToDeckId({ ...manifest, decks: [manifest.decks.at(-1)!] }, 1), /no HSK 2.0 deck/);
    assert.throws(() => mapNextLearningLevelToDeckId(manifest, 7 as 1), /1 through 6/);
  });

  test('intake stores raw answers verbatim and places 100% on the mapped deck', () => {
    const manifest = fixtureManifest();
    const profile = applyDietIntake(null, manifest, {
      answers: [
        { prompt: 'What is your background with Chinese?', answer: 'Heritage speaker, never studied formally.' },
        { prompt: 'What do you want to be able to do?', answer: 'Read wuxia novels.' },
      ],
      selfSelect: 'advanced-or-heritage',
    }, NOW);

    assert.deepEqual(profile.weights, { 'hsk2-l3-s1': 1 });
    assert.equal(profile.intake?.answers[1]?.answer, 'Read wuxia novels.');
    assert.equal(profile.intake?.selfSelect, 'advanced-or-heritage');
    assert.deepEqual(profile.provenance, [{ actor: 'intake', at: NOW, note: 'self-select: advanced-or-heritage' }]);
  });

  test('operator jump sets 100% on a chosen deck and rejects unknown decks', () => {
    const manifest = fixtureManifest();
    const current = applyDietIntake(null, manifest, { answers: [], selfSelect: null }, NOW);
    const jumped = applyOperatorDietJump(current, manifest, 'hsk2-l3-s1', 'concierge correction', NOW);

    assert.deepEqual(jumped.weights, { 'hsk2-l3-s1': 1 });
    assert.deepEqual(jumped.provenance.at(-1), { actor: 'operator', at: NOW, note: 'concierge correction' });
    assert.ok(jumped.intake, 'operator jump retains the intake record');
    assert.throws(() => applyOperatorDietJump(null, manifest, 'nope', null, NOW), UnknownDietDeckError);
  });

  test('stored profiles round-trip through validation and reject corrupt values', () => {
    const profile = applyDietIntake(null, fixtureManifest(), {
      answers: [{ prompt: 'p', answer: 'a' }],
      selfSelect: null,
    }, NOW);
    assert.deepEqual(parseDietProfile(JSON.parse(JSON.stringify(profile))), profile);
    assert.throws(() => parseDietProfile({ version: 2 }), /version/);
    assert.throws(() => parseDietProfile({ version: 1, weights: 'x', provenance: [], updatedAt: NOW }), /weights/);
  });
});

describe('diet profile persistence', { concurrency: false }, () => {
  let dataDir = '';
  let sqlite: DatabaseSync;
  let dbModule: typeof import('../server/db.ts');

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-diet-profile-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
    dbModule = await import(moduleUrl);

    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    sqlite.exec(`DELETE FROM learner_settings WHERE setting_key = 'diet_profile';`);
  });

  function storedSetting(): unknown {
    const row = sqlite.prepare(`
      SELECT value_json FROM learner_settings WHERE setting_key = 'diet_profile'
    `).get() as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) : null;
  }

  test('unset profile stays unpersisted and defaults to the first deck', () => {
    assert.equal(dbModule.getStoredDietProfile(), null);
    const profile = dbModule.getDietProfile(fixtureManifest());
    assert.deepEqual(profile?.weights, { 'hsk2-l1': 1 });
    assert.equal(storedSetting(), null);
  });

  test('nudge persists the shifted distribution with provenance', () => {
    const result = dbModule.nudgeDietProfile('harder', fixtureManifest());
    assert.equal(result.changed, true);
    const stored = dbModule.getStoredDietProfile();
    assert.ok(stored);
    assert.equal(stored.weights['hsk2-l1'], 0.9);
    assert.equal(stored.weights['hsk2-l2'], 0.1);
    assert.equal(stored.provenance.at(-1)?.actor, 'learner-nudge');

    const clamped = dbModule.nudgeDietProfile('easier', fixtureManifest());
    assert.equal(clamped.changed, true);
    assert.equal(clamped.profile.weights['hsk2-l1'], 1);
  });

  test('intake persists answers and placement without any study-action side effects', () => {
    const profile = dbModule.recordDietIntake({
      answers: [{ prompt: 'Background?', answer: 'Studied for a year in college.' }],
      selfSelect: 'some-basics',
    }, fixtureManifest());
    assert.deepEqual(profile.weights, { 'hsk2-l2': 1 });

    const stored = storedSetting() as { intake?: { answers: Array<{ answer: string }> } };
    assert.equal(stored.intake?.answers[0]?.answer, 'Studied for a year in college.');

    // These logical names are learner-scoped views over learner_owned_*
    // storage tables; the raw connection lacks current_learner_id, so count
    // the physical tables directly (single-learner test database).
    for (const table of ['learner_owned_study_attempt_events', 'learner_owned_study_sessions', 'learner_owned_study_events', 'learner_owned_daily_new_word_intake']) {
      const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      assert.equal(row.count, 0, `intake must not write to ${table}`);
    }
  });

  test('provider-assessed intake atomically retains judgment evidence and rejects a stale result', () => {
    const before = dbModule.snapshotStoredDietProfile();
    const provider = {
      provider: 'openai', modelConfig: 'gpt-5.6-luna-high', providerModel: 'gpt-5.6-luna',
      promptVersion: 'diet-intake-placement-v1', clientRequestId: 'assessment-1', responseId: 'response-1',
      finishReason: 'stop', usage: { inputTokens: 10, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 5, reasoningTokens: null, totalTokens: 15 },
    } as const;
    const profile = dbModule.recordAssessedDietIntakeIfUnchanged({
      answers: [{ prompt: 'Background?', answer: 'I can hold conversations.' }], level: 3,
      rationale: 'Ready for elementary expansion.', provider, at: NOW,
    }, before, fixtureManifest());
    assert.deepEqual(profile.weights, { 'hsk2-l3-s1': 1 });
    assert.equal(profile.intake?.assessment?.nextLearningLevel, 3);
    assert.equal(profile.intake?.assessment?.provider.promptVersion, 'diet-intake-placement-v1');

    const staleSnapshot = dbModule.snapshotStoredDietProfile();
    dbModule.nudgeDietProfile('harder', fixtureManifest());
    assert.throws(() => dbModule.recordAssessedDietIntakeIfUnchanged({
      answers: [{ prompt: 'Background?', answer: 'New answer.' }], level: 2,
      rationale: 'Would overwrite a newer nudge.', provider, at: NOW,
    }, staleSnapshot, fixtureManifest()), dbModule.DietProfileChangedDuringAssessmentError);
    assert.notDeepEqual(dbModule.getStoredDietProfile()?.weights, { 'hsk2-l2': 1 });
  });

  test('operator jump persists 100% on the chosen deck', () => {
    const profile = dbModule.setOperatorDietDeck('hsk2-l3-s1', 'knows the learner', fixtureManifest());
    assert.deepEqual(profile.weights, { 'hsk2-l3-s1': 1 });
    assert.equal(dbModule.getStoredDietProfile()?.provenance.at(-1)?.actor, 'operator');
  });

  test('operations fail loudly when the manifest is unavailable', () => {
    assert.throws(() => dbModule.nudgeDietProfile('harder', null), /manifest is not available/);
    assert.throws(() => dbModule.recordDietIntake({ answers: [], selfSelect: null }, null), /manifest is not available/);
    assert.throws(() => dbModule.setOperatorDietDeck('hsk2-l1', null, null), /manifest is not available/);
  });
});

describe('diet status surface', { concurrency: false }, () => {
  let dataDir = '';
  let sqlite: DatabaseSync;
  let dbModule: typeof import('../server/db.ts');

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-diet-status-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test-status=${Date.now()}`;
    dbModule = await import(moduleUrl);

    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    sqlite.exec(`DELETE FROM learner_settings WHERE setting_key = 'diet_profile';`);
  });

  test('intake is required only while no profile is stored', () => {
    assert.equal(dbModule.isDietDeckModeActive(fixtureManifest()), true);
    assert.equal(dbModule.isDietIntakeRequired(fixtureManifest()), true);

    dbModule.recordDietIntake({ answers: [], selfSelect: null }, fixtureManifest());
    assert.equal(dbModule.isDietIntakeRequired(fixtureManifest()), false);
    assert.equal(dbModule.isDietDeckModeActive(fixtureManifest()), true);
  });

  test('deck mode and intake are inactive without a manifest', () => {
    assert.equal(dbModule.isDietDeckModeActive(null), false);
    assert.equal(dbModule.isDietIntakeRequired(null), false);
  });
});
