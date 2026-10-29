import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assertCharacterPresentation,
  formatCardCharacters,
} from '../src/domain/card-characters.ts';

const gate = { hanzi: '门', traditional: '門' };
const sameForm = { hanzi: '学习', traditional: '学习' };
const simplifiedOnly = { hanzi: '的', traditional: null };

describe('card character presentation', () => {
  test('shows the stored hanzi for simplified, including when traditional is absent or identical', () => {
    assert.equal(formatCardCharacters(gate, 'simplified'), '门');
    assert.equal(formatCardCharacters(sameForm, 'simplified'), '学习');
    assert.equal(formatCardCharacters(simplifiedOnly, 'simplified'), '的');
    assert.equal(formatCardCharacters({ hanzi: '门', traditional: '  ' }, 'simplified'), '门');
  });

  test('shows a distinct traditional form, otherwise the stored hanzi', () => {
    assert.equal(formatCardCharacters(gate, 'traditional'), '門');
    assert.equal(formatCardCharacters(sameForm, 'traditional'), '学习');
    assert.equal(formatCardCharacters(simplifiedOnly, 'traditional'), '的');
    assert.equal(formatCardCharacters({ hanzi: '门', traditional: '' }, 'traditional'), '门');
  });

  test('shows both stored forms in the pure-cue reveal order when they differ', () => {
    assert.equal(formatCardCharacters(gate, 'both'), '门 / 門');
    assert.equal(formatCardCharacters(sameForm, 'both'), '学习');
    assert.equal(formatCardCharacters(simplifiedOnly, 'both'), '的');
  });

  test('rejects an unknown presentation', () => {
    assert.throws(
      () => assertCharacterPresentation('simplified-and-pinyin'),
      /Expected characterPresentation to be "simplified", "traditional", or "both"/,
    );
  });
});
