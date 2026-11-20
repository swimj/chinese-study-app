import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compatiblePromptVersions,
  isCompatiblePromptVersion,
  isCurrentReflectionArtifactContract,
} from '../src/domain/reflection-contracts.ts';

test('prompt minor versions share a major and preserve current contract compatibility', () => {
  assert.deepEqual(compatiblePromptVersions('reflection-staged-v3.1'), [
    'reflection-staged-v3', 'reflection-staged-v3.0', 'reflection-staged-v3.1',
  ]);
  assert.equal(isCompatiblePromptVersion('reflection-staged-v3', 'reflection-staged-v3.1'), true);
  assert.equal(isCompatiblePromptVersion('reflection-staged-v3.2', 'reflection-staged-v3.1'), false);
  assert.equal(isCompatiblePromptVersion('reflection-staged-v2.9', 'reflection-staged-v3.1'), false);
  assert.equal(isCompatiblePromptVersion('pure-cue-promotion-v3', 'reflection-staged-v3.1'), false);
  assert.equal(isCurrentReflectionArtifactContract({
    reflectionFlowVersion: 'initial_post_session_reflection.v6',
    bundleSchemaVersion: 'session_reflection_bundle.v6',
    resultSchemaVersion: 'session_reflection_result.v10',
    promptVersion: 'reflection-staged-v4.0',
  }), true);
  for (const [promptVersion, expected] of [
    ['reflection-staged-v4.0', true],
    ['reflection-staged-v4.1', true],
    ['reflection-staged-v4.2', true],
    ['reflection-staged-v4.3', false],
    ['reflection-staged-v5.0', true],
    ['reflection-staged-v5.1', false],
    ['reflection-staged-v4.4', false],
    ['reflection-staged-v3.2', false],
  ] as const) {
    assert.equal(isCurrentReflectionArtifactContract({
      reflectionFlowVersion: 'initial_post_session_reflection.v6',
      bundleSchemaVersion: 'session_reflection_bundle.v6',
      resultSchemaVersion: 'session_reflection_result.v10',
      promptVersion,
    }), expected, promptVersion);
  }
});
