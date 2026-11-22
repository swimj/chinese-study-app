import assert from 'node:assert/strict';
import test from 'node:test';
import { extractParagraphs, readPdf } from './public/pdf-import.js';

function row(str, y, x = 40, hasEOL = true) {
  return { str, transform: [12, 0, 0, 12, x, y], hasEOL, dir: 'ltr' };
}

function documentWith(...pages) {
  return {
    numPages: pages.length,
    async getPage(number) {
      return {
        async *streamTextContent() {
          for (const item of pages[number - 1]) yield { items: [item] };
        },
        cleanup() {},
      };
    },
  };
}

test('Chinese lines wrap across streamed runs and preserve indentation, paragraph spacing and page breaks', async () => {
  const pdf = documentWith([
    row('我在', 600, 40, false), row('公园里，', 600, 64), row('看 见 鸟。', 584),
    row('另一段', 568, 64), row('从这里开始。', 552),
    row('这段前面有空白。', 510),
  ], [row('第二页。', 600)]);
  assert.deepEqual(await extractParagraphs(pdf), [
    '我在公园里，看见鸟。', '另一段从这里开始。', '这段前面有空白。', '第二页。',
  ]);
});

test('mixed Latin words keep their spaces across lines without splitting a word across text runs', async () => {
  const pdf = documentWith([
    row('Se', 700, 40, false), row('quoia National', 700), row('Park（国家公园）', 685),
    row('', 650), row('下一段。', 630),
  ]);
  assert.deepEqual(await extractParagraphs(pdf), ['Sequoia National Park（国家公园）', '下一段。']);
});

test('extraction rejects empty, oversized or overlong PDFs', async () => {
  await assert.rejects(readPdf({ size: 0 }), /file is empty/);
  await assert.rejects(readPdf({ size: 21 * 1024 * 1024 }), /20 MiB/);
  await assert.rejects(extractParagraphs({ numPages: 301 }), /300 pages/);
  await assert.rejects(extractParagraphs(documentWith([], [row(' ', 100)])), /No selectable text/);
  const long = '文'.repeat(120_000);
  assert.deepEqual(await extractParagraphs(documentWith([row(long, 100)])), [long]);
  await assert.rejects(extractParagraphs(documentWith([row(long + '字', 100)])), /120,000 characters/);
  const rows = Array.from({ length: 2001 }, (_, i) => row('文', 100000 - i * 40));
  await assert.rejects(extractParagraphs(documentWith(rows)), /2,000 paragraphs/);
});
