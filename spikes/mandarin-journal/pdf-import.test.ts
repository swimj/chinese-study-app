import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { actionSchema, openJournal } from './journal.ts';
import { ImportError } from './article.ts';
import type { TurnContext } from './tutor.ts';

function pdf(paragraphs: string[], fingerprint = 'a'.repeat(64)) {
  return { id: randomUUID(), type: 'importPdf' as const, fingerprint, title: '河边', paragraphs };
}

test('a PDF and its anchors survive restart, renaming the file, and another PDF with the same title', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'journal-pdf-'));
  const file = join(directory, 'journal.sqlite');
  let lastContext: TurnContext | undefined;
  const backend = {
    mode: 'demo' as const,
    friend: async (ctx: TurnContext) => {
      lastContext = ctx;
      return '后来呢？';
    },
    tutor: async (ctx: TurnContext) => {
      lastContext = ctx;
      return { reply: '可以。', action: null };
    },
  };
  let journal = openJournal(file, backend);
  try {
    const middle = Array<string>(80).fill('春天。'.repeat(60));
    const paragraphs = ['  我走到河边。  ', ' ', '风吹过来了。', ...middle, '我回家了。'];
    const request = pdf(paragraphs);
    const state = await journal.act(request);
    const doc = state.reading.documents.at(-1)!;
    assert.equal(doc.id, 'pdf-' + request.fingerprint);
    assert.equal(doc.id, state.reading.documentId);
    assert.equal(doc.importMethod, 'pdf');
    assert.equal('sourceUrl' in doc, false);
    assert.deepEqual(doc.paragraphs.slice(0, 2), [
      { id: 'p1', text: '我走到河边。' }, { id: 'p2', text: '风吹过来了。' },
    ]);
    assert.deepEqual(await journal.act(request), state);

    const last = doc.paragraphs.at(-1)!;
    const place = { documentId: doc.id, paragraphId: last.id };
    await journal.act({ type: 'readingPosition', id: randomUUID(), ...place });
    const note = randomUUID();
    await journal.act({ type: 'annotate', id: note, ...place, quote: '回家', text: '旅途的结束' });
    const save = {
      type: 'saveReading' as const, id: randomUUID(), title: doc.title, detail: doc.title, source: doc.id,
    };
    const saved = (await journal.act(save)).saved.at(-1)!;
    assert.equal(saved.reference?.id, doc.id);
    assert.ok(saved.detail.startsWith('我走到河边。 风吹过来了。'));
    assert.equal(Array.from(saved.detail).length, 221);

    const second = await journal.act(pdf(['大家好。'], 'b'.repeat(64)));
    const secondId = second.reading.documentId;
    assert.notEqual(secondId, doc.id);
    assert.equal(second.reading.documents.at(-1)!.title, doc.title);
    const both = await journal.act({ ...save, id: randomUUID(), source: secondId });
    assert.deepEqual(both.saved.map(item => item.reference?.id), [doc.id, secondId]);

    journal.close();
    journal = openJournal(file, backend);
    const again = await journal.act({ ...request, id: randomUUID(), title: '新文件名' });
    assert.equal(again.reading.documentId, doc.id);
    assert.equal(again.reading.documents.length, state.reading.documents.length + 1);
    assert.deepEqual(again.reading.documents.find(d => d.id === doc.id), doc);
    assert.equal(again.reading.positions[doc.id], last.id);
    assert.equal(again.reading.annotations[0].documentId, doc.id);
    await journal.act({
      type: 'annotationPost', id: randomUUID(), annotationId: note, message: '解释一下', askTutor: true,
    });
    assert.match(lastContext!.readingContext!, /我回家了。/);
    assert.match(lastContext!.readingContext!, /旅途的结束/);

    await journal.act({ type: 'newThread', id: randomUUID(), title: doc.title, source: doc.id });
    await journal.act({ type: 'chat', id: randomUUID(), message: '后来呢？', source: doc.id });
    assert.ok(lastContext!.source.length < 6300);
    assert.ok(lastContext!.source.endsWith(last.text));
    assert.ok(!lastContext!.source.includes('我走到河边。'));
  } finally {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('PDF imports validate the fingerprint, title, text and paragraph limits before changing the reading', async () => {
  const request = pdf(['内容']);
  const invalid = [
    { fingerprint: 'a'.repeat(63) }, { fingerprint: 'A'.repeat(64) }, { fingerprint: 'g'.repeat(64) },
    { title: ' ' }, { title: '题'.repeat(121) }, { paragraphs: ['内容', 1] },
  ];
  for (const fields of invalid) assert.equal(actionSchema.safeParse({ ...request, ...fields }).success, false);
  const journal = openJournal(':memory:');
  try {
    const before = journal.get();
    const invalidText: [string[], number][] = [
      [[], 422],
      [['  ', '——', '\uFFFD'], 422],
      [['字'.repeat(120_001)], 413],
      [Array<string>(2001).fill('字'), 413],
    ];
    for (const [paragraphs, status] of invalidText) {
      await assert.rejects(
        journal.act(pdf(paragraphs)),
        (error: unknown) => error instanceof ImportError && error.status === status,
      );
      assert.deepEqual(journal.get(), before);
    }
    const boundary = await journal.act(actionSchema.parse({
      ...request, title: ' 标题 ', paragraphs: Array<string>(2000).fill('字'.repeat(60)),
    }));
    assert.equal(boundary.reading.documents.at(-1)!.title, '标题');
    assert.equal(boundary.reading.documents.at(-1)!.paragraphs.length, 2000);
  } finally {
    journal.close();
  }
});
