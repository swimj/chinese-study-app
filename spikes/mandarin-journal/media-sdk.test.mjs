import assert from 'node:assert/strict';
import test from 'node:test';

test('the real SDK runs mediaConsider with find_image only, outside the tutor voice, and validates the pick', async () => {
  process.env.OPENAI_API_KEY = 'placeholder';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.OPENAI_AGENTS_DISABLE_TRACING = '1';
  const requests = [];
  const lookups = [];
  let replies = [];
  const structured = (output) => ({
    type: 'message', role: 'assistant', status: 'completed', id: 'msg_1',
    content: [{ type: 'output_text', annotations: [], text: JSON.stringify(output) }],
  });
  const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.host !== '127.0.0.1:1') {
      lookups.push({ url, agent: new Headers(options?.headers).get('User-Agent') });
      const p = url.searchParams;
      if (p.get('action') === 'wbsearchentities') return json({ search: [{ id: 'Q1528905' }] });
      if (p.get('action') === 'wbgetentities')
        return json({ entities: { Q1528905: { labels: { zh: { value: '報攤' } }, descriptions: { zh: { value: '賣報紙的人或店舖' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Kiosk.jpg' } } }] } } } });
      return json({ query: { pages: [{ title: 'File:Kiosk.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/k.jpg', thumbwidth: 640, thumbheight: 427, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Kiosk.jpg', extmetadata: { License: { value: 'cc-by-4.0' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' }, Artist: { value: 'Lt2818' } } }] }] } });
    }
    const req = JSON.parse(options.body);
    requests.push(req);
    const out = replies.shift();
    assert(out, 'unexpected model turn');
    return json({ id: 'resp_' + requests.length, object: 'response', status: 'completed', output: [out], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } });
  };
  const { tutorTurn } = await import('./tutor.ts');
  const { validateTurn, voice } = await import('./situations/index.ts');
  const judgment = {
    referent: 'concrete', senseMatch: 'entity', addedValue: 'cultural', truthfulness: 'real', tone: 'fits',
    reasons: { referent: 'A kiosk.', senseMatch: 'The newsstand item.', addedValue: 'Chinese kiosks look different.', truthfulness: 'A photograph.', tone: 'Neutral.' },
  };
  const input = {
    trigger: 'mediaConsider', message: '旧报刊亭', surface: 'media', source: '', tutorHistory: [{ role: 'user', text: 'private tutor exchange' }],
    chatHistory: [], saved: [],
    media: { anchor: { kind: 'annotation', id: 'n1' }, term: '旧报刊亭', note: 'The green kiosks', context: '河边那座旧报刊亭关了三年。', source: '河边的报刊亭', candidates: [] },
  };
  replies = [
    { type: 'function_call', call_id: 'call_1', id: 'fc_1', name: 'find_image', arguments: JSON.stringify({ query: '报刊亭', english: 'newsstand' }), status: 'completed' },
    structured({ media: { pick: 0, judgment } }),
  ];
  const result = await tutorTurn(input);
  assert.deepEqual(result, { media: { pick: 0, judgment } });
  const outcome = validateTurn('mediaConsider', result, input);
  assert.equal(outcome.ceiling, 'placed');
  assert.equal(outcome.candidate.credit.text, 'Lt2818 · CC BY 4.0 · Wikimedia Commons');

  const [first, second] = requests;
  assert.ok(!first.instructions.includes(voice), 'the back office does not speak as the tutor');
  assert.deepEqual(first.tools.map((t) => t.name), ['find_image']);
  assert.deepEqual(first.text.format.schema.required, ['media']);
  const payload = JSON.parse(first.input.find((item) => item.role === 'user').content);
  assert.deepEqual(payload, { trigger: 'mediaConsider', piece: { kind: 'annotation', term: '旧报刊亭', note: 'The green kiosks', context: '河边那座旧报刊亭关了三年。', source: '河边的报刊亭' } });
  assert.doesNotMatch(JSON.stringify(first.input), /private tutor exchange/);
  // The tool result the model saw: indexed, licensed candidates.
  assert.match(JSON.stringify(second.input), /\\"index\\":0.*\\"license\\":\\"CC-BY\\"/);
  assert.ok(lookups.length === 3 && lookups.every((l) => l.agent === 'mandarin-journal-prototype/0.1'));
});
