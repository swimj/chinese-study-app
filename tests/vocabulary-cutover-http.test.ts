import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createVocabularyCutoverFence } from '../server/vocabulary/cutover-routes.ts';

const retiredCalls = [
  ['POST','/words/a/introduction/open'],
  ['POST','/words/a/introduction/complete'],
  ['POST','/WORDS/a/INTRODUCTION/COMPLETE/'],
  ['POST','/words/a/complete-learning-session/'],
  ['POST','/study-sessions/a/completion'],
  ['POST','/session-payload'],
  ['GET','/session-payload'],
  ['POST','/operator/content-improvements'],
  ['PUT','/operator/content-improvements/case'],
  ['POST','/operator/content-improvements/case/validate'],
  ['POST','/operator/content-improvements/case/apply'],
  ['POST','/OPERATOR/content-improvements/case/apply/'],
  ['POST','/operator/content-improvements/case/close'],
] as const;

for (const profile of ['mandarin','french'] as const) {
  test(`${profile} cutover boundary protects writes without blocking historical reads or current routes`, async () => {
    let reached = 0;
    const app = express();
    app.use('/api',createVocabularyCutoverFence(profile));
    app.use((_req,res) => { reached += 1; res.json({ reached: true }); });
    const server = app.listen(0,'127.0.0.1');
    await new Promise<void>((resolve,reject) => { server.once('listening',resolve);server.once('error',reject); });
    const address = server.address();assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    try {
      for (const [method,path] of retiredCalls) {
        const response = await fetch(`${base}${path}`,{ method });
        assert.equal(response.status,profile === 'mandarin' ? 409 : 200,`${method} ${path}`);
        const body = await response.json();
        if (profile === 'mandarin') {
          assert.equal(body.code,'VOCABULARY_CUTOVER');
          assert.match(body.error,path.toLowerCase().startsWith('/operator/') ? /Vocabulary content review/ : /Reload/);
        }
      }
      assert.equal(reached,profile === 'mandarin' ? 0 : retiredCalls.length);
      for (const [method,path] of [
        ['GET','/operator/content-improvements'],['GET','/operator/content-improvements/case/history'],
        ['GET','/words/a/meanings'],['POST','/vocabulary/sessions'],
        ['POST','/operator/vocabulary/proposals'],['PATCH','/learner-settings/character-presentation'],
      ]) assert.equal((await fetch(`${base}${path}`,{ method })).status,200,`${method} ${path}`);
    } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
  });
}
