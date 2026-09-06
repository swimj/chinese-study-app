import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { REFLECTION_MODEL_ARMS, isReflectionModelChoice } from '../server/reflection/model-arms.ts';

describe('reflection comparison-arm registry', () => {
  test('registers four equally weighted default comparison arms', () => {
    const choices = REFLECTION_MODEL_ARMS.map((arm) => arm.choice);
    assert.deepEqual(choices, [
      'openai:gpt-5.6-luna-high',
      'zai:glm-5.3-high',
      'openrouter:gemini-3.6-flash',
      'openai:gpt-5.6-terra-high',
    ]);
    assert.equal(isReflectionModelChoice('openai:gpt-5.6-terra-high'), true);
    assert.equal(isReflectionModelChoice('openrouter:claude-sonnet-5'), false);
    assert.equal(isReflectionModelChoice('dashscope:qwen3.8-max'), false);
    assert.equal(isReflectionModelChoice('openrouter:deepseek-v4-pro'), false);
    assert.equal(isReflectionModelChoice('openrouter:grok-4.5'), false);
    assert.deepEqual(
      REFLECTION_MODEL_ARMS.filter((arm) => arm.enabledByDefault).map((arm) => arm.choice),
      [
        'openai:gpt-5.6-luna-high',
        'zai:glm-5.3-high',
        'openrouter:gemini-3.6-flash',
        'openai:gpt-5.6-terra-high',
      ],
    );
    assert.ok(
      REFLECTION_MODEL_ARMS
        .filter((arm) => arm.enabledByDefault)
        .every((arm) => arm.dogfoodSelectionWeight === 1),
    );
  });

  test('does not pin OpenRouter arms to one upstream host', () => {
    for (const arm of REFLECTION_MODEL_ARMS) {
      if (!arm.choice.startsWith('openrouter:')) continue;
      assert.equal(arm.config?.additionalRequestBody, undefined);
    }
  });
});
