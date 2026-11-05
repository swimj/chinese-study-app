import { modelLexicalWord } from '../server/vocabulary/model-lexical-word.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdir, stat, open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryHash, validateInventorySnapshot, checkInventoryReconciliation } from './lib/sense-inventory-reconciliation.ts';
import { vocabularySenseInventorySchema, validateVocabularySenseInventory } from '../server/vocabulary/sense-inventory-contract.ts';
import { validateJsonSchema } from '../server/llm/json-schema-validator.ts';
import { createOpenAiCompatibleAdapter } from '../server/llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../server/llm/proxy-fetch.ts';
import { isOutputTruncationFinishReason, type ProviderRunRequest } from '../server/llm/types.ts';
import { snapshotInventoryForReconciliation, reportInventoryRetirements } from '../server/db/sense-inventory-reconciliation-report.ts';
import { applySenseInventoryReconciliation, inventoryReconciliationPlanHash } from '../server/db/sense-inventory-reconciliation-apply.ts';
import { assertSchemaCurrent } from '../server/db/migrations.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  database: { type: 'string' }, 'word-ids': { type: 'string' }, out: { type: 'string' }, input: { type: 'string' },
  archive: { type: 'string' }, variant: { type: 'string' }, 'baseline-revision': { type: 'string' },
  'allow-provider-calls': { type: 'boolean', default: false }, 'max-provider-calls': { type: 'string', default: '8' },
  snapshot: { type: 'string' }, candidate: { type: 'string' }, judgment: { type: 'string' },
  plan: { type: 'string' }, 'expected-plan-sha256': { type: 'string' }, 'confirm-app-stopped': { type: 'string' },
} });
const repository = fileURLToPath(new URL('..', import.meta.url));
function required(value: string | undefined, flag: string): string { if (!value?.trim()) throw new Error(`Expected --${flag}`); return value; }
async function json(file: string | undefined, flag: string): Promise<unknown> { return JSON.parse(await readFile(required(file, flag), 'utf8')); }
async function save(file: string, value: unknown): Promise<void> { await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }

