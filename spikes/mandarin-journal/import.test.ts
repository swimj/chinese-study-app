import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { IncomingMessage, type IncomingHttpHeaders } from 'node:http';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { extractArticle, ImportError } from './article.ts';
import { articleUrl, importArticle, publicDestination } from './import-reading.ts';
import { openJournal } from './journal.ts';
import type { TurnContext } from './tutor.ts';

const sample = `<title>刊物 · 周末</title><nav>首页</nav><main><article>
  <header><h1>周末随笔</h1></header><p>我去了<a href="/other">河边</a>，坐了一会儿。</p>
  <h2>第二天</h2><div>朋友也来了。<br>我们聊了聊 &amp; 喝了茶。</div>
  <script>void 0</script><style>body { margin: 0 }</style><template>模板</template><form>订阅</form><aside>广告</aside><div hidden>隐藏</div><footer>页脚</footer>
  </article></main>`;
const address = new URL('https://example.org/article');
const failsWith = (status: number) => (err: unknown) => err instanceof ImportError && err.status === status;

function response(status: number, headers: IncomingHttpHeaders, content: string | Buffer = '') {
  const message = new IncomingMessage(new Socket());
  message.statusCode = status;
  message.headers = headers;
  message.push(Buffer.from(content));
  message.push(null);
  return message;
}

test('extracts inert, ordered article paragraphs and headings with readable link labels', () => {
  const doc = extractArticle(sample, 'text/html', address);
  assert.equal(doc.title, '周末随笔');
  assert.deepEqual(doc.paragraphs, [
    { id: 'p1', text: '我去了河边，坐了一会儿。' },
    { id: 'p2', kind: 'heading', text: '第二天' },
    { id: 'p3', text: '朋友也来了。' },
    { id: 'p4', text: '我们聊了聊 & 喝了茶。' },
  ]);
  assert.throws(() => extractArticle('<main><nav>首页</nav></main>', 'text/html', address), failsWith(422));
});

test('canonicalizes URLs and requires publicly routable literal addresses and DNS answers', () => {
  assert.equal(articleUrl('HTTPS://EXAMPLE.ORG:443/article#heading').href, address.href);
  for (const raw of [
    'file:///reading.txt',
    'https://localhost/read',
    'http://127.0.0.1/read',
    'http://[::1]/read',
    'http://[fc00::1]/read',
    'https://user:pass@example.org/',
  ]) {
    assert.throws(() => articleUrl(raw), failsWith(422));
  }
  const ipv4 = { address: '1.1.1.1', family: 4 };
  const ipv6 = { address: '2606:4700:4700::1111', family: 6 };
  assert.equal(publicDestination([ipv6, ipv4]), ipv4);
  assert.equal(publicDestination([ipv6]), ipv6);
  assert.throws(() => publicDestination([ipv4, { address: '192.168.1.5', family: 4 }]), failsWith(422));
});

test('follows a relative redirect, decodes text, and stops on unusable sources', async () => {
  const urls: string[] = [];
  const doc = await importArticle(address, async (url) => {
    urls.push(url.href);
    return urls.length === 1
      ? response(302, { location: 'next' })
      : response(
          200,
          { 'content-type': 'text/plain; charset=gb18030', 'content-encoding': 'gzip' },
          gzipSync(Buffer.from('d6d0cec40a0ad6d0b9fa', 'hex')),
        );
  });
  assert.deepEqual(urls, [address.href, 'https://example.org/next']);
  assert.deepEqual(
    doc.paragraphs.map((p) => p.text),
    ['中文', '中国'],
  );
  assert.equal(doc.sourceUrl, address.href);
  await assert.rejects(
    importArticle(address, async () => response(302, { location: '/again' })),
    failsWith(422),
  );
  await assert.rejects(
    importArticle(address, async () => response(302, { location: 'http://localhost/read' })),
    failsWith(422),
  );
  await assert.rejects(
    importArticle(address, async () => response(200, { 'content-type': 'image/png' })),
    failsWith(422),
  );
  await assert.rejects(
    importArticle(address, async () => response(404, {})),
    failsWith(502),
  );
  await assert.rejects(
    importArticle(address, async () =>
      response(200, { 'content-type': 'text/html', 'content-length': '3000000' }),
    ),
    failsWith(413),
  );
  await assert.rejects(
    importArticle(address, async () =>
      response(
        200,
        { 'content-type': 'text/plain', 'content-encoding': 'gzip' },
        gzipSync(Buffer.alloc(2_100_000)),
      ),
    ),
    failsWith(413),
  );
});

