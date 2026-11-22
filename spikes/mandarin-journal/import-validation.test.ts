import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { extractArticle } from './article.ts';
import { createImportReviewer, ImportPreview, inspectReading } from './import-validation.ts';
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
  await assert.rejects(review(url), /verification page/);
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
  await assert.rejects(blocked(url), /sign-in/);
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
    assert.equal('importWarning' in old.documents[2], true);
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
