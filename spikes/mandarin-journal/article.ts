import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { createHash } from 'node:crypto';
import type { ReadingDocument } from './reading.ts';

export class ImportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const omitted = new Set(
  'script style noscript template nav aside footer form button iframe object embed canvas svg math audio video picture select textarea dialog'.split(
    ' ',
  ),
);
const blocks = new Set(
  'article main section div p blockquote pre ul ol li dl dt dd figure figcaption table tr td th header address'.split(
    ' ',
  ),
);
const heading = /^h[1-6]$/;
const clean = (s: string) => s.replace(/\s+/gu, ' ').trim();

function visible(el: Tree.Element) {
  return (
    !omitted.has(el.tagName) &&
    !el.attrs.some(
      ({ name, value }) =>
        name === 'hidden' ||
        name === 'inert' ||
        (name === 'aria-hidden' && value.toLowerCase() === 'true') ||
        (name === 'class' &&
          /(?:^|\s)(?:ws-noexport|ws-pagenum|mw-editsection|noprint)(?:\s|$)/.test(value)) ||
        (name === 'role' && /^(banner|navigation|complementary|contentinfo|dialog)$/i.test(value)) ||
        (name === 'style' && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(value)),
    )
  );
}

type Passage = { text: string; kind?: 'heading' };
function htmlArticle(input: string) {
  const doc = parse(input);
  let article: Tree.Element | undefined, main: Tree.Element | undefined, body: Tree.Element | undefined;
  let title = '',
    pageHeading: Tree.Element | undefined,
    wiki: Tree.Element | undefined,
    articleBody: Tree.Element | undefined;
  const transcribedPages: Tree.Element[] = [];
  const stack: Tree.ChildNode[] = [...doc.childNodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node) || !visible(node)) continue;
    if (node.tagName === 'title' && !title)
      title = clean(node.childNodes.map((n) => ('value' in n ? n.value : '')).join(''));
    const classes = node.attrs.find((a) => a.name === 'class')?.value.split(/\s+/) ?? [];
    if (classes.includes('prp-pages-output')) transcribedPages.push(node);
    if (classes.includes('mw-parser-output')) wiki ??= node;
    if (node.attrs.some((a) => a.name === 'itemprop' && a.value.split(/\s+/).includes('articleBody')))
      articleBody ??= node;
    if (node.tagName === 'h1') pageHeading ??= node;
    if (node.tagName === 'article') article ??= node;
    if (node.tagName === 'main' || node.attrs.some((a) => a.name === 'role' && a.value === 'main'))
      main ??= node;
    if (node.tagName === 'body') body = node;
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  }
  const passages: Passage[] = [];
  let buffer: string[] = [],
    activeHeading = '',
    firstTitle = '';
  function flush() {
    const text = clean(buffer.join(''));
    if (text) {
      passages.push(activeHeading ? { kind: 'heading', text } : { text });
      if (activeHeading === 'h1' && !firstTitle) firstTitle = text;
    }
    buffer = [];
  }
  function visit(node: Tree.ChildNode, depth: number) {
    if (depth > 256) throw new ImportError(422, 'The page structure is too deeply nested to import.');
    if ('value' in node) {
      buffer.push(node.value);
      return;
    }
    if (!('tagName' in node) || !visible(node)) return;
    const isHeading = heading.test(node.tagName);
    const boundary = isHeading || blocks.has(node.tagName) || node.tagName === 'br' || node.tagName === 'hr';
    if (boundary) flush();
    const parentHeading = activeHeading;
    if (isHeading) activeHeading = node.tagName;
    for (const child of node.childNodes) visit(child, depth + 1);
    if (boundary) flush();
    activeHeading = parentHeading;
  }
  // Wikisource transcriptions and structured article metadata identify the work within page furniture.
  const root = articleBody ?? wiki ?? article ?? main ?? body;
  for (const section of transcribedPages.length ? transcribedPages : root ? [root] : []) visit(section, 0);
  flush();
  if (!firstTitle && pageHeading) {
    const end = passages.length;
    visit(pageHeading, 0);
    passages.length = end;
  }
  title = firstTitle || title;
  if (passages[0]?.kind === 'heading' && passages[0].text === title) passages.shift();
  return { title, passages };
}

export function extractArticle(
  input: string,
  mediaType: string,
  url: URL,
): ReadingDocument & { sourceUrl: string } {
  const { title, passages } =
    mediaType === 'text/plain'
      ? {
          title: '',
          passages: input
            .split(/\r\n|\n|\r/)
            .map(clean)
            .filter(Boolean)
            .map((text) => ({ text })),
        }
      : htmlArticle(input);
  if (!passages.length || !passages.some((p) => !('kind' in p)))
    throw new ImportError(422, 'No readable article text was found on this page.');
  if (passages.length > 2000 || passages.reduce((n, p) => n + p.text.length, 0) > 120_000)
    throw new ImportError(413, 'This reading is too long to import.');
  const fallback = mediaType === 'text/plain' ? passages[0].text : url.hostname;
  return {
    id: 'article-' + createHash('sha256').update(url.href).digest('hex'),
    sourceUrl: url.href,
    title: (title || fallback).slice(0, 120).replace(/[\uD800-\uDBFF]$/, ''),
    kind: 'Imported reading',
    paragraphs: passages.map((passage, i) => ({ id: 'p' + (i + 1), ...passage })),
  };
}
