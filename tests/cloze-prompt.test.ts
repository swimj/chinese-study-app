import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { ClozePrompt } from '../src/features/session/ClozePrompt.tsx';

function render(text: string, answer: string | null = null) {
  return renderToStaticMarkup(createElement(ClozePrompt, { text, answer }));
}

for (const marker of ['_', '__', '___', '____', '_____', '________', '＿', '＿＿＿', '_ ＿ _',
  '()', '( )', '（ ）', '（　）', '( __ )', '（＿＿＿）', '[]', '[ ]', '［　］', '【 】', '【___】']) {
  test(`normalizes ${JSON.stringify(marker)} before recall and fills it once on reveal`, () => {
    const text = `这个 ${marker} 是要填写的。`;
    assert.equal(render(text), '这个 ____ 是要填写的。');
    assert.equal(render(text, ''), '这个 ____ 是要填写的。');
    assert.equal(render(text, '词'), '<span>这个 </span><span><mark class="desk-cloze-answer">词</mark> 是要填写的。</span>');
  });
}

test('fills repeated mixed markers without consuming framing or punctuation', () => {
  const text = 'Report the plan (bàobèi), 2 times:\n📍_以后还要（ ）。';
  assert.equal(render(text), 'Report the plan (bàobèi), 2 times:\n📍____以后还要____。');
  const revealed = render(text, '报备');
  assert.equal((revealed.match(/desk-cloze-answer/g) ?? []).length, 2);
  assert.match(revealed, /Report the plan \(bàobèi\), 2 times:\n📍/);
  assert.doesNotMatch(revealed, /____|（/);
});

test('does not merge blanks on separate lines', () => {
  assert.equal(render('先_\n__。'), '先____\n____。');
  assert.equal((render('先_\n__。', '报备').match(/desk-cloze-answer/g) ?? []).length, 2);
});

test('leaves missing or ambiguous markers, ordinary text, and punctuation unfilled', () => {
  for (const text of ['', '这个是要填写的。', 'English frame: bàobèi, 2026, 50%.',
    '他说：“等一下……再来——好吗？”', '这个（说明）是补充。[提示]【词义】',
    '这个（ 是要填写的。', '□ / ??? / * / <blank>',
    'snake_case foo____bar bàobèi＿cí 1_000', '先（\n）再说。']) {
    assert.equal(render(text), text.replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
    assert.equal(render(text, '词'), render(text));
  }
});

test('preserves nonempty brackets and literal underscores alongside a real blank', () => {
  const text = 'Use foo____bar (bàobèi): 这个（ ）之后[说明]。';
  assert.equal(render(text), 'Use foo____bar (bàobèi): 这个____之后[说明]。');
  const revealed = render(text, '词');
  assert.equal((revealed.match(/desk-cloze-answer/g) ?? []).length, 1);
  assert.match(revealed, /foo____bar \(bàobèi\)/);
  assert.match(revealed, /之后\[说明\]。/);
});

test('renders cue and answer as escaped text', () => {
  const revealed = render('<script>____</script>', '<b>词</b>');
  assert.match(revealed, /&lt;script&gt;/);
  assert.match(revealed, /&lt;b&gt;词&lt;\/b&gt;/);
  assert.doesNotMatch(revealed, /<script>|<b>/);
});
