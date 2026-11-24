import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openReaderCatalog } from './reader-catalog.ts';
import { dictionaryReport } from './reader-catalog-report.ts';
import { startReaderGrowth } from './reader-growth-queue.ts';
import { readerLedger } from './reader-ledger.ts';

test('operator report is read-only, shows pending work and follows catalog receipts after restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-catalog-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = join(dir, 'test.sqlite');
  assert.match(dictionaryReport(db, ['还']), /give something back/);
  assert.equal(JSON.parse(dictionaryReport(db, ['--changes', '--json'])).length, 0);
  assert.deepEqual(readdirSync(dir), []);
  const ledger = readerLedger(db);
  const id = ledger.record({ documentId:'test', blockId:'one', endBlockId:'one', sourceEnd:1,
    startedAt:new Date().toISOString(), input:{kind:'tap',text:'报刊亭。',start:0,end:1},
    result:{route:'catalog', start:0,end:3,answer:{span:'报刊亭',pinyin:'bàokāntíng',gloss:'newsstand'}, evidence:{selectedSenseId:'stand'}} });
  assert.match(dictionaryReport(db, ['--changes','报刊亭']), /pending/);
  const store = openReaderCatalog(db);
  startReaderGrowth(ledger, store);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(store.receipt(id)?.outcome, 'linked');
  const [reported] = JSON.parse(dictionaryReport(db, ['--changes','--json',id]));
  assert.equal(reported.catalogLabel, 'newsstand');
  assert.equal(reported.receipt.senseId, 'stand');
  assert.equal(reported.feedback, null);
  startReaderGrowth(ledger, openReaderCatalog(db));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(store.receipts().length, 1);
});
