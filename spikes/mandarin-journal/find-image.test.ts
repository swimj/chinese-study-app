import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedLicense, createFindImage, creditFor, USER_AGENT } from './media/find-image.ts';

type Meta = Record<string, string>;
const ext = (meta: Meta) => Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { value: v, source: 'commons-desc-page' }]));

// A small fake of the three Wikimedia endpoints find_image uses.
function wikimedia({ zh = [] as string[], en = [] as string[], entities = {} as Record<string, unknown>, files = {} as Record<string, Meta | null> }) {
  const requests: { url: URL; agent: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, agent: new Headers(init?.headers).get('User-Agent') });
    const p = url.searchParams;
    let body: unknown;
    if (url.host === 'www.wikidata.org' && p.get('action') === 'wbsearchentities')
      body = { search: (p.get('language') === 'zh' ? zh : en).map((id) => ({ id })) };
    else if (url.host === 'www.wikidata.org' && p.get('action') === 'wbgetentities')
      body = { entities: Object.fromEntries(p.get('ids')!.split('|').map((id) => [id, entities[id]])) };
    else if (url.host === 'commons.wikimedia.org')
      body = {
        query: {
          pages: p.get('titles')!.split('|').map((title) => {
            const meta = files[title];
            return meta === undefined
              ? { title, missing: true }
              : {
                  title,
                  imageinfo: [{
                    thumburl: 'https://upload.wikimedia.org/thumb/' + encodeURIComponent(title),
                    thumbwidth: 640, thumbheight: 480,
                    descriptionurl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(title),
                    extmetadata: meta ? ext(meta) : {},
                  }],
                };
          }),
        },
      };
    else throw new Error('Unexpected request ' + url);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, requests };
}
const item = (zh: string, file?: string, extra: Record<string, unknown> = {}) => ({
  labels: { zh: { value: zh } },
  descriptions: { en: { value: 'a thing' } },
  claims: file ? { P18: [{ mainsnak: { datavalue: { value: file } } }] } : {},
  ...extra,
});

