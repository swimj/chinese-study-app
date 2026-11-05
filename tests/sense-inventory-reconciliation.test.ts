import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInventoryReconciliation, inventoryHash, validateInventorySnapshot, type InventorySnapshot, type ReconciliationJudgment } from '../scripts/lib/sense-inventory-reconciliation.ts';

const snapshot: InventorySnapshot = {
  word: { wordId: 'w1', hanzi: '垂', traditional: null, pinyin: 'chuí', meanings: ['hang', 'droop'] },
  catalog: { version: 4, establishedAt: '2026-11-04T00:00:00.000Z' },
  senses: [
    { senseId: 'physical', version: 2, status: 'active', description: { label: 'Hang down' } },
    { senseId: 'compound', version: 1, status: 'active', description: { label: 'Set an example' } },
    { senseId: 'old', version: 3, status: 'retired', description: { label: 'Old entry' } },
  ],
  coverage: { version: 2, defaultUsefulSenseIds: ['physical', 'compound'] },
  dependencies: { content: [{ contentId: 'exercise', version: 3, senseId: 'compound' }], stashed: [{ learnerId: 'learner', stateVersion: 8 }] },
};
const candidate = { senses: [{ label: 'Hang or droop downward', notes: [], defaultUseful: true }] };
function judgment(): ReconciliationJudgment {
  return { snapshotSha256: inventoryHash(snapshot), candidateSha256: inventoryHash(candidate), reviewer: 'semantic-reviewer', groups: [
    { existingSenseIds: ['physical'], candidateIndexes: [0], decision: 'revise', rationale: 'Same physical use, clearer label.' },
    { existingSenseIds: ['compound'], candidateIndexes: [], decision: 'retire', rationale: 'This meaning belongs to 垂范.' },
  ] };
}
test('reconciliation accounts for active identities and retains dependency evidence without certifying semantics or application', () => {
  const before = JSON.stringify(snapshot);
  const result = checkInventoryReconciliation(snapshot, candidate, judgment());
  assert.equal(result.structurallyValid, true);
  assert.equal(result.applyReady, false);
  assert.equal(result.semanticJudgmentVerified, false);
  assert.deepEqual(result.dependencies, snapshot.dependencies);
  assert.equal(JSON.stringify(snapshot), before);
});
test('stale lexical, catalog, coverage, and dependent content snapshots invalidate judgments', () => {
  for (const mutate of [
    (value: InventorySnapshot) => { value.word.meanings.push('changed'); },
    (value: InventorySnapshot) => { value.catalog.version++; },
    (value: InventorySnapshot) => { value.coverage = null; },
    (value: InventorySnapshot) => { value.dependencies.content = []; },
  ]) {
    const changed = structuredClone(snapshot); mutate(changed);
    assert.throws(() => checkInventoryReconciliation(changed, candidate, judgment()), /hashes/);
  }
  assert.throws(() => checkInventoryReconciliation(snapshot, { senses: [] }, judgment()), /hashes/);
});
test('missing, duplicate, foreign, and retired identity mappings cannot pass the deterministic check', () => {
  const missing = judgment(); missing.groups.pop();
  assert.throws(() => checkInventoryReconciliation(snapshot, candidate, missing), /accounted for/);
  for (const id of ['physical', 'foreign', 'old']) {
    const value = judgment(); value.groups[1]!.existingSenseIds = [id];
    assert.throws(() => checkInventoryReconciliation(snapshot, candidate, value), /Unknown, retired, or repeated/);
  }
  const duplicate = judgment(); duplicate.groups[1]!.candidateIndexes = [0];
  assert.throws(() => checkInventoryReconciliation(snapshot, candidate, duplicate), /repeated candidate/);
});
test('empty inventory follows explicit retirement judgments for every active sense', () => {
  const empty = { senses: [] }, value = judgment(); value.candidateSha256 = inventoryHash(empty);
  value.groups[0] = { existingSenseIds: ['physical'], candidateIndexes: [], decision: 'retire', rationale: 'Reviewed as outside target inventory.' };
  assert.equal(checkInventoryReconciliation(snapshot, empty, value).emptyInventory, true);
});
test('reviewers can retain an existing valid sense omitted by an empty candidate', () => {
  const empty = { senses: [] }, value = judgment(); value.candidateSha256 = inventoryHash(empty);
  value.groups[0] = { existingSenseIds: ['physical'], candidateIndexes: [], decision: 'retain',
    rationale: 'The fresh candidate omitted a valid target use; preserve the reviewed existing sense.' };
  const result = checkInventoryReconciliation(snapshot, empty, value);
  assert.equal(result.structurallyValid, true);
  assert.equal(result.emptyInventory, false);
  assert.deepEqual(result.groups[0], value.groups[0]);
});
test('split and merge cannot masquerade as identity-preserving revisions', () => {
  const value = judgment(); value.groups = [{ existingSenseIds: ['physical', 'compound'], candidateIndexes: [0], decision: 'revise', rationale: 'Merge proposal.' }];
  assert.throws(() => checkInventoryReconciliation(snapshot, candidate, value), /cardinality/);
  value.groups[0]!.decision = 'restructure';
  assert.ok(checkInventoryReconciliation(snapshot, candidate, value).requiredBeforeApply.some(item => item.includes('split/merge')));
});
test('snapshot input rejects duplicate identities and malformed lexical data', () => {
  const duplicate = structuredClone(snapshot); duplicate.senses.push(duplicate.senses[0]!);
  assert.throws(() => validateInventorySnapshot(duplicate), /duplicate sense/);
  assert.throws(() => validateInventorySnapshot({ ...snapshot, word: { ...snapshot.word, meanings: [42] } }), /lexical/);
});

