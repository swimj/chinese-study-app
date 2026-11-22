import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { extractArticle, ImportError } from './article.ts';

const maxBytes = 2 * 1024 * 1024;
const decompressors = new Map([
  ['br', brotliDecompressSync],
  ['gzip', gunzipSync],
  ['deflate', inflateSync],
]);
const tooLarge = () => new ImportError(413, 'The page is too large to import.');
const publicOnly = () => new ImportError(422, 'Enter a public HTTP or HTTPS article URL.');

function publicAddress(address: string) {
  const ip = ipaddr.parse(address);
  return ip.range() === 'unicast' && (ip instanceof ipaddr.IPv4 || ip.match(ipaddr.IPv6.parse('2000::'), 3));
}

export function publicDestination(addresses: LookupAddress[]) {
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw publicOnly();
  return addresses.find((a) => a.family === 4) ?? addresses[0];
}

export function articleUrl(raw: string, base?: URL) {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw publicOnly();
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    url.href.length > 4096 ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (isIP(host)
      ? !publicAddress(host)
      : !host.includes('.') || /\.(localhost|local|internal|onion)$/.test(host))
  )
    throw publicOnly();
  url.hash = '';
  return url;
}

// Keep the URL hostname for Host and TLS certificate verification. The socket connects using only
// the address chosen by this lookup, even if DNS changes immediately after it returns.
function openPage(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    client
      .get(
        url,
        {
          signal,
          agent: false,
          headers: {
            'User-Agent':
              'MandarinJournal/1.0 (personal reading import; https://github.com/swimj/chinese-study-app)',
            Accept: 'text/html, text/plain',
            'Accept-Encoding': 'gzip, br, deflate',
          },
          lookup(hostname, options, callback) {
            lookup(hostname, { all: true })
              .then((addresses) => {
                const address = publicDestination(addresses);
                if (options.all) callback(null, [address]);
                else callback(null, address.address, address.family);
              })
              .catch((error) => callback(error, '', 0));
          },
        },
        resolve,
      )
      .on('error', reject);
  });
}

async function pageText(response: IncomingMessage, contentType: string, mediaType: string) {
  if (Number(response.headers['content-length']) > maxBytes) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  let bytes: Buffer = Buffer.concat(chunks);
  const encoding = response.headers['content-encoding']?.trim().toLowerCase();
  if (encoding && encoding !== 'identity') {
    const decompress = decompressors.get(encoding);
    if (!decompress) throw new ImportError(422, 'The page uses an unsupported content encoding.');
    try {
      bytes = decompress(bytes, { maxOutputLength: maxBytes });
    } catch (error) {
      if (error instanceof RangeError) throw tooLarge();
      throw new ImportError(422, 'The page could not be decoded.');
    }
  }
  const declared = (s: string) => s.match(/\bcharset\s*=\s*["']?([^\s;"'\/>]+)/i)?.[1];
  const meta =
    mediaType === 'text/html'
      ? bytes
          .subarray(0, 1024)
          .toString('latin1')
          .match(/<meta\s+[^>]*\bcharset\s*=[^>]*>/i)?.[0]
      : '';
  try {
    return new TextDecoder(declared(contentType) || declared(meta || '') || 'utf-8').decode(bytes);
  } catch {
    throw new ImportError(422, 'The page uses an unsupported text encoding.');
  }
}

export async function importArticle(source: URL, open = openPage) {
  const original = articleUrl(source.href);
  let current = original;
  const signal = AbortSignal.timeout(12_000);
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      const response = await open(current, signal);
      try {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          current = articleUrl(response.headers.location, current);
          continue;
        }
        if (status < 200 || status >= 300)
          throw new ImportError(502, `The source website returned HTTP ${status}.`);
        const contentType = response.headers['content-type'] || '';
        const mediaType = contentType.split(';')[0].trim().toLowerCase();
        if (mediaType !== 'text/html' && mediaType !== 'text/plain')
          throw new ImportError(422, 'Choose an HTML article or a plain-text page.');
        return extractArticle(await pageText(response, contentType, mediaType), mediaType, original);
      } finally {
        response.destroy();
      }
    }
    throw new ImportError(422, 'The page redirected too many times.');
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (signal.aborted) throw new ImportError(504, 'The source website took too long to respond.');
    throw new ImportError(502, 'The source website could not be reached.');
  }
}