test('licenses outside the allowlist, or missing, are excluded', () => {
  assert.deepEqual(allowedLicense({ License: 'cc-by-sa-4.0', LicenseShortName: 'CC BY-SA 4.0', LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' }), { code: 'CC-BY-SA', url: 'https://creativecommons.org/licenses/by-sa/4.0' });
  assert.equal(allowedLicense({ License: 'cc-by-2.0', LicenseUrl: 'https://creativecommons.org/licenses/by/2.0' })?.code, 'CC-BY');
  assert.equal(allowedLicense({ License: 'cc0', LicenseShortName: 'CC0' })?.code, 'CC0');
  assert.equal(allowedLicense({ License: 'pd', LicenseShortName: 'Public domain' })?.code, 'PD');
  assert.equal(allowedLicense({ LicenseShortName: 'Public domain' })?.code, 'PD');
  assert.equal(allowedLicense({ License: 'cc-by-nc-sa-4.0', LicenseShortName: 'CC BY-NC-SA 4.0', LicenseUrl: 'https://x' }), undefined);
  assert.equal(allowedLicense({ License: 'cc-by-nd-4.0', LicenseUrl: 'https://x' }), undefined);
  assert.equal(allowedLicense({ License: 'gfdl', LicenseShortName: 'GFDL' }), undefined);
  assert.equal(allowedLicense({}), undefined);
  // A CC license without its deed cannot be linked from the credit line.
  assert.equal(allowedLicense({ License: 'cc-by-4.0' }), undefined);
});

test('the credit line is assembled from extmetadata, without markup', () => {
  assert.deepEqual(
    creditFor({ Artist: '<a href="//commons.wikimedia.org/wiki/User:Lviatour">Luc Viatour</a> &amp; friends', LicenseShortName: 'CC BY-SA 3.0' }, 'CC-BY-SA'),
    { author: 'Luc Viatour & friends', text: 'Luc Viatour & friends · CC BY-SA 3.0 · Wikimedia Commons' },
  );
  assert.equal(creditFor({ Credit: '<span>Own work</span>' }, 'PD').text, 'Own work · Public domain · Wikimedia Commons');
  assert.equal(creditFor({}, 'CC0').author, 'Unknown author');
});

test('find_image goes from a Wikidata item to its licensed Commons image, zh first and then en', async () => {
  const { fetchImpl, requests } = wikimedia({
    zh: [],
    en: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
    entities: {
      Q1: item('报刊亭', 'Kiosk.jpg'),
      Q2: item('报摊', 'NonCommercial.jpg'),
      Q3: item('书报亭', 'Unlicensed.jpg'),
      Q4: item('报刊', undefined),
      Q5: item('亭', 'Pavilion.jpg'),
    },
    files: {
      'File:Kiosk.jpg': { License: 'cc-by-4.0', LicenseShortName: 'CC BY 4.0', LicenseUrl: 'https://creativecommons.org/licenses/by/4.0', Artist: 'Lt2818' },
      'File:NonCommercial.jpg': { License: 'cc-by-nc-2.0', LicenseShortName: 'CC BY-NC 2.0', LicenseUrl: 'https://x', Artist: 'A' },
      'File:Unlicensed.jpg': null,
      'File:Pavilion.jpg': { License: 'pd', LicenseShortName: 'Public domain', Artist: '<i>Unknown</i>' },
    },
  });
  const find = createFindImage(fetchImpl);
  const found = await find('报刊亭', 'newsstand');
  assert.deepEqual(found.map((c) => [c.entityId, c.kind === 'image' && c.license.code]), [['Q1', 'CC-BY'], ['Q5', 'PD']]);
  const first = found[0];
  assert.equal(first.kind, 'image');
  if (first.kind === 'image') {
    assert.equal(first.credit.text, 'Lt2818 · CC BY 4.0 · Wikimedia Commons');
    assert.equal(first.label, '报刊亭');
    assert.equal(first.title, 'File:Kiosk.jpg');
    assert.match(first.pageUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\//);
  }
  const searches = requests.filter((r) => r.url.searchParams.get('action') === 'wbsearchentities');
  assert.deepEqual(searches.map((r) => [r.url.searchParams.get('language'), r.url.searchParams.get('search')]), [['zh', '报刊亭'], ['en', 'newsstand']]);
  assert.ok(requests.every((r) => r.agent === USER_AGENT), 'every request names the prototype, with no personal details');
});

test('a named work becomes a link card, never its poster; results stop at three', async () => {
  const film = item('芳华', 'Poster.jpg', {
    claims: { P18: [{ mainsnak: { datavalue: { value: 'Poster.jpg' } } }], P577: [{ mainsnak: { datavalue: { value: { time: '+2017-12-15T00:00:00Z' } } } }] },
    sitelinks: { zhwiki: { title: '芳华 (电影)' } },
  });
  const ok = { License: 'cc0', LicenseShortName: 'CC0', Artist: 'X' };
  const { fetchImpl, requests } = wikimedia({
    zh: ['Q9', 'Q10', 'Q11', 'Q12'],
    entities: { Q9: film, Q10: item('a', 'A.jpg'), Q11: item('b', 'B.jpg'), Q12: item('c', 'C.jpg') },
    files: { 'File:A.jpg': ok, 'File:B.jpg': ok, 'File:C.jpg': ok },
  });
  const found = await createFindImage(fetchImpl)('芳华');
  assert.equal(found.length, 3);
  assert.ok(!requests.some((r) => r.url.searchParams.get('titles')?.includes('Poster.jpg')));
  const link = (await createFindImage(wikimedia({ zh: ['Q9'], entities: { Q9: film } }).fetchImpl)('芳华'))[0];
  assert.deepEqual(link, {
    kind: 'link', entityId: 'Q9', label: '芳华', description: 'a thing', title: '芳华 (电影)', year: '2017',
    pageUrl: 'https://zh.wikipedia.org/wiki/' + encodeURIComponent('芳华_(电影)'),
  });
  assert.deepEqual(await createFindImage(wikimedia({}).fetchImpl)('透透气'), []);
});

test('a throttled lookup waits as asked and retries', async () => {
  const { fetchImpl } = wikimedia({ zh: ['Q1'], entities: { Q1: item('报刊亭', 'Kiosk.jpg') }, files: { 'File:Kiosk.jpg': { License: 'cc0', Artist: 'A' } } });
  let throttled = 0;
  const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
    if (throttled++ < 2) return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
    return fetchImpl(input, init);
  }) as typeof fetch;
  const found = await createFindImage(flaky)('报刊亭');
  assert.equal(found.length, 1);
  const always = (async () => new Response('no', { status: 429, headers: { 'retry-after': '0' } })) as typeof fetch;
  await assert.rejects(createFindImage(always)('报刊亭'), /status 429/);
});