test('CLI export uses exact runtime lexical input and leaves the database unchanged', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { DatabaseSync } = await import('node:sqlite');
  const { createBaselineFixture } = await import('./helpers/baseline-database.ts');
  const { migrateDatabase } = await import('../server/db/migrations.ts');
  const { setDb } = await import('../server/db/connection.ts');
  const { getSharedIntroductionLexicalWord } = await import('../server/db/word-introductions.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sense-reconciliation-'));
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    createBaselineFixture(root);
    const database = path.join(root, 'app.db');
    db = new DatabaseSync(database); db.function('current_learner_id', () => 'test-learner'); migrateDatabase(db); setDb(db);
    db.exec(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
      VALUES ('trial-word','垂','垂','chuí','fallback','[]','[]',1,'2026-11-04');`);
    // The app's separate lexical meanings take priority over lexical_words.meaning.
    db.prepare("INSERT INTO lexical_word_meanings(id,word_id,text,position,created_at,updated_at) VALUES (?,?,?,?,'2026-11-04','2026-11-04')").run('m2', 'trial-word', 'droop', 2);
    db.prepare("INSERT INTO lexical_word_meanings(id,word_id,text,position,created_at,updated_at) VALUES (?,?,?,?,'2026-11-04','2026-11-04')").run('m1', 'trial-word', 'hang', 1);
    const expected = getSharedIntroductionLexicalWord('trial-word');
    setDb(null); db.close(); db = undefined;
    const before = fs.readFileSync(database);
    const out = path.join(root, 'snapshot.json');
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/reconcile-sense-inventory.ts', 'export', '--database', database, '--word-ids', 'trial-word', '--out', out], { stdio: 'pipe' });
    const exported = JSON.parse(fs.readFileSync(out, 'utf8')) as InventorySnapshot[];
    assert.deepEqual(exported[0]!.word, expected);
    assert.deepEqual(exported[0]!.catalog, { version: 0, establishedAt: null });
    assert.deepEqual(fs.readFileSync(database), before);
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/reconcile-sense-inventory.ts', 'export', '--database', database, '--word-ids', 'trial-word', '--out', out], { stdio: 'pipe' }), /Command failed/);
    const archive = path.join(root, 'archive');
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/reconcile-sense-inventory.ts', 'trial', '--input', out, '--archive', archive, '--variant', 'prepared'], { stdio: 'pipe' });
    const request = JSON.parse(fs.readFileSync(path.join(archive, 'prepared', '000', 'request.json'), 'utf8'));
    assert.deepEqual(JSON.parse(request.userPrompt), { word: {hanzi:'垂',pinyin:'chuí',meanings:['hang','droop']} });
    assert.equal(exported[0]!.word.wordId,'trial-word');
    assert.equal(exported[0]!.word.traditional,'垂');
    assert.equal(request.outputSchema.properties.senses.minItems, 0);
    assert.equal(fs.existsSync(path.join(archive, 'prepared', '000', 'response.json')), false);
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/reconcile-sense-inventory.ts', 'trial', '--input', out, '--archive', archive, '--variant', 'historical', '--baseline-revision', '17a5a357'], { stdio: 'pipe' });
    const historical = JSON.parse(fs.readFileSync(path.join(archive, 'historical', '000', 'request.json'), 'utf8'));
    assert.deepEqual(JSON.parse(historical.userPrompt), {word:expected});
  } finally { setDb(null); db?.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
