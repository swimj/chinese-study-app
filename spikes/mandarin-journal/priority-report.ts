// Prints what the journal would practice next and why, without opening the
// journal for work. Reads the fixture by default; --copy or --live reads those.
// Its output quotes the learner's words, so treat a report on real data like a copy.
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { reportPath } from './media-report.ts';
import { priorityOf } from './journal.ts';
import { lifecycle, POLICY_IDS, type Lifecycle, type PolicyId } from './lifecycle.ts';
import { signalsFrom, type Signal } from './priority.ts';
import { events, hasRecord, judgments, meta, targets } from './record.ts';
import type { Notice } from './situations/notice.ts';

/** One newly taught word in the graduation experiment, replayed under every policy. */
export type ExperimentRow = { form: string; taughtAt: string; assigned: PolicyId; version: string; under: Record<PolicyId, Lifecycle> };
/** Per policy: its assigned words, and every taught word scored in shadow as if it had that policy. */
export type PolicyScore = { words: number; graduated: number; checkupsTaken: number; checkupsPassed: number; recallsToGraduate: number[] };

/**
 * The graduation experiment, derived from the record. Each word taught on a lesson
 * card keeps the policy it was assigned; the same evidence is replayed under every
 * policy. Shadow scores are counterfactual: the recalls actually asked for followed
 * the assigned policy's schedule.
 */
export function graduationExperiment(signals: Signal[]) {
  const rows: ExperimentRow[] = [];
  const lessons = signals.filter((s) => s.role === 'taught' && s.graduation && s.at).sort((a, b) => a.at!.localeCompare(b.at!));
  for (const lesson of lessons) {
    if (rows.some((r) => r.form === lesson.form)) continue;
    const outcomes = signals
      .filter((s) => s.form === lesson.form && s.exercise && s.at)
      .map((s) => ({ at: s.at!, correct: s.role !== 'missed', typed: s.exercise === 'recall' }));
    const under = Object.fromEntries(POLICY_IDS.map((p) => [p, lifecycle(p, lesson.at!, outcomes)])) as Record<PolicyId, Lifecycle>;
    rows.push({ form: lesson.form, taughtAt: lesson.at!, assigned: lesson.graduation!.policy, version: lesson.graduation!.version, under });
  }
  const score = (lives: Lifecycle[]): PolicyScore => ({
    words: lives.length,
    graduated: lives.filter((l) => l.recallsToGraduate !== null).length,
    checkupsTaken: lives.reduce((n, l) => n + l.checkups.length, 0),
    checkupsPassed: lives.reduce((n, l) => n + l.checkups.filter((c) => c.passed).length, 0),
    recallsToGraduate: lives.flatMap((l) => (l.recallsToGraduate === null ? [] : [l.recallsToGraduate])),
  });
  const assigned = Object.fromEntries(POLICY_IDS.map((p) => [p, score(rows.filter((r) => r.assigned === p).map((r) => r.under[p]))])) as Record<PolicyId, PolicyScore>;
  const shadow = Object.fromEntries(POLICY_IDS.map((p) => [p, score(rows.map((r) => r.under[p]))])) as Record<PolicyId, PolicyScore>;
  return { rows, assigned, shadow };
}

const place = (l: Lifecycle) =>
  l.state === 'first' ? 'first recall'
  : l.state === 'settling' ? `${l.clean}/${l.needed} clean, due ${l.due}`
  : l.state === 'graduated' ? `graduated, check-up ${l.due}`
  : `checked ${l.checkups.at(-1)!.passed ? 'pass' : 'miss'}`;
const describeScore = (s: PolicyScore) => {
  const mean = s.recallsToGraduate.length ? (s.recallsToGraduate.reduce((a, b) => a + b, 0) / s.recallsToGraduate.length).toFixed(1) : '–';
  return `${s.words} ${s.words === 1 ? 'word' : 'words'} · ${s.graduated} graduated · check-ups ${s.checkupsPassed}/${s.checkupsTaken} passed · ${mean} recalls to graduate`;
};
export function experimentText(experiment: ReturnType<typeof graduationExperiment>): string[] {
  const lines = ['', `Graduation experiment · ${experiment.rows.length} ${experiment.rows.length === 1 ? 'word' : 'words'} taught on lesson cards`];
  if (!experiment.rows.length) return lines;
  for (const r of experiment.rows)
    lines.push(`  ${r.form} · taught ${r.taughtAt.slice(0, 10)} · assigned ${r.assigned} (${r.version})
         ` +
      POLICY_IDS.map((p) => `${p}${p === r.assigned ? '*' : ''}: ${place(r.under[p])}`).join(' · '));
  lines.push('  Assigned (each policy over its own words)');
  for (const p of POLICY_IDS) lines.push(`    ${p}: ${describeScore(experiment.assigned[p])}`);
  lines.push('  Shadow (every word replayed under each policy)');
  for (const p of POLICY_IDS) lines.push(`    ${p}: ${describeScore(experiment.shadow[p])}`);
  return lines;
}

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
      lines.push(`  ${r.score.toFixed(2).padStart(5)}  ${r.target.form}${r.target.gloss ? ' · ' + r.target.gloss.slice(0, 40) : ''}  [${r.target.origin}] ${r.purpose}${r.stage ? ' · ' + r.stage : ''}${r.contrast ? ' · contrast' : ''}\n         ${r.reasons.join(' · ')}`);
    const needs = allJudgments
      .filter((j) => !j.source.startsWith('rule:') && (j.body as Notice).needs?.length)
      .slice(-10)
      .reverse();
    if (needs.length) {
      lines.push('', 'Latest needs noticed');
      for (const j of needs)
        for (const n of (j.body as Notice).needs) lines.push(`  ${j.at.slice(0, 16).replace('T', ' ')} · ${n.form} (${n.gloss}) from “${n.evidence}”${n.note ? ' · ' + n.note : ''}`);
    }
    const byId = new Map(allEvents.map((e) => [e.id, e]));
    const experiment = graduationExperiment(signalsFrom(allJudgments, byId));
    lines.push(...experimentText(experiment));
    return { text: lines.join('\n'), ranked, experiment };
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 25;
    const report = priorityReport(reportPath(), new Date(), limit);
    if (process.argv.includes('--json'))
      console.log(JSON.stringify({ ranked: report.ranked.slice(0, limit).map(({ life, ...r }) => r), experiment: report.experiment }, null, 2));
    else console.log(report.text);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
