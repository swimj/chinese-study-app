import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { REFLECTION_MODEL_ARMS, isReflectionModelChoice } from '../server/reflection/model-arms.ts';

describe('reflection comparison-arm registry', () => {
  test('registers six equally weighted default comparison arms', () => {
    const choices = REFLECTION_MODEL_ARMS.map((arm) => arm.choice);
    assert.deepEqual(choices.slice(-4), [
      'openrouter:gemini-3.6-flash',
      'openrouter:deepseek-v4-pro',
      'openrouter:claude-sonnet-5',
      'openai:gpt-5.6-terra-high',
    ]);
    assert.equal(isReflectionModelChoice('openrouter:claude-sonnet-5'), true);
    assert.equal(isReflectionModelChoice('openrouter:grok-4.5'), false);
    assert.deepEqual(
      REFLECTION_MODEL_ARMS.filter((arm) => arm.enabledByDefault).map((arm) => arm.choice),
      [
        'openai:gpt-5.6-luna-high',
        'zai:glm-5.3-high',
        'dashscope:qwen3.8-max',
        'openrouter:gemini-3.6-flash',
        'openrouter:deepseek-v4-pro',
        'openrouter:claude-sonnet-5',
      ],
    );
    assert.ok(
      REFLECTION_MODEL_ARMS
        .filter((arm) => arm.enabledByDefault)
        .every((arm) => arm.dogfoodSelectionWeight === 1),
    );
  });

  test('pins Claude to Anthropic for native JSON-schema output', () => {
    const claudeArm = REFLECTION_MODEL_ARMS.find((arm) => (
      arm.choice === 'openrouter:claude-sonnet-5'
    ));
    assert.deepEqual(claudeArm?.config?.additionalRequestBody, {
      provider: {
        order: ['anthropic'],
        allow_fallbacks: false,
        require_parameters: true,
      },
    });

    for (const arm of REFLECTION_MODEL_ARMS) {
      if (!arm.choice.startsWith('openrouter:') || arm.choice === 'openrouter:claude-sonnet-5') {
        continue;
      }
      assert.equal(arm.config?.additionalRequestBody, undefined);
    }
  });
});
