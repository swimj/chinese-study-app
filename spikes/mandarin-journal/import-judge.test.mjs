import assert from 'node:assert/strict';
import test from 'node:test';

test('import judge sends a single bounded excerpt and requires quoted paragraph evidence for a block', async (t) => {
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.JOURNAL_IMPORT_MODEL = 'fixture-model';
  const sample = {
    title: '标题',
    paragraphs: ['为了继续阅读，请完成以下验证。', 'See https://example.org/secret?a=b for details.', '字'.repeat(600),
      ...Array(6).fill('结尾')],
    sourceUrl: 'https://private.example/',
    history: ['private conversation'],
  };
  let reply;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:1/v1/responses');
    const request = JSON.parse(options.body);
    requests++;
    assert.equal(request.model, 'fixture-model');
    assert.equal(request.store, false);
    assert.equal(request.max_output_tokens, 512);
    assert.equal(request.tools?.length ?? 0, 0);
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    assert.equal(request.input.filter((item) => item.role === 'user').length, 1);
    const input = JSON.parse(request.input.find((item) => item.role === 'user').content);
    assert.deepEqual(Object.keys(input).sort(), ['paragraphs', 'title']);
    assert.equal(input.paragraphs.length, 8);
    assert.equal(input.paragraphs[2].length, 500);
    assert.doesNotMatch(JSON.stringify(input), /example|secret|private conversation/);
    return Response.json({
      id: 'resp_fixture', object: 'response', status: 'completed',
      output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', annotations: [], text: JSON.stringify(reply) }] }],
      usage: { input_tokens: 8, output_tokens: 6, total_tokens: 14 },
    });
  });
  const { judgeImport } = await import('./import-judge.ts');
  const cases = [
    ['verification', '请完成以下验证', 'verification'],
    ['access', '请先登录', 'uncertain'],
    ['unavailable', '', 'uncertain'],
    ['access', sample.title, 'uncertain'],
    ['reading', '', 'reading'],
    ['uncertain', '', 'uncertain'],
  ];
  for (const [verdict, quote, expected] of cases) {
    reply = { verdict, quote };
    assert.equal(await judgeImport(sample), expected);
  }
  assert.equal(await judgeImport({ title: '标题', paragraphs: [] }), 'uncertain');
  assert.equal(requests, cases.length);
});
