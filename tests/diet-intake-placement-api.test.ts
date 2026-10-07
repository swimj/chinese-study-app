import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type IndexModule = typeof import('../server/index.ts');
type ExpressApp = ReturnType<IndexModule['createApp']>;
let indexModule: IndexModule;
let dataDir = '';

describe('retired diet intake HTTP surface', () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-retired-diet-intake-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    try {
      indexModule = await import(`${pathToFileURL(path.resolve('server/index.ts')).href}?retired-diet-intake=${Date.now()}`);
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }
  });
  after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('survey submission routes are absent while learner diet steering remains available', () => {
    const app = indexModule.createApp({ frontendDistPath: null });
    assert.equal(findRoute(app, 'POST', '/api/diet/intake'), null);
    assert.equal(findRoute(app, 'POST', '/api/diet/intake/assess'), null);
    assert.ok(findRoute(app, 'POST', '/api/diet/nudge'));
  });

  test('status no longer asks a new learner to complete an intake survey', async () => {
    const app = indexModule.createApp({ frontendDistPath: null });
    const route = findRoute(app, 'GET', '/api/status');
    assert.ok(route);
    let body: Record<string, unknown> | undefined;
    await route.handler({ query: { studyDayKey: '2026-10-07' } }, {
      json(value: Record<string, unknown>) { body = value; },
    });
    assert.ok(body);
    assert.equal(body.status, 'ok');
    assert.equal(Object.hasOwn(body, 'dietIntakeRequired'), false);
  });
});

function findRoute(app: ExpressApp, method: string, pathName: string): { handler: (req: unknown, res: unknown) => unknown } | null {
  const stack = (app as unknown as { _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: unknown) => unknown }> } }> } })._router.stack;
  const layer = stack.find((item) => item.route?.path === pathName && item.route.methods[method.toLowerCase()]);
  return layer?.route ? { handler: layer.route.stack[0]!.handle } : null;
}
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
