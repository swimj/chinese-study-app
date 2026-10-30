import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderHttpError, ProviderInvalidResponseError, ProviderTimeoutError } from '../server/llm/types.ts';
import { isSenseMappingAvailabilityFailure } from '../server/vocabulary/sense-mapping-retry.ts';

for (const status of [400,401,403,404,408,422,429,500,503]) {
  test(`mapping availability classification for HTTP ${status}`,()=>{
    assert.equal(isSenseMappingAvailabilityFailure(new ProviderHttpError('provider',status,'private body',new Headers())),
      [401,403,408,429,500,503].includes(status));
  });
}
test('mapping retries recognized timeout/network failures, but preserves response and programmer errors',()=>{
  assert.equal(isSenseMappingAvailabilityFailure(new ProviderTimeoutError('openai',100)),true);
  assert.equal(isSenseMappingAvailabilityFailure(new TypeError('fetch failed')),true);
  assert.equal(isSenseMappingAvailabilityFailure(new Error('fetch failed',{cause:Object.assign(new Error('network'),{code:'ECONNRESET'})})),true);
  for (const error of [new ProviderInvalidResponseError('invalid response'),new SyntaxError('Invalid JSON'),new TypeError('programmer error'),new Error('Invalid mapping outcome')]) {
    assert.equal(isSenseMappingAvailabilityFailure(error),false);
  }
});
