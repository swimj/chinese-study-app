import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveLookupRange, validFocus } from './reader-lookup-input.ts';
import { readerLedger } from './reader-ledger.ts';

test('decision evidence and first explicit flag survive reopening in their journal', t => {
  const root = mkdtempSync(join(tmpdir(),'lookup-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root,'fixture.sqlite');
  const ledger = readerLedger(path);
  const input = { kind:'tap' as const, text:'借的伞还没还。', start:5, end:6 };
  const decision = { documentId:'test', blockId:'opening', endBlockId:'opening', sourceEnd:6, startedAt:new Date().toISOString(), input,
    result:{ route:'selector', start:5, end:6, answer:{span:'还',pinyin:'huán',gloss:'give back'},
      evidence:{ candidates:['return','still'], selectedSenseId:'return' } } };
  const id = ledger.record(decision);
  const next = ledger.record(decision);
  assert.notEqual(next,id);
  assert.equal(ledger.flag(randomUUID()),false);
  assert.throws(() => ledger.flag('../fixture.sqlite'));
  assert.equal(readerLedger(path).flag(id),true);
  const first = [...ledger.rows()].find(r=>r.id===id);
  assert.ok(first?.feedback);
  assert.equal(first.feedback.type,'marked_wrong');
  assert.equal(ledger.flag(id),true);
  assert.deepEqual([...readerLedger(path).rows()].find(r=>r.id===id), first);
  assert.deepEqual(first.result, decision.result);
  assert.equal([...ledger.rows()].find(r=>r.id===next)?.feedback,null);
  assert.deepEqual([...readerLedger(join(root,'copy.sqlite')).rows()],[]);
});
test('lookup offsets must isolate a whole tapped character or a nonempty deliberate selection', () => {
  const text = '🙂好的\n再见';
  const tap = { text, kind:'tap' as const, start:0, end:2 };
  assert.ok(validFocus(tap));
  assert.ok(!validFocus({...tap,start:1}));
  assert.ok(!validFocus({...tap,end:3}));
  assert.ok(!validFocus({...tap,start:4,end:5}));
  assert.ok(validFocus({...tap,kind:'selection',start:2,end:text.length}));
});

test('multi-paragraph lookups retain the same offsets and line breaks as saved quotes', () => {
  const blocks = [{id:'first',text:'A🙂B'}, {id:'last',text:'CD'}];
  const request = {documentId:'doc',blockId:'first',endBlockId:'last',kind:'selection' as const,start:1,end:1};
  const range = resolveLookupRange(request,blocks);
  assert.ok(range.input);
  assert.equal(range.input.text.slice(range.input.start,range.input.end),'🙂B\nC');
  assert.equal(range.input.end - range.lastBlockStart,1);
  assert.equal(resolveLookupRange({...request,kind:'tap'},blocks).status,400);
  assert.equal(resolveLookupRange({...request,start:2},blocks).status,400);
  assert.equal(resolveLookupRange({...request,endBlockId:'missing'},blocks).status,404);
});
