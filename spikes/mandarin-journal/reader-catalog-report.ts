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
    const decisions = [...ledger.rows()];
    const byId = new Map(decisions.map(row => [row.id, row]));
    const rows = decisions.sort((a, b) => a.completedAt.localeCompare(b.completedAt)).map(row => ({
      id: row.id, completedAt: row.completedAt, form: row.result.answer?.span ?? row.input.text.slice(row.input.start, row.input.end),
      gloss: row.result.answer?.gloss ?? '', route: row.result.route,
      passage: row.input.text, start: row.result.start, end: row.result.end,
      previousAnswer: row.previousDecisionId ? byId.get(row.previousDecisionId)?.result.answer ?? null : null, previousDecisionId: row.previousDecisionId ?? null,
      revision: row.revision ?? null, feedback: row.feedback, receipt: receipts.get(row.id) ?? null,
      catalogLabel: senses.get(receipts.get(row.id)?.senseId ?? '') ?? null, superseded: superseded.has(row.id),
    })).filter(row => matches([row.id, row.form, row.gloss, row.catalogLabel ?? '', row.receipt?.senseId ?? '']));
    if (values.json) return JSON.stringify(rows, null, 2);
    return rows.map(row => {
      const receipt = row.receipt;
      const details = [row.catalogLabel, receipt?.reason, row.superseded && 'superseded by a second look',
        row.feedback && 'marked wrong'].filter(Boolean).join(' · ');
      const before = row.passage.slice(Math.max(0, row.start - 16), row.start);
      const after = row.passage.slice(row.end, row.end + 16);
      const prior = row.previousAnswer;
      return [
        [row.completedAt, row.form, receipt?.outcome ?? 'pending'].join('  '),
        '  ' + before + '【' + row.passage.slice(row.start, row.end) + '】' + after,
        prior && '  Earlier answer  ' + prior.span + ' · ' + prior.gloss,
        row.gloss && '  Reader answer  ' + row.gloss,
        details && '  ' + details,
        '  ' + row.id,
      ].filter(Boolean).join('\n');
    }).join('\n\n') || 'No matching lookup decisions.';
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

function escapeHtml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function dictionaryPage(databasePath: string, params: URLSearchParams) {
  const changes = params.get('view') === 'changes';
  const query = params.get('q') || '';
  const args = changes ? ['--changes'] : [];
  const report = dictionaryReport(databasePath, [...args, '--', query]);
  const link = (label: string, view: string, current: boolean) => {
    const search = new URLSearchParams();
    if (view === 'changes') search.set('view', view);
    if (query) search.set('q', query);
    return '<a href="/operator/dictionary?' + escapeHtml(search.toString()) + '"' +
      (current ? ' aria-current="page"' : '') + '>' + label + '</a>';
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reader dictionary · Journal operator</title>
<style>
  :root { color-scheme: light dark; font: 110%/1.55 system-ui, sans-serif }
  body { max-width: 62rem; margin: auto; padding: clamp(1rem, 4vw, 3rem) }
  h1 { font: 2rem/1.2 Georgia, serif; margin: 0 0 1rem }
  nav, form { display: flex; flex-wrap: wrap; gap: .7rem; align-items: center; margin-bottom: 1rem }
  a { color: inherit; text-underline-offset: .2em } [aria-current] { font-weight: bold }
  input, button { font: inherit; box-sizing: border-box; padding: .3rem .5rem; max-width: 100% }
  pre { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; border-top: 1px solid GrayText; padding-top: 1rem }
</style></head><body><main><h1>Reader dictionary</h1>
<nav aria-label="Dictionary views">${link('Entries', 'entries', !changes)} ${link('Change ledger', 'changes', changes)}</nav>
<form role="search" method="get">${changes ? '<input type="hidden" name="view" value="changes">' : ''}
<input type="search" aria-label="Search dictionary" name="q" value="${escapeHtml(query)}"><button>Search</button></form>
<pre>${escapeHtml(report)}</pre></main></body></html>`;
}
