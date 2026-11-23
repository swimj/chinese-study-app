// find_image: a read-only lookup of pictures for a term, from Wikidata and
// Wikimedia Commons only. A Wikidata item for the term gives its image (P18),
// and Commons gives the file's license, author and a thumbnail. Results are
// already filtered to the license allowlist, so nothing unlicensed reaches the
// model. Named works (items with a publication date) yield a link card instead
// of a poster or still.
import type { LicenseCode } from './model.ts';

export const USER_AGENT = 'mandarin-journal-prototype/0.1';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const MAX_CANDIDATES = 3;
const THUMB_WIDTH = 640;
const RETRIES = 2;

type Common = { entityId: string; label: string; description: string };
export type ImageCandidate = Common & {
  kind: 'image';
  pageUrl: string;
  thumbUrl: string;
  width?: number;
  height?: number;
  title: string;
  license: { code: LicenseCode; url: string };
  credit: { author: string; text: string };
};
export type LinkCandidate = Common & { kind: 'link'; pageUrl: string; title: string; year?: string };
export type Candidate = ImageCandidate | LinkCandidate;
export type FindImage = (query: string, englishQuery?: string) => Promise<Candidate[]>;
type Fetch = typeof fetch;
// Wikidata and Commons payloads are large and loosely shaped; each field used is narrowed where it is read.
type Json = any;

/** Maps Commons license metadata onto the allowlist, or undefined to exclude the file. */
export function allowedLicense(meta: Record<string, string | undefined>): { code: LicenseCode; url: string } | undefined {
  const license = (meta.License || '').toLowerCase().trim();
  const short = (meta.LicenseShortName || '').toLowerCase().trim();
  const both = license + ' ' + short;
  if (!license && !short) return undefined;
  if (/\bnc\b|-nc\b|noncommercial|\bnd\b|-nd\b|noderiv/.test(both)) return undefined;
  const url = meta.LicenseUrl?.trim();
  if (license === 'cc0' || /^cc0\b/.test(short)) return { code: 'CC0', url: url || 'https://creativecommons.org/publicdomain/zero/1.0/' };
  if (license === 'pd' || license.startsWith('pd-') || short === 'public domain')
    return { code: 'PD', url: url || 'https://creativecommons.org/publicdomain/mark/1.0/' };
  const cc = /^cc-by-(sa-)?\d/.exec(license) ?? /^cc by(-sa)? \d/.exec(short);
  if (cc && url) return { code: cc[1] ? 'CC-BY-SA' : 'CC-BY', url };
  return undefined;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
export function plainText(html: string) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => entities[e])
    .replace(/\s+/g, ' ')
    .trim();
}

/** The credit line for one Commons file: author, license and source, from its extmetadata. */
export function creditFor(meta: Record<string, string | undefined>, licenseCode: LicenseCode) {
  const author = plainText(meta.Artist || '') || plainText(meta.Credit || '') || 'Unknown author';
  const license = meta.LicenseShortName?.trim() || (licenseCode === 'PD' ? 'Public domain' : licenseCode.replace(/-/g, ' '));
  return { author, text: author + ' · ' + license + ' · Wikimedia Commons' };
}

async function getJson(fetchImpl: Fetch, base: string, params: Record<string, string>) {
  const url = new URL(base);
  for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: '2' })) url.searchParams.set(k, v);
  // Wikimedia throttles bursts from unidentified clients. Wait as asked, twice at most.
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if ((res.status === 429 || res.status === 503) && attempt < RETRIES) {
      const asked = Number(res.headers.get('retry-after') ?? NaN);
      const seconds = Number.isFinite(asked) ? Math.min(Math.max(asked, 0), 10) : 2;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      continue;
    }
    if (!res.ok) throw new Error('Lookup failed with status ' + res.status);
    return res.json() as Promise<Json>;
  }
}

async function search(fetchImpl: Fetch, query: string, language: 'zh' | 'en') {
  const data = await getJson(fetchImpl, WIKIDATA, {
    action: 'wbsearchentities', search: query, language, uselang: language, type: 'item', limit: '5',
  });
  return ((data.search ?? []) as { id: string }[]).map((r) => r.id);
}

function label(entity: Json, field: 'labels' | 'descriptions') {
  return String(entity?.[field]?.zh?.value ?? entity?.[field]?.en?.value ?? '');
}

export function createFindImage(fetchImpl: Fetch = (input, init) => fetch(input, init)): FindImage {
  return async function findImage(query, englishQuery) {
    const term = query.trim();
    if (!term) return [];
    let ids = await search(fetchImpl, term, 'zh');
    if (!ids.length) ids = await search(fetchImpl, (englishQuery || term).trim(), 'en');
    if (!ids.length) return [];
    const data = await getJson(fetchImpl, WIKIDATA, {
      action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|claims|sitelinks', languages: 'zh|en',
    });
    const files = new Map<string, Common>();
    const links: LinkCandidate[] = [];
    for (const id of ids) {
      const entity = data.entities?.[id];
      if (!entity) continue;
      const common = { entityId: id, label: label(entity, 'labels'), description: label(entity, 'descriptions') };
      const published = entity.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time as string | undefined;
      if (published) {
        // A named work: link to its article, never its poster or a still.
        const site = entity.sitelinks?.zhwiki ? ['zh', entity.sitelinks.zhwiki.title] : entity.sitelinks?.enwiki ? ['en', entity.sitelinks.enwiki.title] : undefined;
        if (site)
          links.push({
            ...common, kind: 'link', title: site[1],
            pageUrl: 'https://' + site[0] + '.wikipedia.org/wiki/' + encodeURIComponent(site[1].replace(/ /g, '_')),
            year: /^[+-]?(\d{4})/.exec(published)?.[1],
          });
        continue;
      }
      const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (typeof file === 'string' && !files.has('File:' + file)) files.set('File:' + file, common);
    }
    const images: ImageCandidate[] = [];
    if (files.size) {
      const info = await getJson(fetchImpl, COMMONS, {
        action: 'query', prop: 'imageinfo', titles: [...files.keys()].join('|'),
        iiprop: 'url|size|extmetadata', iiurlwidth: String(THUMB_WIDTH),
        iiextmetadatafilter: 'License|LicenseShortName|LicenseUrl|Artist|Credit',
      });
      const pages = (info.query?.pages ?? []) as Json[];
      const normalized = new Map<string, string>(((info.query?.normalized ?? []) as { from: string; to: string }[]).map((n) => [n.to, n.from]));
      for (const page of pages) {
        const ii = page.imageinfo?.[0];
        const common = files.get(page.title) ?? files.get(normalized.get(page.title) ?? '');
        if (!ii || !common || !ii.thumburl || !ii.descriptionurl) continue;
        const meta = Object.fromEntries(Object.entries(ii.extmetadata ?? {}).map(([k, v]) => [k, (v as { value?: unknown })?.value == null ? undefined : String((v as { value: unknown }).value)]));
        const license = allowedLicense(meta);
        if (!license) continue;
        images.push({
          ...common, kind: 'image', title: page.title, pageUrl: ii.descriptionurl, thumbUrl: ii.thumburl,
          width: ii.thumbwidth, height: ii.thumbheight, license, credit: creditFor(meta, license.code),
        });
      }
      // Keep Wikidata's relevance order.
      const order = [...files.values()].map((c) => c.entityId);
      images.sort((a, b) => order.indexOf(a.entityId) - order.indexOf(b.entityId));
    }
    return [...images, ...links].slice(0, MAX_CANDIDATES);
  };
}

export const findImage = createFindImage();
