import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { extractArticle } from './article.ts';
import { createImportReviewer, ImportError, ImportPreview, inspectReading } from './import-validation.ts';
import { openJournal } from './journal.ts';

const url = new URL('https://mp.weixin.qq.com/s/test');
const gate = extractArticle('<main>环境异常<p>当前环境异常，完成验证后即可继续访问。</p><p>去验证</p></main>', 'text/html', url);
const ambiguous = extractArticle('<h1>Archive</h1><p>Please sign in if you want more.</p>', 'text/html', url);
const reading = extractArticle('<h1>小雨</h1><p>下了一场雨。街上安静了。</p>', 'text/html', url);

test('identifies page-level obstacles while permitting genuine short readings', () => {
  assert.equal(inspectReading(gate), 'verification');
  assert.equal(inspectReading(reading), 'reading');
  assert.equal(inspectReading({title:'春晓',paragraphs:[{text:'春眠不觉晓'}]}), 'reading');
  for (const [text, expected] of [['该内容已被发布者删除。','unavailable'],['Please log in to continue.','access']]) {
    assert.equal(inspectReading({title:'',paragraphs:[{text}]}), expected);
  }
  assert.throws(() => extractArticle('<h1>Page not found</h1>', 'text/html', url), /unavailable/);
  assert.equal(inspectReading({title:'周记',paragraphs:[{text:'他读着屏幕上的提示。'},{text:'Please verify you are human.'}]}), 'uncertain');
});

test('reserves the judge for ambiguous output and preserves choice when it is offline or inconclusive', async () => {
  let candidate = gate, downloads = 0, calls = 0;
  const review = createImportReviewer(async () => { downloads++; return candidate; }, async () => {
    calls++; throw Error('offline');
  });
  await assert.rejects(review(url), e => e instanceof ImportError && e.canPaste === true);
  assert.throws(() => extractArticle('<h1>环境异常</h1>', 'text/html', url),
    e => e instanceof ImportError && e.canPaste === true);
  assert.throws(() => extractArticle('<h1>Access denied</h1>', 'text/html', url),
    e => e instanceof ImportError && e.canPaste === undefined);
  candidate = reading;
  assert.equal(await review(url), reading);
  assert.equal(calls, 0);
  candidate = ambiguous;
  let token = '';
  await assert.rejects(review(url), e => {
    assert.ok(e instanceof ImportPreview);
    token = e.preview.token;
    return e.preview.excerpt.includes('sign in');
  });
  assert.equal(calls, 1);
  candidate = reading;
  await assert.rejects(review(new URL('https://example.org'), token), /expired/);
  assert.equal(await review(url, token), ambiguous);
  assert.equal(downloads, 3);
  const blocked = createImportReviewer(async () => ambiguous, async () => 'access');
  await assert.rejects(blocked(url), e => e instanceof ImportPreview && e.canPaste === undefined);
  const maybeGate = createImportReviewer(async () => ambiguous, async () => 'verification');
  await assert.rejects(maybeGate(url), e => e instanceof ImportPreview && e.canPaste === true && !!e.preview.token);
});

