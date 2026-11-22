import { ImportPreview } from './import-validation.ts';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImportError } from './article.ts';
import { ReadingConflict } from './reading.ts';
import { ZodError } from 'zod';
import { actionSchema, engine, JournalConflict, openJournal } from './journal.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const storage = process.env.JOURNAL_DB || join(dir, '.local', engine.mode + '.sqlite');
mkdirSync(dirname(storage), { recursive: true });
const journal = openJournal(storage);
const port = Number(process.env.JOURNAL_PORT || 4317);
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/words.js', ['words.js', 'text/javascript']],
  ['/annotations.js', ['annotations.js', 'text/javascript']],
  ['/annotations.css', ['annotations.css', 'text/css']],
  ['/reading.js', ['reading.js', 'text/javascript']],
  ['/reading.css', ['reading.css', 'text/css']],
  ['/style.css', ['style.css', 'text/css']],
]);
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
  if (size > 100_000 && !(value && typeof value === 'object' &&
      'type' in value && value.type === 'importReading' && 'pastedText' in value && typeof value.pastedText === 'string')) {
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
    const asset = files.get(req.url || '');
    if (req.method === 'GET' && asset) {
      res.writeHead(200, {
        'Content-Type': asset[1] + '; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(readFileSync(join(dir, 'public', asset[0])));
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
  console.log('Mandarin Journal · ' + engine.mode + ' · http://127.0.0.1:' + port),
);
