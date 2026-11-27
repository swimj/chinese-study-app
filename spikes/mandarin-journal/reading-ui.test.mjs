import assert from 'node:assert/strict';
import test from 'node:test';
import { renderReadingFolio } from './public/reading.js';

test('the reader folio links to the current web source and clears it when switching readings', () => {
  const folio = {
    ownerDocument: { createElement: tag => ({ tag }) },
    replaceChildren(...nodes) { this.children = nodes; },
    append(...nodes) { this.children.push(...nodes); },
  };
  const kind = 'Imported reading';
  for (const sourceUrl of ['https://books.example.org/read?id=12', 'http://example.net/chapter/2']) {
    renderReadingFolio(folio, { kind, sourceUrl });
    const link = folio.children.find(node => node.tag === 'a');
    assert.deepEqual(link, {
      tag: 'a', textContent: new URL(sourceUrl).hostname, href: sourceUrl,
      target: '_blank', rel: 'noopener noreferrer',
    });
  }
  for (const reading of [
    { kind: 'Short story' }, { kind, importMethod: 'pdf' }, { kind, sourceUrl: '/chapter/3' },
    { kind, sourceUrl: 'javascript:void(0)' }, { kind, sourceUrl: 'ftp://example.org/book' },
  ]) {
    renderReadingFolio(folio, reading);
    assert.deepEqual(folio.children, [reading.kind]);
  }
});
