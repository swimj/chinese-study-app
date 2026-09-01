import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbModule: DbModule;

describe('learner identity bootstrap', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-learner-identity-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousLearnerId = process.env.APP_LEARNER_ID;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    process.env.APP_LEARNER_ID = 'dogfood-owner';

    dbModule = await import(
      `${pathToFileURL(path.resolve('server/db.ts')).href}?test=learner-identity-${Date.now()}`
    );

    restoreEnv('APP_MODE', previousMode);
    restoreEnv('APP_DATA_DIR', previousDataDir);
    restoreEnv('APP_LEARNER_ID', previousLearnerId);
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('creates a stable trusted-local mapping for a fresh configured learner', () => {
    assert.equal(
      dbModule.resolveLearnerId(dbModule.LOCAL_AUTH_PROVIDER, 'dogfood-owner'),
      'dogfood-owner',
    );
  });

  test('can explicitly bootstrap another learner without an auth registration flow', () => {
    dbModule.bootstrapLearner({
      learnerId: 'second-learner',
      displayName: 'Second Learner',
    });

    assert.equal(
      dbModule.resolveLearnerId(dbModule.LOCAL_AUTH_PROVIDER, 'second-learner'),
      'second-learner',
    );
  });

  test('binds an external subject without replacing either side of an existing identity', () => {
    assert.equal(dbModule.bindExternalLearnerIdentity({
      provider: dbModule.CLERK_AUTH_PROVIDER,
      providerSubject: 'clerk-dogfood',
      learnerId: 'dogfood-owner',
      createdAt: '2026-09-01T08:00:00.000Z',
    }), 'bound');
    assert.equal(dbModule.bindExternalLearnerIdentity({
      provider: dbModule.CLERK_AUTH_PROVIDER,
      providerSubject: 'clerk-dogfood',
      learnerId: 'dogfood-owner',
      createdAt: '2026-09-01T08:01:00.000Z',
    }), 'already_bound');
    assert.equal(
      dbModule.resolveLearnerId(dbModule.LOCAL_AUTH_PROVIDER, 'dogfood-owner'),
      'dogfood-owner',
    );

    assert.equal(dbModule.bindExternalLearnerIdentity({
      provider: dbModule.CLERK_AUTH_PROVIDER,
      providerSubject: 'clerk-second',
      learnerId: 'second-learner',
    }), 'bound');
    assert.throws(() => dbModule.bindExternalLearnerIdentity({
      provider: dbModule.CLERK_AUTH_PROVIDER,
      providerSubject: 'clerk-second',
      learnerId: 'dogfood-owner',
    }), /already bound to learner "second-learner"/);
    assert.throws(() => dbModule.bindExternalLearnerIdentity({
      provider: dbModule.CLERK_AUTH_PROVIDER,
      providerSubject: 'another-dogfood-subject',
      learnerId: 'dogfood-owner',
    }), /already bound to another clerk subject/);
    assert.equal(
      dbModule.resolveLearnerId(dbModule.CLERK_AUTH_PROVIDER, 'clerk-dogfood'),
      'dogfood-owner',
    );
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
