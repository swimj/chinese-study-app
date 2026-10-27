import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderHttpError } from '../server/llm/types.ts';
import { preparationProviderFailure } from '../server/word-content/provider-failure.ts';

for (const status of [400,401,403,404,429,500,503]) test(`preparation classifies HTTP ${status} without leaking its body`, () => {
  const error = preparationProviderFailure(new ProviderHttpError('provider',status,'secret bearer abc123',new Headers()));
  assert.equal(error.providerWide,[401,403,429,500,503].includes(status));
  assert.equal(error.message,`Provider returned HTTP ${status}.`);
  assert.doesNotMatch(JSON.stringify(error),/abc123/);
});
for (const name of ['TimeoutError','AbortError','Error']) test(`preparation treats ${name} as a provider outage`, () => {
  const input = new Error('secret bearer abc123'); input.name = name;
  const error = preparationProviderFailure(input);
  assert.equal(error.providerWide,true);
  assert.doesNotMatch(error.message,/abc123/);
});
for (const message of ['Introduction generation returned invalid JSON.','Introduction generation returned an invalid structure.',
  'Introduction generation output was truncated.','Vocabulary practice output is invalid or incomplete']) {
  test(`${message} does not pause unrelated work`, () => {
    assert.equal(preparationProviderFailure(new Error(message)).providerWide,false);
  });
}
