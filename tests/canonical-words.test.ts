import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMatchByNeutralToneFallback,
  canonicalJoinKey,
  fuzzyJoinKey,
} from '../scripts/lib/canonical-words.ts';

test('canonical and fuzzy join keys differ only when tones differ', () => {
  assert.notEqual(canonicalJoinKey('啊', 'ā'), canonicalJoinKey('啊', 'a'));
  assert.equal(fuzzyJoinKey('啊', 'ā'), fuzzyJoinKey('啊', 'a'));
});

test('neutral-tone fallback allows omitted tones but rejects true tone disagreements', () => {
  assert.equal(canMatchByNeutralToneFallback('bǎo bǎo', 'bǎo bao'), true);
  assert.equal(canMatchByNeutralToneFallback('hòu miàn', 'hòu mian'), true);
  assert.equal(canMatchByNeutralToneFallback('gōng yīng liàn', 'gōng yìng liàn'), false);
  assert.equal(canMatchByNeutralToneFallback('gòu huán', 'gōu huán'), false);
  assert.equal(canMatchByNeutralToneFallback('ā', 'a'), true);
});
