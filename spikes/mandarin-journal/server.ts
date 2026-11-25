import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createActivity } from './activity.ts';
import { ImportPreview } from './import-validation.ts';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImportError } from './article.ts';
import { ReadingConflict } from './reading.ts';
import { ZodError, type z } from 'zod';
import { actionSchema, engine, JournalConflict, openJournal } from './journal.ts';
import { buildFixture } from './fixture.ts';
import { resolveStorage } from './storage.ts';
import { createLookupService } from './reader-lookup-service.ts';
import { dictionaryPage } from './reader-catalog-report.ts';
import { openReaderCatalog } from './reader-catalog.ts';
import { startReaderGrowth } from './reader-growth-queue.ts';
import { readerWorkflow, ReaderRequestError } from './reader-workflow.ts';
import { feedbackRequest, readerLedger } from './reader-ledger.ts';

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
const activity = createActivity(new DatabaseSync(storage));
const journal = openJournal(storage, undefined, activity);
const catalog = openReaderCatalog(storage);
const lookups = createLookupService({ catalogSnapshot: catalog.snapshot });
const ledger = readerLedger(storage);
const reader = readerWorkflow(ledger, lookups, journal.readingParagraphs, startReaderGrowth(ledger, catalog, activity), activity);
const defaultPorts = { live: 4317, copy: 4319, fixture: 4320, custom: 4320 } as const;
const port = Number(process.env.JOURNAL_PORT || defaultPorts[resolved.profile]);
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/operator/activity', ['model-activity.html', 'text/html']],
  ['/model-activity.js', ['model-activity.js', 'text/javascript']],
  ['/model-activity.css', ['model-activity.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/turn-progress.js', ['turn-progress.js', 'text/javascript']],
  ['/chat-stream.js', ['chat-stream.js', 'text/javascript']],
  ['/capture.js', ['capture.js', 'text/javascript']],
  ['/teaching.js', ['teaching.js', 'text/javascript']],
  ['/annotations.js', ['annotations.js', 'text/javascript']],
  ['/annotations.css', ['annotations.css', 'text/css']],
  ['/pdf-import.js', ['pdf-import.js', 'text/javascript']],
  ['/reading.js', ['reading.js', 'text/javascript']],
  ['/reader-lookup.js', ['reader-lookup.js', 'text/javascript']],
  ['/reading.css', ['reading.css', 'text/css']],
  ['/wall/river-postcard.jpg', ['wall/river-postcard.jpg', 'image/jpeg']],
  ['/wall/caveat-latin.woff2', ['wall/caveat-latin.woff2', 'font/woff2']],
  ['/wall.css', ['wall.css', 'text/css']],
  ['/study.css', ['study.css', 'text/css']],
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

const actionLabels: Record<Exclude<z.infer<typeof actionSchema>['type'], 'readingPosition'>, string> = {
  capture: 'Home capture', tutor: 'Ask the tutor', chat: 'Send chat message', reflect: 'Reflect on chat',
  practice: 'Prepare practice', next: 'Next practice card', answer: 'Answer practice card',
  newThread: 'Start conversation', selectThread: 'Open conversation', importReading: 'Import reading',
  importPdf: 'Import PDF', captureReading: 'Save passage',
  annotate: 'Annotate reading', annotationPost: 'Post margin note', saveReading: 'Save reading',
  mediaReaction: 'Respond to picture', settings: 'Change settings', addWord: 'Add word',
  timeZone: 'Set learning time zone', flagExercise: 'Flag practice exercise',
  clarifyWord: 'Clarify word', retryWord: 'Retry word preparation',
  boardGroup: 'Organize board item', deletePiece: 'Delete scrapbook piece',
};

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
  // Keep a disconnected turn running to its receipt. A same-ID retry waits in the
  // journal queue, then recovers the committed exchange without a second model call.
  const line = (event: object) => {
    if (!res.destroyed) res.write(JSON.stringify(event) + '\n');
  };
  const fail = (status: number, payload: { error: string; canPaste?: boolean; preview?: unknown }) => {
    if (res.headersSent) {
      line({ type: 'error', status, error: payload.error });
      res.end();
    } else json(status, payload);
  };
  try {
    const host = req.headers.host;
    if (host !== 'localhost:' + port && host !== '127.0.0.1:' + port)
      throw new RequestError(403, 'Local access only.');
    if (req.headers.origin && req.headers.origin !== 'http://' + host)
      throw new RequestError(403, 'Unexpected request origin.');
    if (req.method === 'GET' && req.url?.split('?')[0] === '/operator/dictionary') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const page = dictionaryPage(storage, params);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
      res.end(page);
      return;
    }
    if (req.method === 'GET' && req.url?.split('?')[0] === '/api/operator/activity') {
      const hours = Number(new URL(req.url, 'http://localhost').searchParams.get('hours') ?? 24);
      if (![1, 24, 168].includes(hours)) throw new RequestError(400, 'Choose a 1, 24 or 168 hour window.');
      json(200, activity.report(hours));
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/operator/activity/')) {
      const trace = activity.trace(req.url.slice('/api/operator/activity/'.length));
      if (!trace) throw new RequestError(404, 'Activity not found.');
      json(200, trace);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/state') {
      json(200, journal.get());
      return;
    }
    if (req.method === 'POST' && ['/api/reader-lookup','/api/reader-lookup/feedback','/api/action'].includes(req.url ?? '')) {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json')
        throw new RequestError(415, 'Expected JSON.');
      const payload = await body(req);
      if (req.url === '/api/reader-lookup/feedback') {
        const { id } = feedbackRequest.parse(payload);
        await activity.action('Flag reader lookup', id, async () => json(200, reader.flag(id)));
        return;
      }
      if (req.url === '/api/reader-lookup') {
        const recheck = payload && typeof payload === 'object' && 'previousDecisionId' in payload;
        await activity.action(recheck ? 'Check lookup in context' : 'Reader lookup', randomUUID(),
          async () => json(200, await reader.lookup(payload)));
        return;
      }
      const action = actionSchema.parse(payload);
      if (action.type === 'readingPosition') {
        json(200, await journal.act(action));
        return;
      }
      await activity.action(actionLabels[action.type], action.id, async () => {
        if (action.type === 'chat' && req.headers.accept?.split(',').some(type => type.trim() === 'application/x-ndjson')) {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
          res.flushHeaders();
          const state = await journal.act(action, text => line({ type: 'delta', text }));
          line({ type: 'done', state });
          res.end();
        } else json(200, await journal.act(action));
      });
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
    if (err instanceof ImportError) fail(err.status, {
      error: err.message,
      canPaste: err.canPaste,
      preview: err instanceof ImportPreview ? err.preview : undefined,
    });
    else if (err instanceof RequestError || err instanceof ReaderRequestError) fail(err.status, { error: err.message });
    else if (err instanceof JournalConflict || err instanceof ReadingConflict)
      fail(409, { error: err.message });
    else if (err instanceof ZodError) fail(400, { error: 'Invalid journal action.' });
    else fail(502, { error: 'The journal could not finish this turn. Please retry.' });
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    'Mandarin Journal · ' + resolved.profile + ' journal · ' + engine.mode + ' tutor · http://127.0.0.1:' + port +
      '\n  ' + storage + (resolved.snapshot ? '\n  snapshot ' + resolved.snapshot : ''),
  ),
);
