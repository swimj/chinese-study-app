import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createFileReflectionFailureArtifactSink, REFLECTION_FAILURE_ARTIFACT_DIRECTORY, REFLECTION_FAILURE_RETENTION_MS, type ReflectionFailureArtifactInput } from '../server/reflection/failure-artifacts.ts';
import { LunaReflectionProviderError } from '../server/reflection/luna-provider.ts';

const input: ReflectionFailureArtifactInput = {
  runId: 'run-1', clientRequestId: 'request-1', sourceSessionId: 'session-1',
  reflectionFlowVersion: 'test', startedAt: '2026-10-06T00:00:00Z', completedAt: '2026-10-06T00:00:01Z',
  metadata: { provider: 'test', modelConfig: 'test', providerModel: 'test', promptVersion: 'test', responseId: null, finishReason: null,
    usage: { inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null } },
  failureCode: 'invalid_json', evidenceBundle: { items: ['exact evidence'] }, error: new SyntaxError('Unexpected end of JSON input'),
};

test('private artifacts retain full rejected output and startup expires only owned files at one week', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-artifacts-'));
  try {
    let now = Date.parse('2026-10-06T00:00:00Z');
    const sink = createFileReflectionFailureArtifactSink(root, () => now);
    const diagnostic = { schemaVersion: 'reflection_generation_diagnostic.v1' as const, phase: 'json_parse' as const, issues: [], rejectedOutput: 'bounded' };
    Object.defineProperty(diagnostic, 'fullRejectedOutput', { value: 'x'.repeat(8_000) });
    sink.record({ ...input, error: new LunaReflectionProviderError('invalid_json', 0, null, null, diagnostic) });
    const dir = path.join(root, REFLECTION_FAILURE_ARTIFACT_DIRECTORY);
    const oldFile = fs.readdirSync(dir)[0];
    const stored = JSON.parse(fs.readFileSync(path.join(dir, oldFile), 'utf8'));
    assert.equal(stored.rejectedOutput.length, 8_000);
    assert.equal(stored.runId, 'run-1');
    assert.deepEqual(stored.evidenceBundle, input.evidenceBundle);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(dir, oldFile)).mode & 0o777, 0o600);
    fs.writeFileSync(path.join(dir, 'operator-note.json'), 'keep');
    fs.symlinkSync(path.join(dir, 'operator-note.json'), path.join(dir, 'failure-1000000000000-00000000-0000-0000-0000-000000000000.json'));
    now += REFLECTION_FAILURE_RETENTION_MS - 1;
    createFileReflectionFailureArtifactSink(root, () => now);
    assert.ok(fs.existsSync(path.join(dir, oldFile)));
    sink.record(input);
    now += 1;
    createFileReflectionFailureArtifactSink(root, () => now);
    assert.ok(!fs.existsSync(path.join(dir, oldFile)));
    assert.equal(fs.readdirSync(dir).length, 3); // fresh artifact, operator file, symlink
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unavailable storage is observable and never replaces the reflection failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-artifacts-'));
  const events: string[] = [];
  const original = console.error;
  console.error = (value: string) => events.push(value);
  try {
    fs.writeFileSync(path.join(root, REFLECTION_FAILURE_ARTIFACT_DIRECTORY), 'not a directory');
    const sink = createFileReflectionFailureArtifactSink(root);
    assert.doesNotThrow(() => sink.record(input));
    assert.deepEqual(events.map((event) => JSON.parse(event).event), ['reflection.failure_artifact_cleanup_failed', 'reflection.failure_artifact_write_failed']);
  } finally { console.error = original; fs.rmSync(root, { recursive: true, force: true }); }
});


test('parser causes survive privately while transport causes stay excluded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-artifacts-'));
  try {
    const sink = createFileReflectionFailureArtifactSink(root);
    sink.record({ ...input, error: new LunaReflectionProviderError('invalid_json', 1, null, null, null, new SyntaxError('bad token at position 8123')) });
    sink.record({ ...input, error: new LunaReflectionProviderError('upstream_failure', 0, null, null, null, new Error('secret transport details')) });
    const dir = path.join(root, REFLECTION_FAILURE_ARTIFACT_DIRECTORY);
    const records = fs.readdirSync(dir).map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
    const parser = records.find((record) => record.error.cause !== null);
    assert.equal(parser.error.cause.message, 'bad token at position 8123');
    assert.match(parser.error.cause.stack, /SyntaxError/);
    assert.ok(!JSON.stringify(records).includes('secret transport details'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
