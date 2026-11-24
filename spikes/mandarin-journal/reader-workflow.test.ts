import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readerLedger } from './reader-ledger.ts';
import { createLookupService } from './reader-lookup-service.ts';
import { LookupModelError } from './reader-model.ts';
import { readerWorkflow } from './reader-workflow.ts';

test('second look replays the recorded occurrence, preserves failed attempts and flags the strong answer', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-recheck-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = readerLedger(join(dir, 'fixture.sqlite'));
  const passage = { id: 'first', text: '我买了车票。' };
  const queue: string[] = [];
  const trace = { provider: 'openai' as const, model: 'mock', elapsedMs: 7, request: { instructions: 'test' }, raw: {} };
  let fail = true;
  const service = createLookupService({
    dictionaryPath: fileURLToPath(new URL('./lookup-experiment/reader-dictionary.sample.u8', import.meta.url)),
    selectorEnabled: false, contextEnabled: true,
    async context(_arm, input) {
      assert.deepEqual(input, { kind: 'tap', text: passage.text, start: 3, end: 4 });
      if (fail) throw new LookupModelError('mock failure', trace);
      return { ...trace, answer: { span: '车票', gloss: 'ticket for this ride', pinyin: 'chēpiào', chunks: [] } };
    },
  });
  const flow = readerWorkflow(ledger, service, () => [passage], id => queue.push(id));
  const quick = await flow.lookup({ documentId: 'doc', blockId: 'first', kind: 'tap', start: 3, end: 4 });
  assert.equal(quick.route, 'dictionary');
  assert.equal(quick.canCheckContext, true);
  assert.throws(() => flow.flag(quick.id), /Only a contextual/);
  await assert.rejects(flow.lookup({ previousDecisionId: randomUUID() }), /not found/);
  await assert.rejects(flow.lookup({ previousDecisionId: quick.id, start: 2 }));
  await assert.rejects(flow.lookup({ previousDecisionId: quick.id }), /retry/);
  fail = false;
  const result = await flow.lookup({ previousDecisionId: quick.id });
  assert.equal(result.route, 'context');
  assert.equal(result.canCheckContext, false);
  const row = ledger.get(result.id)!;
  assert.deepEqual(queue.length, 3);
  assert.equal(ledger.get(queue[1])?.result.answer, null);
  assert.equal(row.previousDecisionId, quick.id);
  assert.equal(row.trigger, 'check_in_context');
  assert.deepEqual(row.revision, { spanChanged: false, readingChanged: quick.answer?.pinyin !== result.answer?.pinyin, glossChanged: true });
  assert.deepEqual(row.input, ledger.get(quick.id)?.input);
  assert.equal(ledger.get(quick.id)?.feedback, null);
  await assert.rejects(flow.lookup({ previousDecisionId: result.id }), /Only a quick answer/);
  assert.equal(flow.flag(result.id).flagged, true);
  assert.equal(ledger.get(result.id)?.feedback?.type, 'marked_wrong');
  passage.text = '我放了车票。';
  await assert.rejects(flow.lookup({ previousDecisionId: quick.id }), /passage has changed/);
});
