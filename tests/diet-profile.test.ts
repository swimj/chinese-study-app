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
  applyDietNudge,
  applyOperatorDietJump,
  createDefaultDietProfile,
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
    assert.deepEqual(manifest.decks.map((deck) => deck.id), ['hsk2-l1', 'hsk2-l2', 'hsk2-l3-s1', 'hsk2-l6-s1', 'beyond-hsk']);
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
  test('default when unset is 100% weight on the first HSK 6 deck', () => {
    const profile = createDefaultDietProfile(fixtureManifest(), NOW);
    assert.deepEqual(profile.weights, { 'hsk2-l6-s1': 1 });
    assert.deepEqual(profile.provenance, []);
  });

  test('runtime manifest defaults to the first HSK 6 stratum and missing HSK 6 fails loudly', () => {
    const manifest = loadDeckManifest();
    assert.ok(manifest);
    assert.deepEqual(createDefaultDietProfile(manifest, NOW).weights, { 'hsk2-l6-s1': 1 });
    const reduced = { ...fixtureManifest() };
    reduced.decks = reduced.decks.filter((deck) => deck.hsk?.level !== 6);
    assert.throws(() => createDefaultDietProfile(reduced, NOW), /no HSK 2.0 Level 6 deck/);
  });

  test('a harder nudge shifts one quantum from the max-weight deck to its successor', () => {
    const manifest = fixtureManifest();
    const initial = applyOperatorDietJump(null, manifest, 'hsk2-l1', null, NOW);
    const { profile, changed } = applyDietNudge(initial, manifest, 'harder', '2026-09-10T01:00:00.000Z');

    assert.equal(changed, true);
    assert.deepEqual(profile.weights, { 'hsk2-l1': 0.9, 'hsk2-l2': 0.1 });
    assert.deepEqual(profile.provenance.slice(1), [{ actor: 'learner-nudge', at: '2026-09-10T01:00:00.000Z', note: 'harder' }]);
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
    const first = applyOperatorDietJump(null, manifest, 'hsk2-l1', null, NOW);
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
    let profile = applyOperatorDietJump(null, manifest, 'hsk2-l1', null, NOW);
    for (let index = 0; index < 10; index += 1) {
      profile = applyDietNudge(profile, manifest, 'harder', NOW).profile;
    }
    assert.deepEqual(profile.weights, { 'hsk2-l2': 1 });
    assert.equal(profile.provenance.length, 11);
    const weightSum = Object.values(profile.weights).reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(weightSum - 1) < 1e-9);
  });

  test('stale deck ids are dropped from effective weights with a first-deck fallback', () => {
    const manifest = fixtureManifest();
    const stale: DietProfile = { version: 1, weights: { 'deleted-deck': 1 }, provenance: [], updatedAt: NOW };
    assert.deepEqual(resolveEffectiveDietWeights(stale, manifest), { 'hsk2-l1': 1 });
  });

  test('operator jump sets 100% on a chosen deck and rejects unknown decks', () => {
    const manifest = fixtureManifest();
    const current = historicalProfile();
    const jumped = applyOperatorDietJump(current, manifest, 'hsk2-l3-s1', 'concierge correction', NOW);

    assert.deepEqual(jumped.weights, { 'hsk2-l3-s1': 1 });
    assert.deepEqual(jumped.provenance.at(-1), { actor: 'operator', at: NOW, note: 'concierge correction' });
    assert.ok(jumped.intake, 'operator jump retains the intake record');
    assert.throws(() => applyOperatorDietJump(null, manifest, 'nope', null, NOW), UnknownDietDeckError);
  });

  test('stored profiles round-trip through validation and reject corrupt values', () => {
    const profile = historicalProfile();
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

  test('unset profile stays unpersisted and defaults to the first HSK 6 deck', () => {
    assert.equal(dbModule.getStoredDietProfile(), null);
    const profile = dbModule.getDietProfile(fixtureManifest());
    assert.deepEqual(profile?.weights, { 'hsk2-l6-s1': 1 });
    assert.equal(storedSetting(), null);
  });

  test('nudge persists the shifted distribution with provenance', () => {
    dbModule.setOperatorDietDeck('hsk2-l1', null, fixtureManifest());
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

  test('saved historical survey placement survives reads and subsequent nudges', () => {
    const historical = historicalProfile();
    dbModule.saveDietProfile(historical);
    assert.deepEqual(dbModule.getDietProfile(fixtureManifest()), historical);
    const nudged = dbModule.nudgeDietProfile('harder', fixtureManifest()).profile;
    assert.deepEqual(nudged.intake, historical.intake);
    assert.deepEqual(nudged.provenance[0], historical.provenance[0]);
    assert.deepEqual(storedSetting(), nudged);
  });

  test('operator jump persists 100% on the chosen deck', () => {
    const profile = dbModule.setOperatorDietDeck('hsk2-l3-s1', 'knows the learner', fixtureManifest());
    assert.deepEqual(profile.weights, { 'hsk2-l3-s1': 1 });
    assert.equal(dbModule.getStoredDietProfile()?.provenance.at(-1)?.actor, 'operator');
  });

  test('operations fail loudly when the manifest is unavailable', () => {
    assert.throws(() => dbModule.nudgeDietProfile('harder', null), /manifest is not available/);
    assert.throws(() => dbModule.setOperatorDietDeck('hsk2-l1', null, null), /manifest is not available/);
  });
});

function historicalProfile(): DietProfile {
  return {
    version: 1, weights: { 'hsk2-l1': 1 }, updatedAt: NOW,
    provenance: [{ actor: 'intake', at: NOW, note: 'historical assessment' }],
    intake: {
      answers: [{ prompt: 'Background?', answer: 'Studied for a year.' }],
      selfSelect: null, at: NOW,
      assessment: {
        nextLearningLevel: 1, rationale: 'Historical assessment.',
        provider: { provider: 'openai', modelConfig: 'gpt-5.6-luna-high', providerModel: 'gpt-5.6-luna',
          promptVersion: 'diet-intake-placement-v1', clientRequestId: 'assessment-1', responseId: null,
          finishReason: 'stop', usage: { inputTokens: 10, cachedInputTokens: null, cacheWriteInputTokens: null,
            outputTokens: 5, reasoningTokens: null, totalTokens: 15 } },
      },
    },
  };
}
