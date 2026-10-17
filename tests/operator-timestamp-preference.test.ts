import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readTimestampDisplay, writeTimestampDisplay } from '../src/pages/useTimestampDisplay.ts';
import { defaultTimestampDisplay } from '../src/pages/operator-timestamps.ts';

test('timestamp display preferences restore independently and replace previous selections', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  } });
  assert.deepEqual(readTimestampDisplay('model-invocations'), defaultTimestampDisplay);
  const ny = { mode: 'zone' as const, zone: 'America/New_York' };
  const tokyo = { mode: 'zone' as const, zone: 'Asia/Tokyo' };
  writeTimestampDisplay('model-invocations', ny);
  assert.deepEqual(readTimestampDisplay('content-quality'), defaultTimestampDisplay);
  writeTimestampDisplay('content-quality', tokyo);
  assert.deepEqual(readTimestampDisplay('model-invocations'), ny);
  assert.deepEqual(readTimestampDisplay('content-quality'), tokyo);
  for (const mode of ['local', 'utc', 'zone'] as const) {
    const next = { mode, zone: 'Europe/Paris' };
    writeTimestampDisplay('model-invocations', next);
    assert.deepEqual(readTimestampDisplay('model-invocations'), next);
    assert.deepEqual(readTimestampDisplay('content-quality'), tokyo);
  }
  for (const invalid of ['{', 'null', '42', '[]', '{}',
    '{"mode":"bogus","zone":"UTC"}', '{"mode":"zone","zone":"Mars/Olympus"}',
    '{"mode":"local","zone":42}', '{"mode":"zone"}']) {
    values.set('operator.model-invocations.timestamp-display', invalid);
    assert.deepEqual(readTimestampDisplay('model-invocations'), defaultTimestampDisplay);
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    get localStorage() { throw new Error('Storage blocked'); },
  } });
  assert.deepEqual(readTimestampDisplay('model-invocations'), defaultTimestampDisplay);
  assert.doesNotThrow(() => writeTimestampDisplay('model-invocations', ny));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: () => null,
    setItem: () => { throw new Error('Quota exceeded'); },
  } } });
  assert.doesNotThrow(() => writeTimestampDisplay('content-quality', tokyo));
  Reflect.deleteProperty(globalThis, 'window');
  assert.deepEqual(readTimestampDisplay('model-invocations'), defaultTimestampDisplay);
});
