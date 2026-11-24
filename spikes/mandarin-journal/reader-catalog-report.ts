// Read the same catalog the reader uses. Reporting never schedules work.
import { parseArgs } from 'node:util';
import { openReaderCatalog } from './reader-catalog.ts';
import { readerLedger } from './reader-ledger.ts';

export function dictionaryReport(databasePath: string, args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    changes: { type: 'boolean' }, json: { type: 'boolean' },
  } });
  if (positionals.length > 1) throw new Error('Expected at most one word or sense search.');
  const query = positionals[0]?.normalize().toLowerCase() ?? '';
  const matches = (strings: string[]) => strings.some(value => value.normalize().toLowerCase().includes(query));
  const catalog = openReaderCatalog(databasePath);
  if (values.changes) {
    const ledger = readerLedger(databasePath);
    const receipts = new Map(catalog.receipts().map(receipt => [receipt.decisionId, receipt]));
    const senses = new Map(catalog.entries().flatMap(entry => entry.senses.map(sense => [sense.senseId, sense.label] as const)));
    const superseded = new Set([...receipts.values()].filter(receipt => !receipt.flagged).map(receipt => receipt.previousDecisionId));
    const rows = [...ledger.rows()].sort((a, b) => a.completedAt.localeCompare(b.completedAt)).map(row => ({
      id: row.id, completedAt: row.completedAt, form: row.result.answer?.span ?? row.input.text.slice(row.input.start, row.input.end),
      gloss: row.result.answer?.gloss ?? '', route: row.result.route, previousDecisionId: row.previousDecisionId ?? null,
      revision: row.revision ?? null, feedback: row.feedback, receipt: receipts.get(row.id) ?? null,
      catalogLabel: senses.get(receipts.get(row.id)?.senseId ?? '') ?? null, superseded: superseded.has(row.id),
    })).filter(row => matches([row.id, row.form, row.gloss, row.catalogLabel ?? '', row.receipt?.senseId ?? '']));
    if (values.json) return JSON.stringify(rows, null, 2);
    return rows.map(row => {
      const receipt = row.receipt;
      const details = [row.catalogLabel, receipt?.reason, row.superseded && 'superseded by a second look', row.previousDecisionId && 'second look at ' + row.previousDecisionId,
        row.feedback && 'marked wrong'].filter(Boolean).join(' · ');
      return [row.completedAt, row.form, receipt?.outcome ?? 'pending', details, row.id].filter(Boolean).join('  ');
    }).join('\n') || 'No matching lookup decisions.';
  }

  const snapshot = catalog.snapshot();
  const entries = catalog.entries().map(entry => {
    const active = new Set(entry.forms.flatMap(form => snapshot.sensesFor(form).map(sense => sense.senseId)));
    return { ...entry, senses: entry.senses.map(sense => ({ ...sense, active: active.has(sense.senseId) })) };
  }).filter(entry => matches([...entry.forms, entry.pinyin, entry.wordId,
    ...entry.senses.flatMap(sense => [sense.label, sense.senseId])]));
  if (values.json) return JSON.stringify(entries, null, 2);
  return entries.map(entry => [entry.forms.join(' / ') + '  ' + entry.pinyin,
    ...entry.senses.map(sense => '  ' + sense.label + (sense.active ? '' : ' (inactive)') + '  [' + sense.senseId + ']'),
  ].join('\n')).join('\n') || 'No matching entries.';
}
