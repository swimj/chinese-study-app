import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  captureClientTransportFailure,
  appendPendingClientTransportIncident,
  readPendingClientTransportIncidents,
  removeUploadedClientTransportIncidents,
  type ClientIncidentStorage,
} from '../src/services/client-incident-diagnostics.ts';
import {
  CLIENT_INCIDENT_DIAGNOSTICS_FILENAME,
  createClientIncidentDiagnosticSink,
  readClientIncidentDiagnostics,
} from '../server/client-incident-diagnostics.ts';
import type { ClientTransportIncident } from '../src/domain/client-incidents.ts';

describe('client transport incident diagnostics', () => {
  test('captures a bounded account-scoped incident and keeps the original failure as its cause', () => {
    const storage = createMemoryStorage();
    const original = new TypeError('Failed to fetch\nrequest body must not appear');
    const error = captureClientTransportFailure({
      error: original,
      phase: 'fetch',
      context: {
        route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
        sessionId: 'session-1',
        sessionActionId: 'review/word-1/recognition',
        eventIds: ['attempt-1'],
      },
      storageScope: 'user-1',
      storage,
      appVersion: '2.3.0',
      startedAtMs: Date.parse('2026-09-11T01:59:59.750Z'),
      now: new Date('2026-09-11T02:00:00.000Z'),
      diagnosticId: 'client-incident-1',
      online: false,
      visibilityState: 'visible',
    });

    assert.equal(error.name, 'ClientTransportError');
    assert.match(error.message, /Failed to fetch request body must not appear/);
    assert.match(error.message, /Client incident ID: client-incident-1/);
    assert.equal(error.cause, original);
    const [incident] = readPendingClientTransportIncidents(
      storage,
      'user-1',
      Date.parse('2026-09-11T02:00:00.000Z'),
    );
    assert.deepEqual(incident, {
      schemaVersion: 'client_transport_incident.v1',
      event: 'client_transport.failed',
      diagnosticId: 'client-incident-1',
      at: '2026-09-11T02:00:00.000Z',
      appVersion: '2.3.0',
      route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
      method: 'POST',
      phase: 'fetch',
      elapsedMs: 250,
      correlation: {
        sessionId: 'session-1',
        sessionActionId: 'review/word-1/recognition',
        eventIds: ['attempt-1'],
      },
      browser: { online: false, visibilityState: 'visible' },
      error: { name: 'TypeError', message: 'Failed to fetch request body must not appear' },
    });
    assert.deepEqual(readPendingClientTransportIncidents(storage, 'user-2'), []);
  });

  test('drops expired and malformed records, caps the queue, and removes only uploaded ids', () => {
    const storage = createMemoryStorage();
    const nowMs = Date.parse('2026-09-11T02:00:00.000Z');
    appendPendingClientTransportIncident(storage, 'user-1', incident('expired', '2026-07-01T00:00:00.000Z'), nowMs);
    for (let index = 0; index < 22; index += 1) {
      appendPendingClientTransportIncident(
        storage,
        'user-1',
        incident(`current-${index}`, new Date(nowMs - index * 1_000).toISOString()),
        nowMs,
      );
    }

    const pending = readPendingClientTransportIncidents(storage, 'user-1', nowMs);
    assert.equal(pending.length, 20);
    assert.equal(pending.some((record) => record.diagnosticId === 'expired'), false);
    assert.equal(pending.some((record) => record.diagnosticId === 'current-0'), false);
    assert.equal(pending.some((record) => record.diagnosticId === 'current-1'), false);

    removeUploadedClientTransportIncidents(storage, 'user-1', ['current-2'], nowMs);
    const retained = readPendingClientTransportIncidents(storage, 'user-1', nowMs);
    assert.equal(retained.length, 19);
    assert.equal(retained.some((record) => record.diagnosticId === 'current-2'), false);

    storage.setItem('chinese-study-app.client-transport-incidents.v1:malformed', '{');
    assert.deepEqual(readPendingClientTransportIncidents(storage, 'malformed', nowMs), []);
  });

  test('persists, deduplicates, prunes, and inspects uploaded incidents', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-client-incidents-'));
    const logLines: string[] = [];
    try {
      createClientIncidentDiagnosticSink(dataDir, {
        now: () => new Date('2026-07-01T00:00:00.000Z'),
        logLine: () => undefined,
      }).record({ learnerId: 'learner-1', incident: incident('expired', '2026-07-01T00:00:00.000Z') });
      fs.appendFileSync(path.join(dataDir, CLIENT_INCIDENT_DIAGNOSTICS_FILENAME), 'malformed\n');

      const sink = createClientIncidentDiagnosticSink(dataDir, {
        now: () => new Date('2026-09-11T02:00:00.000Z'),
        logLine: (line) => logLines.push(line),
      });
      const current = incident('current', '2026-09-11T01:59:58.000Z');
      sink.record({ learnerId: 'learner-1', incident: current });
      sink.record({ learnerId: 'learner-1', incident: current });

      const result = readClientIncidentDiagnostics({ dataDir, limit: 20 });
      assert.equal(result.totalRecordCount, 1);
      assert.equal(result.malformedRecordCount, 1);
      assert.equal(result.diagnostics[0]?.diagnosticId, 'current');
      assert.equal(result.diagnostics[0]?.learnerId, 'learner-1');
      assert.equal(result.diagnostics[0]?.receivedAt, '2026-09-11T02:00:00.000Z');
      assert.equal(result.diagnostics[0]?.runtime.processId, process.pid);
      assert.equal(logLines.length, 1);
      assert.equal(logLines[0]?.includes('Failed to fetch'), false);
      assert.equal((fs.statSync(result.diagnosticsPath).mode & 0o777), 0o600);
      assert.equal(readClientIncidentDiagnostics({
        dataDir,
        diagnosticId: 'current',
      }).diagnostics.length, 1);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

function incident(diagnosticId: string, at: string): ClientTransportIncident {
  return {
    schemaVersion: 'client_transport_incident.v1',
    event: 'client_transport.failed',
    diagnosticId,
    at,
    appVersion: '2.3.0',
    route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
    method: 'POST',
    phase: 'fetch',
    elapsedMs: 100,
    correlation: {
      sessionId: 'session-1',
      sessionActionId: 'review/word-1/recognition',
      eventIds: ['attempt-1'],
    },
    browser: { online: false, visibilityState: 'visible' },
    error: { name: 'TypeError', message: 'Failed to fetch' },
  };
}

function createMemoryStorage(): ClientIncidentStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}