test('owns article snapshots per journal, resuming, annotating, saving and discussing the same text after reopen', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'journal-import-'));
  const file = join(folder, 'journal.sqlite');
  let downloads = 0;
  let context: TurnContext | undefined;
  const backend = {
    mode: 'demo' as const,
    tutor: async (ctx: TurnContext) => {
      context = ctx;
      return { reply: '可以。', action: null };
    },
    friend: async (ctx: TurnContext) => {
      context = ctx;
      return '可以。';
    },
    importReading: async (url: URL) => {
      downloads++;
      if (url.pathname !== '/article') throw new ImportError(502, 'Source unavailable.');
      return extractArticle(sample, 'text/html', url);
    },
  };
  let journal = openJournal(file, backend);
  const other = openJournal(':memory:', backend);
  try {
    const seed = journal.get().reading.documents[0];
    await journal.act({
      id: randomUUID(),
      type: 'readingPosition',
      documentId: seed.id,
      paragraphId: seed.paragraphs[1].id,
    });
    // Reopen a journal saved before URL imports existed.
    journal.close();
    const db = new DatabaseSync(file);
    db.prepare(`UPDATE journal SET body=json_set(json_remove(body, '$.reading.imports', '$.reading.bookmarkedAt'),
      '$.reading.documentId', ?)`).run(seed.id);
    db.close();
    journal = openJournal(file, backend);
    assert.ok(!Object.hasOwn(journal.get().reading, 'documentId'));
    const request = { id: randomUUID(), type: 'importReading' as const, url: address.href };
    const added = await journal.act(request);
    const doc = added.reading.documents.at(-1)!;
    assert.equal(added.documentId, doc.id);
    const stored = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(stored.prepare("SELECT json_type(body, '$.reading.documentId') legacy FROM journal").get()?.legacy, null);
    } finally { stored.close(); }
    assert.equal(other.get().reading.documents.length, 2);
    const where = { documentId: doc.id, paragraphId: 'p1' };
    await journal.act({ id: randomUUID(), type: 'readingPosition', ...where });
    const noteId = randomUUID();
    await journal.act({ id: noteId, type: 'annotate', ...where, quote: '河边', text: '地点' });
    journal.close();
    journal = openJournal(file, backend);
    const again = await journal.act({ ...request, id: randomUUID(), url: address.href + '#second' });
    assert.equal(downloads, 1);
    assert.deepEqual(again.reading.positions, { [seed.id]: seed.paragraphs[1].id, [doc.id]: 'p1' });
    assert.deepEqual(again.reading.documents.at(-1), doc);
    assert.equal(again.reading.documents.length, 3);
    await journal.act({
      id: randomUUID(),
      type: 'annotationPost',
      annotationId: noteId,
      askTutor: true,
      message: '解释一下',
    });
    assert.match(context!.readingContext!, /我去了河边，坐了一会儿。/);
    const saved = await journal.act({
      id: randomUUID(),
      type: 'saveReading',
      title: doc.title,
      detail: doc.title,
      source: doc.id,
    });
    assert.match(saved.saved.at(-1)!.detail, /我们聊了聊/);
    await journal.act({ id: randomUUID(), type: 'newThread', title: doc.title, source: doc.id });
    await journal.act({ id: randomUUID(), type: 'chat', message: '后来呢？', source: doc.id });
    assert.match(context!.source, /朋友也来了。/);
    await journal.act({
      id: randomUUID(),
      type: 'tutor',
      message: '哪天？',
      source: '',
      surface: 'read',
      referenceId: doc.id + '/p2',
    });
    assert.match(context!.readingContext!, /第二天/);
    const beforeFailure = journal.get();
    await assert.rejects(
      journal.act({ ...request, id: randomUUID(), url: 'https://example.org/unavailable' }),
      failsWith(502),
    );
    assert.deepEqual(journal.get(), beforeFailure);
  } finally {
    journal.close();
    other.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('uses the transcribed work within wiki pages, preserving the page title and skipping page markers', () => {
  const html = `<title>小记 - 图书馆</title><main><h1>小记</h1><div>下载</div>
    <div class="mw-parser-output"><p>目录</p>
    <div class="prp-pages-output"><p><span class="ws-pagenum">1</span>第一段</p></div>
    <div class="prp-pages-output"><p>第二段</p></div><div>版权</div></div></main>`;
  const doc = extractArticle(html, 'text/html', address);
  assert.equal(doc.title, '小记');
  assert.deepEqual(
    doc.paragraphs.map((p) => p.text),
    ['第一段', '第二段'],
  );
});

test('long reading discussions and reflections include the saved late passage within a bounded source', async () => {
  const text = Array.from({ length: 90 }, (_, i) => '段落' + i + ' 牛奶'.repeat(160)).join('\n');
  const doc = extractArticle(text, 'text/plain', address);
  let context: TurnContext | undefined;
  const journal = openJournal(':memory:', {
    mode: 'demo',
    importReading: async () => doc,
    friend: async (ctx) => {
      context = ctx;
      return '后来呢？';
    },
    tutor: async (ctx) => {
      context = ctx;
      return { action: null, reply: '', reflection: { overview: '地点', takeaways: [] } };
    },
  });
  try {
    await journal.act({ id: randomUUID(), type: 'importReading', url: address.href });
    await journal.act({ id: randomUUID(), type: 'readingPosition', documentId: doc.id, paragraphId: 'p85' });
    await journal.act({ id: randomUUID(), type: 'newThread', title: doc.title, source: doc.id });
    for (const action of [{ type: 'chat' as const, message: '读完了' }, { type: 'reflect' as const }]) {
      await journal.act({ ...action, id: randomUUID(), source: doc.id });
      assert.ok(context!.source.startsWith(doc.title));
      assert.ok(context!.source.length < 6300);
      assert.ok(context!.source.includes('段落84'));
      assert.ok(!context!.source.includes('段落30'));
    }
  } finally {
    journal.close();
  }
});
