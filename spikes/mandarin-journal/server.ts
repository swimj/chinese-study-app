import { ImportPreview } from './import-validation.ts';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImportError } from './article.ts';
import { ReadingConflict } from './reading.ts';
import { ZodError } from 'zod';
import { actionSchema, engine, JournalConflict, openJournal } from './journal.ts';
import { buildFixture } from './fixture.ts';
import { resolveStorage } from './storage.ts';

const dir = dirname(fileURLToPath(import.meta.url));
let resolved;
try {
  resolved = await resolveStorage({ checkout: dir });
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const storage = resolved.path;
mkdirSync(dirname(storage), { recursive: true });
if (resolved.profile === 'fixture' && resolved.fresh) await buildFixture(storage);
const journal = openJournal(storage);
const defaultPorts = { live: 4317, copy: 4319, fixture: 4320, custom: 4320 } as const;
const port = Number(process.env.JOURNAL_PORT || defaultPorts[resolved.profile]);
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/words.js', ['words.js', 'text/javascript']],
  ['/annotations.js', ['annotations.js', 'text/javascript']],
  ['/annotations.css', ['annotations.css', 'text/css']],
  ['/pdf-import.js', ['pdf-import.js', 'text/javascript']],
  ['/reading.js', ['reading.js', 'text/javascript']],
  ['/reader-lookup.js', ['reader-lookup.js', 'text/javascript']],
  ['/reading.css', ['reading.css', 'text/css']],
  ['/style.css', ['style.css', 'text/css']],
  ['/scrapbook.js', ['scrapbook.js', 'text/javascript']],
  ['/scrapbook.css', ['scrapbook.css', 'text/css']],
  ['/media-policy.js', ['media-policy.js', 'text/javascript']],
]);
// Only the PDF.js resources used by text extraction have public URLs.
const pdfBuild = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist')));
const pdfAssets = new Map([
  ['/pdfjs/pdf.mjs', [join(pdfBuild, 'pdf.min.mjs'), 'text/javascript']],
  ['/pdfjs/pdf.worker.mjs', [join(pdfBuild, 'pdf.worker.min.mjs'), 'text/javascript']],
]);
for (const [folder, extensions] of [
  ['cmaps', /\.bcmap$/],
  ['standard_fonts', /\.(ttf|pfb)$/],
] as const) {
  const root = join(pdfBuild, '..', folder);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && extensions.test(entry.name))
      pdfAssets.set('/pdfjs/' + folder + '/' + entry.name, [join(root, entry.name), 'application/octet-stream']);
  }
}

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    // Allow a 120,000-character Mandarin article, including JSON escapes and line breaks.
    if (size > 1024 * 1024) throw new RequestError(413, 'Message too large. Send a shorter selection.');
    chunks.push(chunk);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new RequestError(400, 'Invalid JSON.');
  }
  const readingImport = value && typeof value === 'object' && 'type' in value && (
    (value.type === 'importReading' && 'pastedText' in value && typeof value.pastedText === 'string') ||
    (value.type === 'importPdf' && 'paragraphs' in value && Array.isArray(value.paragraphs))
  );
  if (size > 100_000 && !readingImport) {
    throw new RequestError(413, 'Message too large.');
  }
  return value;
}
const server = createServer(async (req, res) => {
  const json = (status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  try {
    const host = req.headers.host;
    if (host !== 'localhost:' + port && host !== '127.0.0.1:' + port)
      throw new RequestError(403, 'Local access only.');
    if (req.headers.origin && req.headers.origin !== 'http://' + host)
      throw new RequestError(403, 'Unexpected request origin.');
    if (req.method === 'GET' && req.url === '/api/state') {
      json(200, journal.get());
      return;
    }
    if (req.method === 'POST' && req.url === '/api/action') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json')
        throw new RequestError(415, 'Expected JSON.');
      const action = actionSchema.parse(await body(req));
      json(200, await journal.act(action));
      return;
    }
    const route = req.url || '';
    const local = files.get(route);
    const asset = local ? [join(dir, 'public', local[0]), local[1]] : pdfAssets.get(route);
    if (req.method === 'GET' && asset) {
      const bytes = await readFile(asset[0]);
      res.writeHead(200, {
        'Content-Type': asset[1].startsWith('text/') ? asset[1] + '; charset=utf-8' : asset[1],
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(bytes);
      return;
    }
    throw new RequestError(404, 'Page not found.');
  } catch (err) {
    if (err instanceof ImportError) json(err.status, {
      error: err.message,
      canPaste: err.canPaste,
      preview: err instanceof ImportPreview ? err.preview : undefined,
    });
    else if (err instanceof RequestError) json(err.status, { error: err.message });
    else if (err instanceof JournalConflict || err instanceof ReadingConflict)
      json(409, { error: err.message });
    else if (err instanceof ZodError) json(400, { error: 'Invalid journal action.' });
    else json(502, { error: 'The journal could not finish this turn. Please retry.' });
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    'Mandarin Journal · ' + resolved.profile + ' journal · ' + engine.mode + ' tutor · http://127.0.0.1:' + port +
      '\n  ' + storage + (resolved.snapshot ? '\n  snapshot ' + resolved.snapshot : ''),
  ),
);
