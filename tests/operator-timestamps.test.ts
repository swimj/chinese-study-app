import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTimestampFormatter, defaultTimestampDisplay, timestampDisplayLabel, timestampZone, timestampZoneOptions } from '../src/pages/operator-timestamps.ts';
import { TimestampDisplayControl } from '../src/pages/TimestampDisplayControl.tsx';
import { ModelInvocationTable } from '../src/pages/ModelInvocationsPanel.tsx';
import type { ModelInvocationRow } from '../src/domain/model-invocations.ts';

test('UTC default keeps calendar date and seconds; named zones cross midnight and support fractional offsets', () => {
  const timestamp = '2026-10-13T02:03:04.123Z';
  assert.equal(createTimestampFormatter(defaultTimestampDisplay)(timestamp), '2026-10-13 02:03:04 UTC');
  assert.equal(createTimestampFormatter({ mode: 'zone', zone: 'America/New_York' })(timestamp), '2026-10-12 22:03:04 GMT-4');
  assert.equal(createTimestampFormatter({ mode: 'zone', zone: 'Asia/Kathmandu' })(timestamp), '2026-10-13 07:48:04 GMT+5:45');
});

test('named-zone offsets track daylight saving and distinguish repeated wall-clock hours', () => {
  const format = createTimestampFormatter({ mode: 'zone', zone: 'America/New_York' });
  assert.equal(format('2026-01-01T12:00:00Z'), '2026-01-01 07:00:00 GMT-5');
  assert.equal(format('2026-07-01T12:00:00Z'), '2026-07-01 08:00:00 GMT-4');
  assert.equal(format('2026-11-01T05:30:00Z'), '2026-11-01 01:30:00 GMT-4');
  assert.equal(format('2026-11-01T06:30:00Z'), '2026-11-01 01:30:00 GMT-5');
});

test('local mode follows runtime zone and ignores the remembered named zone', () => {
  const local = { mode: 'local' as const, zone: 'Asia/Tokyo' };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(timestampZone(local), zone);
  assert.equal(timestampDisplayLabel(local), `Local: ${zone}`);
  assert.equal(createTimestampFormatter(local)('2026-10-13T02:00:00Z'), createTimestampFormatter({ mode: 'zone', zone })('2026-10-13T02:00:00Z'));
  const options = timestampZoneOptions();
  assert.ok(options.includes('UTC') && options.includes(zone));
  for (const timeZone of options) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone }));
});

test('control offers three modes and reveals named selector only for specific-zone mode', () => {
  const render = (mode: 'utc' | 'local' | 'zone') => renderToStaticMarkup(createElement(TimestampDisplayControl, { value: { mode, zone: 'UTC' }, onChange: () => {} }));
  const utc = render('utc');
  assert.match(utc, /UTC<\/option>.*Local time<\/option>.*Specific time zone<\/option>/);
  assert.equal((utc.match(/<select/g) ?? []).length, 1);
  assert.equal((render('local').match(/<select/g) ?? []).length, 1);
  assert.equal((render('zone').match(/<select/g) ?? []).length, 2);
});

test('table uses chosen zone while retaining ISO datetime and explicit UTC day grouping', () => {
  const row: ModelInvocationRow = { id: 'test', timestamp: '2026-10-13T02:03:04.123Z', provider: 'openai', model: 'test', invocationType: 'reflection', learnerId: 'test', userDisplayName: null, spendUsd: null, spendSource: 'unknown', status: 'completed', latencyMs: null };
  const markup = renderToStaticMarkup(createElement(ModelInvocationTable, { rows: [row], groupBy: 'day', timestampDisplay: { mode: 'zone', zone: 'America/New_York' } }));
  assert.match(markup, /Timestamp \(America\/New_York\)/);
  assert.match(markup, /dateTime="2026-10-13T02:03:04.123Z"/);
  assert.match(markup, /2026-10-12 22:03:04 GMT-4/);
  assert.match(markup, /2026-10-13<span/);
});
