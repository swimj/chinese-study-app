import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getAppConfig } from '../server/config.ts';

const previous = process.env.APP_STUDY_PROFILE;
afterEach(() => {
  if (previous === undefined) delete process.env.APP_STUDY_PROFILE;
  else process.env.APP_STUDY_PROFILE = previous;
});

test('the backend rejects the retired French try-out profile', () => {
  process.env.APP_STUDY_PROFILE = 'french';
  assert.throws(() => getAppConfig({ modeOverride: 'study' }), /Invalid study profile: french/);
});