if (positionals.length !== 1) throw new Error('Use export, trial, check, report, hash-plan, or apply.');
if (positionals[0] === 'export') {
  const ids = required(values['word-ids'], 'word-ids').split(',');
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Supply unique comma-separated word IDs');
  const db = new DatabaseSync(path.resolve(required(values.database, 'database')), { readOnly: true });
  try {
    db.exec('BEGIN');
    assertSchemaCurrent(db);
    const snapshots = ids.map(wordId => snapshotInventoryForReconciliation(db, wordId));
    db.exec('ROLLBACK');
    await save(path.resolve(required(values.out, 'out')), snapshots);
    console.log(JSON.stringify({ exported: snapshots.length, readOnly: true }));
  } finally { db.close(); }
} else if (positionals[0] === 'check') {
  const result = checkInventoryReconciliation(await json(values.snapshot, 'snapshot'), await json(values.candidate, 'candidate'), await json(values.judgment, 'judgment'));
  await save(path.resolve(required(values.out, 'out')), result);
  console.log(JSON.stringify({ wordId: result.wordId, structurallyValid: true, applyReady: false }));
} else if (positionals[0] === 'report') {
  const snapshot = validateInventorySnapshot(await json(values.snapshot, 'snapshot'));
  const candidate = await json(values.candidate, 'candidate');
  const judgment = await json(values.judgment, 'judgment');
  const checked = checkInventoryReconciliation(snapshot, candidate, judgment);
  const retired = checked.groups.filter(group => group.decision === 'retire').flatMap(group => group.existingSenseIds);
  const report = reportInventoryRetirements(snapshot, retired);
  const reportSha256 = inventoryHash(report);
  await save(path.resolve(required(values.out, 'out')), {
    report, reportSha256,
    unsupportedDecisions: checked.groups.filter(group => !['retain', 'retire'].includes(group.decision)),
    plan: { snapshot, candidate, judgment, reportSha256,
      contentDecisions: report.affectedContent.map(content => ({ contentId: content.contentId,
        decision: content.requiredRetirement ? 'retire' : 'REVIEW_REQUIRED', rationale: '' })) },
    instruction: 'Review every content decision and rationale. Assemble approved word plans in {operationId,actorId,plans:[...]}; hash-plan prints its exact hash. Only retain/retire sense decisions are supported by apply.',
  });
  console.log(JSON.stringify({ wordId: snapshot.word.wordId, reportSha256, affectedContent: report.affectedContent.length, blockers: report.blockers }));
} else if (positionals[0] === 'hash-plan') {
  const plan = await json(values.plan, 'plan');
  console.log(JSON.stringify({ planSha256: inventoryReconciliationPlanHash(plan), applied: false }));
} else if (positionals[0] === 'apply') {
  if (values['confirm-app-stopped'] !== 'true') throw new Error('Stop app and provider workers, verify a recovery backup, then pass --confirm-app-stopped=true.');
  const database = required(values.database, 'database');
  if (!path.isAbsolute(database) || !(await stat(database)).isFile()) throw new Error('--database must name an existing absolute database file');
  const plan: unknown = await json(values.plan, 'plan');
  const expectedPlanSha256 = required(values['expected-plan-sha256'], 'expected-plan-sha256');
  if (inventoryReconciliationPlanHash(plan) !== expectedPlanSha256) throw new Error('Plan hash does not match the reviewed plan');
  // Reserve the receipt destination before any database mutation; retries can recover the DB receipt.
  const receiptFile = await open(path.resolve(required(values.out, 'out')), 'wx', 0o600);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(database);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.function('current_learner_id', () => { throw new Error('Reconciliation requires explicit learner ownership'); });
    assertSchemaCurrent(db);
    const receipt = applySenseInventoryReconciliation(db, { ...plan as Record<string, unknown>, confirmAppStopped: true, expectedPlanSha256 });
    await receiptFile.writeFile(JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt));
  } finally { db?.close(); await receiptFile.close(); }
} else if (positionals[0] === 'trial') {
  const input = await json(values.input, 'input');
  if (!Array.isArray(input) || input.length < 1 || input.length > 32) throw new Error('Expected one to 32 snapshots');
  const snapshots = input.map(validateInventorySnapshot);
  if (new Set(snapshots.map(snapshot => snapshot.word.wordId)).size !== snapshots.length) throw new Error('Repeated input word');
  const maxCalls = Number(values['max-provider-calls']);
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 32 || (values['allow-provider-calls'] && snapshots.length > maxCalls)) throw new Error('Invalid or insufficient provider call budget (maximum 32)');
  const archive = path.resolve(required(values.archive, 'archive')), variant = required(values.variant, 'variant');
  if (!/^[a-zA-Z0-9_-]+$/.test(variant)) throw new Error('Use a file-safe variant');
  const revision = values['baseline-revision'];
  if (revision && !/^[a-zA-Z0-9_./-]+$/.test(revision)) throw new Error('Invalid baseline revision');
  const resolvedRevision = execFileSync('git', ['rev-parse', revision ?? 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  const source = async (file: string): Promise<string> => revision ? execFileSync('git', ['show', `${resolvedRevision}:${file}`], { cwd: repository, encoding: 'utf8' }) : readFile(path.join(repository, file), 'utf8');
  const systemPrompt = await source('server/vocabulary/reflection-prompts/sense-inventory.md');
  const providerSource = await source('server/vocabulary/sense-readiness.ts');
  const outputSchema = structuredClone(vocabularySenseInventorySchema);
  if (revision) {
    // A supported historical contract is frozen explicitly, not silently translated.
    if (!providerSource.includes("outputSchemaName: 'vocabulary_sense_inventory_v2'") || !providerSource.includes('minItems: 1, maxItems: 16')) throw new Error('Only the historical v2 inventory schema is supported');
    outputSchema.properties!.senses.minItems = 1;
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (values['allow-provider-calls'] && !apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const directory = path.join(archive, variant);
  await mkdir(archive, { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  await save(path.join(directory, 'manifest.json'), { resolvedRevision, variant, source: revision ? 'git' : 'working-tree',
    systemPromptSha256: inventoryHash(systemPrompt), providerSourceSha256: inventoryHash(providerSource), outputSchemaSha256: inventoryHash(outputSchema),
    live: values['allow-provider-calls'], maxCalls, inputSha256: inventoryHash(input),
    scope: 'Fresh inventory generation with runtime lexical inputs. Existing inventory is retained for independent semantic reconciliation, never supplied to generation. No application or learner outcomes.' });
  const adapter = createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
    structuredOutputMode: 'json_schema', maxTokensField: 'max_completion_tokens', fetchImplementation: fetchImplementationForProvider('openai', 180_000) });
  for (const [index, snapshot] of snapshots.entries()) {
    const caseDirectory = path.join(directory, String(index).padStart(3, '0'));
    await mkdir(caseDirectory, { mode: 0o700 });
    const request: ProviderRunRequest = { model: 'gpt-5.6-luna', reasoningEffort: 'high', systemPrompt,
      userPrompt: JSON.stringify({ word: revision ? snapshot.word : modelLexicalWord(snapshot.word) }), outputSchemaName: revision ? 'vocabulary_sense_inventory_v2' : 'vocabulary_sense_inventory_v3', outputSchema,
      maxOutputTokens: 8000, temperature: null, timeoutMs: 180_000, cachePrompt: true };
    await save(path.join(caseDirectory, 'snapshot.json'), snapshot);
    await save(path.join(caseDirectory, 'request.json'), request);
    await save(path.join(caseDirectory, 'request-provenance.json'), { requestSha256: inventoryHash(request), snapshotSha256: inventoryHash(snapshot) });
    if (!values['allow-provider-calls']) continue;
    console.log(JSON.stringify({ wordId: snapshot.word.wordId, event: 'started' }));
    try {
      const result = await adapter.run(request, { apiKey: apiKey!, baseUrl: process.env.OPENAI_BASE_URL?.trim() || null });
      await save(path.join(caseDirectory, 'response.json'), result);
      const candidate: unknown = JSON.parse(result.rawText);
      const errors = validateJsonSchema(candidate, outputSchema);
      if (isOutputTruncationFinishReason(result.finishReason) || errors.length) throw new Error('Invalid inventory response');
      validateVocabularySenseInventory(candidate);
      await save(path.join(caseDirectory, 'candidate.json'), candidate);
      await save(path.join(caseDirectory, 'judgment-template.json'), { snapshotSha256: inventoryHash(snapshot), candidateSha256: inventoryHash(candidate), reviewer: '', groups: [] });
      console.log(JSON.stringify({ wordId: snapshot.word.wordId, event: 'generated', semanticReviewRequired: true }));
    } catch (error) {
      // Error messages may contain provider bodies or credentials; retain only safe classification.
      await save(path.join(caseDirectory, 'failure.json'), { name: error instanceof Error ? error.name : 'UnknownError' });
      console.log(JSON.stringify({ wordId: snapshot.word.wordId, event: 'failed' }));
    }
  }
} else throw new Error('Use export, trial, check, report, hash-plan, or apply.');
