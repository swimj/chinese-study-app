// Prints what the journal would practice next and why, without opening the
// journal for work. Reads the fixture by default; --copy or --live reads those.
// Its output quotes the learner's words, so treat a report on real data like a copy.
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { reportPath } from './media-report.ts';
import { priorityOf } from './journal.ts';
import { events, hasRecord, judgments, meta, targets } from './record.ts';
import type { Notice } from './situations/notice.ts';

export function priorityReport(path: string, now = new Date(), limit = 25) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (!hasRecord(db)) throw new Error('This journal has no record yet. Open it once with the current version.');
    const ranked = priorityOf(db, now);
    const allTargets = targets(db);
    const allEvents = events(db);
    const allJudgments = judgments(db);
    const judged = new Set(allJudgments.map((j) => j.eventId));
    const imported = meta(db, 'hosted_import');
    const byOrigin = new Map<string, number>();
    for (const t of allTargets) byOrigin.set(t.origin, (byOrigin.get(t.origin) ?? 0) + 1);
    const lines = [
      `Record · ${allEvents.length} events (${judged.size} judged) · ${allJudgments.length} judgments · judging events from ${meta(db, 'judge_from') ?? '?'}`,
      `Targets · ${[...byOrigin].map(([k, v]) => k + ' ' + v).join(' · ') || 'none'}`,
      imported ? 'Hosted import · ' + imported : 'Hosted import · none',
      '',
      `Open: ${ranked.filter((r) => r.pressing).length} weaknesses or settling words · new words admitted today: ${ranked.filter((r) => r.fresh).length}`,
      `Top ${Math.min(limit, ranked.length)} of ${ranked.length} with any priority`,
    ];
    for (const r of ranked.slice(0, limit))
      lines.push(`  ${r.score.toFixed(2).padStart(5)}  ${r.target.form}${r.target.gloss ? ' · ' + r.target.gloss.slice(0, 40) : ''}  [${r.target.origin}] ${r.purpose}${r.contrast ? ' · contrast' : ''}\n         ${r.reasons.join(' · ')}`);
    const needs = allJudgments
      .filter((j) => !j.source.startsWith('rule:') && (j.body as Notice).needs?.length)
      .slice(-10)
      .reverse();
    if (needs.length) {
      lines.push('', 'Latest needs noticed');
      for (const j of needs)
        for (const n of (j.body as Notice).needs) lines.push(`  ${j.at.slice(0, 16).replace('T', ' ')} · ${n.form} (${n.gloss}) from “${n.evidence}”${n.note ? ' · ' + n.note : ''}`);
    }
    return { text: lines.join('\n'), ranked };
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 25;
    const report = priorityReport(reportPath(), new Date(), limit);
    if (process.argv.includes('--json')) console.log(JSON.stringify(report.ranked.slice(0, limit), null, 2));
    else console.log(report.text);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
