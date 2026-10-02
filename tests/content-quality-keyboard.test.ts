import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qualityVoteForKey, type QualityKeyEvent } from '../src/features/content-quality/keyboard.ts';

const event: QualityKeyEvent = {
  key: ']', repeat: false, isComposing: false, keyCode: 0,
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false,
};
test('quality shortcuts are distinct from learning ratings and toggle only unmodified brackets', () => {
  assert.equal(qualityVoteForKey(event, false), 'up');
  assert.equal(qualityVoteForKey({ ...event, key: '[' }, false), 'down');
  for (const key of ['1', '2', '3', '4', ' ', 'Enter', 'u', 'z', 'e', '?']) {
    assert.equal(qualityVoteForKey({ ...event, key }, false), null);
  }
});
test('quality shortcuts never intercept typing, IME, repeat, or modified/handled events', () => {
  assert.equal(qualityVoteForKey(event, true), null);
  for (const flag of ['repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'defaultPrevented'] as const) {
    assert.equal(qualityVoteForKey({ ...event, [flag]: true }, false), null);
  }
  assert.equal(qualityVoteForKey({ ...event, keyCode: 229 }, false), null);
});
