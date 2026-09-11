import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PROVIDER_REQUEST_TIMEOUT_MS } from '../server/llm/types.ts';
import { GLM_REFLECTION_MODEL_CONFIG } from '../server/reflection/glm-provider.ts';
import { LUNA_REFLECTION_MODEL_CONFIG } from '../server/reflection/luna-provider.ts';
import {
  REFLECTION_MODEL_ARMS,
  isOfferedReflectionModelChoice,
  isReflectionModelChoice,
} from '../server/reflection/model-arms.ts';

describe('reflection comparison-arm registry', () => {
  test('registers four comparison arms and offers three by default', () => {
    const choices = REFLECTION_MODEL_ARMS.map((arm) => arm.choice);
    assert.deepEqual(choices, [
      'openai:gpt-5.6-luna-high',
      'zai:glm-5.3-high',
      'openrouter:gemini-3.6-flash',
      'openai:gpt-5.6-terra-high',
    ]);
    assert.equal(isReflectionModelChoice('openai:gpt-5.6-terra-high'), true);
    assert.equal(isReflectionModelChoice('openrouter:gemini-3.6-flash'), true);
    assert.equal(isOfferedReflectionModelChoice('openai:gpt-5.6-terra-high'), true);
    assert.equal(isOfferedReflectionModelChoice('openrouter:gemini-3.6-flash'), false);
    assert.equal(isReflectionModelChoice('openrouter:claude-sonnet-5'), false);
    assert.equal(isReflectionModelChoice('dashscope:qwen3.8-max'), false);
    assert.equal(isReflectionModelChoice('openrouter:deepseek-v4-pro'), false);
    assert.equal(isReflectionModelChoice('openrouter:grok-4.5'), false);
    assert.deepEqual(
      REFLECTION_MODEL_ARMS.filter((arm) => arm.enabledByDefault).map((arm) => arm.choice),
      [
        'openai:gpt-5.6-luna-high',
        'zai:glm-5.3-high',
        'openai:gpt-5.6-terra-high',
      ],
    );
    assert.equal(
      REFLECTION_MODEL_ARMS.find((arm) => arm.choice === 'openrouter:gemini-3.6-flash')?.enabledByDefault,
      false,
    );
    assert.ok(
      REFLECTION_MODEL_ARMS
        .filter((arm) => arm.enabledByDefault)
        .every((arm) => arm.dogfoodSelectionWeight === 1),
    );
  });

  test('uses the shared 15-minute provider timeout for every registered arm', () => {
    assert.equal(PROVIDER_REQUEST_TIMEOUT_MS, 900_000);
    assert.equal(LUNA_REFLECTION_MODEL_CONFIG.timeoutMs, PROVIDER_REQUEST_TIMEOUT_MS);
    assert.equal(GLM_REFLECTION_MODEL_CONFIG.timeoutMs, PROVIDER_REQUEST_TIMEOUT_MS);
    for (const arm of REFLECTION_MODEL_ARMS) {
      if (arm.config === null) continue;
      assert.equal(arm.config.timeoutMs, PROVIDER_REQUEST_TIMEOUT_MS, arm.choice);
    }
  });

  test('does not pin OpenRouter arms to one upstream host', () => {
    for (const arm of REFLECTION_MODEL_ARMS) {
      if (!arm.choice.startsWith('openrouter:')) continue;
      assert.equal(arm.config?.additionalRequestBody, undefined);
    }
  });
});
