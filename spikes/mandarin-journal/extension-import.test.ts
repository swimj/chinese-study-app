import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openJournal } from './journal.ts';

const page = {
  sourceUrl: 'https://example.org/river#start', title: '河边',
  paragraphs: [{ text: '傍晚', kind: 'heading' as const }, { text: '风吹过来。' }],
};

test('Chrome returns the exact saved snapshot on concurrent imports, retries and restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-chrome-import-'));
  const path = join(dir, 'journal.sqlite');
  let journal = openJournal(path);
  try {
    const initial = journal.get().reading;
    const [first, duplicate] = await Promise.all([journal.importFromExtension(page), journal.importFromExtension(page)]);
    assert.deepEqual(duplicate, first);
    const changed = await journal.importFromExtension({ ...page, paragraphs: [{ text: '另一段。' }] });
    assert.notEqual(changed.documentId, first.documentId);
    const otherUrl = await journal.importFromExtension({ ...page, sourceUrl: 'https://example.org/another' });
    assert.notEqual(otherUrl.documentId, first.documentId);
    const reading = journal.get().reading;
    assert.equal(reading.documentId, initial.documentId);
    assert.deepEqual(reading.positions, initial.positions);
    assert.equal(reading.documents.length, initial.documents.length + 3);
    const doc = reading.documents.find(d => d.id === first.documentId)!;
    assert.equal(doc.title, page.title);
    assert.equal(doc.sourceUrl, 'https://example.org/river');
    assert.deepEqual(doc.paragraphs, [
      { id: 'p1', text: '傍晚', kind: 'heading' }, { id: 'p2', text: '风吹过来。' },
    ]);
    // An extension-opened tab keeps progress without choosing a reading for another tab.
    await journal.act({ id: randomUUID(), type: 'readingPosition', documentId: first.documentId, paragraphId: 'p2', bookmarkOnly: true });
    assert.equal(journal.get().reading.documentId, initial.documentId);
    await journal.act({ id: randomUUID(), type: 'readingPosition', documentId: changed.documentId, paragraphId: 'p1' });
    journal.close();
    journal = openJournal(path);
    assert.deepEqual(await journal.importFromExtension({ ...page, sourceUrl: 'https://example.org/river#end', title: '新标题' }), first);
    const after = journal.get().reading;
    assert.equal(after.documentId, changed.documentId);
    assert.equal(after.positions[first.documentId], 'p2');
    assert.deepEqual(after.documents, reading.documents);
  } finally {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Chrome reuses matching older imports and validates the source and body before saving', async () => {
  const journal = openJournal(':memory:');
  try {
    const pasted = await journal.act({ id: randomUUID(), type: 'importReading', url: page.sourceUrl, pastedText: '风吹过来。' });
    const original = pasted.reading.documentId;
    const input = { ...page, paragraphs: [{ text: ' 风吹过来。 ' }] };
    assert.deepEqual(await journal.importFromExtension(input), { documentId: original });
    const { documentId: selection } = await journal.importFromExtension({ ...input, paragraphs: [{ text: '风吹' }] });
    assert.notEqual(selection, original);
    const reopened = await journal.act({ id: randomUUID(), type: 'importReading', url: page.sourceUrl });
    assert.equal(reopened.reading.documentId, original);
    for (const sourceUrl of ['javascript:alert(0)', 'file:///tmp/article', 'https://me:secret@example.org/book']) {
      await assert.rejects(journal.importFromExtension({ ...input, sourceUrl }), { status: 422 });
    }
    await assert.rejects(journal.importFromExtension({ ...input, paragraphs: [{ text: '  ' }] }), { status: 422 });
    await assert.rejects(journal.importFromExtension({ ...input, paragraphs: Array(2001).fill({ text: '一' }) }), { status: 413 });
    assert.deepEqual(journal.get().reading, reopened.reading);
  } finally {
    journal.close();
  }
});
