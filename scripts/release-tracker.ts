import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import {
  DEFAULT_RELEASE_ROOT,
  RELEASE_TRACKER_PORT,
  applyUpgradeEvent,
  initialState,
  latestReleaseId,
  listReleases,
  readRelease,
  setStage,
  writeRelease,
  type ReleaseOutcome,
  type TrackerStatus,
} from './lib/release-tracker.ts';

const args = readStrictArguments([
  'action', 'root', 'release', 'mode', 'title', 'commit', 'stage', 'status', 'detail', 'text', 'key', 'value', 'file', 'port',
]);
const root = path.resolve(args.get('root') ?? process.env.RELEASE_TRACKER_ROOT ?? DEFAULT_RELEASE_ROOT);
const now = () => new Date().toISOString();
const action = requireArgument(args, 'action');
const releaseId = () => args.get('release') ?? latestReleaseId(root);

function update(mutate: (state: ReturnType<typeof readRelease>) => void): void {
  const state = readRelease(root, releaseId());
  mutate(state);
  state.updatedAt = now();
  writeRelease(root, state);
}

if (action === 'init') {
  const mode = requireArgument(args, 'mode');
  if (mode !== 'code' && mode !== 'migrate') throw new Error('--mode must be code or migrate.');
  const commit = args.get('commit');
  const id = args.get('release') ?? `${now().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')}-${(commit ?? 'release').slice(0, 7)}`;
  writeRelease(root, initialState({ id, mode, title: args.get('title') ?? `${mode === 'migrate' ? 'Migration' : 'Code-only'} release`, commit }, now()));
  console.log(JSON.stringify({ release: id, root }));
} else if (action === 'stage') {
  update((state) => setStage(state, requireArgument(args, 'stage'), requireArgument(args, 'status') as TrackerStatus, now(), args.get('detail')));
} else if (action === 'note') {
  update((state) => { state.notes.push({ at: now(), text: requireArgument(args, 'text') }); });
} else if (action === 'fact') {
  update((state) => { state.facts[requireArgument(args, 'key')] = requireArgument(args, 'value'); });
} else if (action === 'phase') {
  update((state) => { state.phase = requireArgument(args, 'text'); });
} else if (action === 'outcome') {
  const value = requireArgument(args, 'value') as ReleaseOutcome;
  if (!['in-progress', 'released', 'failed', 'abandoned'].includes(value)) throw new Error('--value must be in-progress, released, failed, or abandoned.');
  update((state) => { state.outcome = value; });
} else if (action === 'watch') {
  // Follows hosted:upgrade's JSON output file and mirrors its stages until the final result.
  const file = path.resolve(requireArgument(args, 'file'));
  const id = releaseId();
  update((state) => setStage(state, 'p-declare', 'running', now()));
  let offset = 0;
  let pending = '';
  for (;;) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      pending += text.slice(offset);
      offset = text.length;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      let done = false;
      for (const line of lines) {
        const state = readRelease(root, id);
        done = applyUpgradeEvent(state, line, now()) || done;
        writeRelease(root, state);
      }
      if (done) break;
    }
    await delay(1000);
  }
} else if (action === 'serve') {
  const port = Number(args.get('port') ?? RELEASE_TRACKER_PORT);
  const page = fs.readFileSync(new URL('./release-tracker/index.html', import.meta.url));
  const send = (res: http.ServerResponse, status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', page);
      if (url.pathname === '/api/releases') return send(res, 200, 'application/json', JSON.stringify(listReleases(root)));
      const match = /^\/api\/releases\/([a-z0-9-]+)$/.exec(url.pathname);
      if (match) return send(res, 200, 'application/json', JSON.stringify(readRelease(root, match[1]!)));
      send(res, 404, 'text/plain', 'Not found');
    } catch {
      send(res, 404, 'text/plain', 'Not found');
    }
  }).listen(port, '127.0.0.1', () => console.log(JSON.stringify({ serving: `http://127.0.0.1:${port}/`, root })));
} else {
  throw new Error('--action must be init, stage, note, fact, phase, outcome, watch, or serve.');
}