test('rechecks an earlier gate snapshot without retargeting its notes or duplicating a recovered article', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'journal-import-check-'));
  const path = join(folder, 'fixture.sqlite');
  const action = () => ({ type:'importReading' as const, id:randomUUID(), url:url.href });
  let candidate = gate, attempts = 0;
  const backend = { mode:'demo' as const, tutor:async()=>({reply:'',action:null}), friend:async()=>'',
    importReading:async()=>{attempts++; return candidate;} };
  const seed = openJournal(path,backend);
  seed.close();
  const db = new DatabaseSync(path);
  db.prepare("update journal set body=json_set(body,'$.reading.imports',json_array(json(?)))").run(JSON.stringify(gate));
  db.close();
  const journal = openJournal(path,backend);
  try {
    await assert.rejects(journal.act(action()), /verification page/);
    const old = journal.get().reading;
    assert.equal(old.documents.length,3);
    const legacy = old.documents[2];
    assert.ok('importWarning' in legacy);
    assert.ok('canPaste' in legacy && legacy.canPaste === true);
    assert.notEqual(old.documentId,gate.id);
    await journal.act({
      type: 'annotate', id: randomUUID(), documentId: gate.id, paragraphId: 'p1',
      quote: '环境异常', text: 'What does this notice say?',
    });
    candidate = reading;
    const good=(await journal.act(action())).reading;
    assert.equal(good.documents.length,4);
    assert.notEqual(good.documentId,gate.id);
    assert.equal((await journal.act(action())).reading.documentId,good.documentId);
    assert.equal(journal.get().annotationThreads[0].anchor.ownerId, gate.id);
    assert.equal(attempts,2);
  } finally { journal.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('previewing leaves the reader untouched and confirmation imports the reviewed snapshot once', async () => {
  let downloads = 0;
  const journal = openJournal(':memory:', {
    mode: 'demo', tutor: async () => ({reply: '', action: null}), friend: async () => '',
    importReading: async () => (++downloads === 1 ? ambiguous : reading),
  });
  try {
    const before = journal.get().reading;
    const request = { type: 'importReading' as const, id: randomUUID(), url: url.href };
    let token = '';
    await assert.rejects(journal.act(request), err => {
      assert.ok(err instanceof ImportPreview);
      token = err.preview.token;
      return true;
    });
    assert.deepEqual(journal.get().reading, before);
    const accept = { ...request, id: randomUUID(), acceptPreview: token };
    const added = (await journal.act(accept)).reading;
    assert.equal(added.documents.at(-1)?.title, ambiguous.title);
    assert.deepEqual((await journal.act(accept)).reading, added);
    assert.equal(downloads, 1);
  } finally { journal.close(); }
});

test('a learner can paste plain text after verification and reuse that reading after restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'journal-import-paste-'));
  const path = join(folder, 'journal.sqlite');
  const request = () => ({ type: 'importReading' as const, id: randomUUID(), url: url.href + '#source' });
  let downloads = 0;
  const backend = { mode: 'demo' as const, tutor: async () => ({ reply: '', action: null }), friend: async () => '',
    importReading: async () => { downloads++; return gate; } };
  let journal = openJournal(path, backend);
  try {
    const before = journal.get().reading;
    await assert.rejects(journal.act(request()), e => e instanceof ImportError && e.canPaste === true);
    for (const [pastedText, status] of [['   ', 422], ['中'.repeat(120_001), 413], ['段落\n'.repeat(2001), 413]] as const) {
      await assert.rejects(journal.act({ ...request(), pastedText }), e => e instanceof ImportError && e.status === status);
    }
    await assert.rejects(journal.act({ ...request(), pastedText: '文章', acceptPreview: randomUUID() }),
      e => e instanceof ImportError && e.status === 400);
    assert.deepEqual(journal.get().reading, before);
    const paste = { ...request(), pastedText: '\r\n河岸\r\n\r\n春雨落下。\n<b>第二段</b>' };
    const added = (await journal.act(paste)).reading;
    const doc = added.documents.at(-1)!;
    assert.equal(doc.title, '河岸');
    assert.equal(doc.sourceUrl, url.href);
    assert.deepEqual(doc.paragraphs, [
      { id: 'p1', text: '河岸' }, { id: 'p2', text: '春雨落下。' }, { id: 'p3', text: '<b>第二段</b>' },
    ]);
    assert.equal(added.documentId, doc.id);
    assert.deepEqual((await journal.act(paste)).reading, added);
    await journal.act({ type: 'annotate', id: randomUUID(), documentId: doc.id, paragraphId: 'p2', quote: '春雨', text: 'Spring rain' });
    journal.close();
    journal = openJournal(path, backend);
    const reopened = await journal.act(request());
    assert.equal(reopened.reading.documentId, doc.id);
    const other = await journal.act({ ...request(), pastedText: '第二版' });
    const second = other.reading.documents.at(-1)!;
    assert.notEqual(second.id, doc.id);
    assert.equal(second.title, '第二版');
    assert.equal(other.reading.documentId, second.id);
    const earlier = await journal.act({ ...paste, id: randomUUID() });
    assert.equal(earlier.reading.documents.length, 4);
    assert.equal(earlier.reading.documentId, doc.id);
    assert.deepEqual(earlier.reading.documents.find(d => d.id === doc.id), doc);
    assert.equal(earlier.annotationThreads[0].anchor.ownerId, doc.id);
    assert.equal((await journal.act(request())).reading.documentId, second.id);
    assert.equal(downloads, 1);
  } finally { journal.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('pasting preserves a legacy gate and treats even explicitly chosen verification text as a reading', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'journal-paste-legacy-'));
  const path = join(folder, 'journal.sqlite');
  const backend = { mode: 'demo' as const, tutor: async () => ({ reply: '', action: null }), friend: async () => '',
    importReading: async () => { throw Error('Unexpected source request'); } };
  openJournal(path, backend).close();
  const db = new DatabaseSync(path);
  db.prepare("UPDATE journal SET body=json_set(body,'$.reading.imports',json_array(json(?)))").run(JSON.stringify(gate));
  db.close();
  const journal = openJournal(path, backend);
  try {
    await journal.act({ type: 'annotate', id: randomUUID(), documentId: gate.id, paragraphId: 'p1',
      quote: '环境异常', text: 'Study this notice.' });
    const request = { type: 'importReading' as const, id: randomUUID(), url: url.href };
    const added = await journal.act({ ...request, pastedText: '安全验证' });
    const doc = added.reading.documents.at(-1)!;
    assert.equal(doc.title, '安全验证');
    assert.notEqual(doc.id, gate.id);
    assert.equal('importWarning' in doc, false);
    assert.equal(added.annotationThreads[0].anchor.ownerId, gate.id);
    const again = await journal.act({ ...request, id: randomUUID() });
    assert.equal(again.reading.documents.length, 4);
    assert.equal(again.reading.documentId, doc.id);
  } finally { journal.close(); rmSync(folder, { recursive: true, force: true }); }
});
