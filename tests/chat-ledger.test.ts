import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before, after, test } from 'node:test';
import { createOpenAiResponsesChatProvider } from '../server/llm/chat-openai-responses.ts';
import { installModelInvocationLedger } from '../server/llm/invocation-ledger.ts';
let directory: string, sql: DatabaseSync, db: typeof import('../server/db.ts');
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ledger-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = directory;
  db = await import('../server/db.ts'); db.bootstrapLearner({ learnerId: 'chat-a' });
  sql = new DatabaseSync(path.join(directory, 'app.db')); installModelInvocationLedger();
});
after(() => { sql?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
test('stream iterations retain learner attribution, actual request and usage even on incomplete completion', async () => {
  for (const finish of ['completed', 'incomplete']) {
    const provider = createOpenAiResponsesChatProvider({ fetchImplementation: async () => new Response(
      `event: response.output_text.delta\ndata: ${JSON.stringify({type:'response.output_text.delta',delta:'private reply'})}\n\n` +
      `event: response.${finish}\ndata: ${JSON.stringify({type:`response.${finish}`,response:{id:'response',status:finish,
        output:[{type:'message',id:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'private reply',annotations:[]}]}],
        usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200},total_tokens:1100}}})}\n\n`,
      {headers:{'content-type':'text/event-stream'}}) });
    const run = () => db.runWithLearnerId('chat-a', () => provider.stream({ model: 'gpt-6-luna',
      messages: [{ role: 'user', content: 'private question' }], tools: [], maxOutputTokens: 10, timeoutMs: 1000,
      reasoningEffort: null, provenance: { workflowId: 'turn1', stepName: 'chat', attemptNumber: finish === 'completed' ? 1 : 2 },
    }, { apiKey: 'credential-never-stored', baseUrl: null }, () => undefined));
    if (finish === 'completed') await run(); else await assert.rejects(run(), /Incomplete/);
  }
  const rows = sql.prepare('SELECT * FROM model_invocations WHERE workflow_id=? ORDER BY attempt_number').all('turn1');
  assert.equal(rows.length, 2); assert.deepEqual(rows.map(row => row.status), ['completed', 'invalid_response']);
  assert.ok(rows.every(row => row.learner_id === 'chat-a' && typeof row.spend_usd === 'number' && row.spend_usd > 0));
  const serialized = JSON.stringify(rows);
  assert.ok(serialized.includes('private question')); assert.ok(serialized.includes('private reply'));
  assert.ok(!serialized.includes('credential-never-stored'));
});
