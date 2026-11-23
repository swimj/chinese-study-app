// npm run journal:media-report: what the media job decided and what the board
// shows, read without opening the journal for work. Prints terms and the
// model's reasons, which come from the learner's journal; treat the output as
// personal data when it is run against the live journal or a copy.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJournal } from './journal.ts';
import { DAILY_LIMIT } from './media/job.ts';
import type { MediaAnchor } from './media/model.ts';
import { compose, tasteCaps } from './public/media-policy.js';
import { copyPath, fixturePath, livePath } from './storage.ts';

const checkout = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes('--' + name);
const option = (name: string) => args.find((a) => a.startsWith('--' + name + '='))?.split('=')[1];

export function reportPath(env: Record<string, string | undefined> = process.env) {
  if (env.JOURNAL_DB) return env.JOURNAL_DB;
  const profile = flag('live') ? 'live' : flag('copy') ? 'copy' : env.JOURNAL_PROFILE || 'fixture';
  if (profile === 'live') return livePath(env);
  if (profile === 'copy') return copyPath(checkout);
  return fixturePath(checkout);
}

type View = ReturnType<typeof readJournal>['view'];
function termFor(view: View, anchor: MediaAnchor) {
  if (anchor.kind === 'word') return view.saved.find((w) => w.id === anchor.id)?.title ?? '(word removed)';
  if (anchor.kind === 'annotation') return view.annotationThreads.find((t) => t.id === anchor.id)?.anchor.quote ?? '(note removed)';
  return anchor.id;
}
const day = (iso?: string) => (iso ? iso.replace('T', ' ').slice(0, 16) : '');

export function mediaReport(path: string, now = Date.now(), limit = 20) {
  const { view, mediaDecisions, mediaJobs } = readJournal(path);
  const levels = compose(view, now);
  const today = new Date(now).toISOString().slice(0, 10);
  const ran = mediaJobs.filter((j) => (j.status === 'done' || j.status === 'failed') && j.finishedAt?.startsWith(today)).length;
  const caps = [...tasteCaps(view.media, now)].map(([referent, until]) => referent + ' until ' + day(new Date(until).toISOString()));
  const lines = [
    'Media report · ' + path,
    'Pictures ' + view.settings.pictures + ' · model turns today ' + ran + '/' + DAILY_LIMIT +
      ' · pending ' + mediaJobs.filter((j) => j.status === 'pending').length +
      ' · taste caps ' + (caps.length ? caps.join(', ') : 'none'),
    '',
    'On the board (' + view.media.length + ')',
  ];
  for (const m of view.media) {
    const verdict = levels[m.id];
    const j = m.judgment;
    const reactions = Object.entries(m.reactions).map(([k, v]) => k + ' ' + day(v)).join(', ');
    lines.push(
      '  ' + m.caption + ' · ' + m.kind + ' · ' + m.origin + ' · ceiling ' + m.ceiling + ' → shown ' + verdict.level +
        (verdict.reasons.length ? ' (' + verdict.reasons.join(', ') + ')' : '') + (reactions ? ' · ' + reactions : ''),
      '      ' + (j ? [j.referent, j.senseMatch, j.addedValue, j.truthfulness, j.tone].join(' · ') + ' · ' : '') +
        (m.credit?.text ?? m.source.title ?? '') + ' · ' + m.source.pageUrl,
    );
  }
  lines.push('', 'Recent decisions (newest ' + Math.min(limit, mediaDecisions.length) + ' of ' + mediaDecisions.length + ')');
  for (const d of mediaDecisions.slice(-limit).reverse()) {
    const j = d.judgment;
    lines.push(
      '  ' + day(d.at) + ' · ' + d.anchor.kind + ' ' + termFor(view, d.anchor) + ' · ' +
        [j.referent, j.senseMatch, j.addedValue, j.truthfulness, j.tone].join(' · ') + ' → ' + d.ceiling +
        (d.mediaId ? ' (attached)' : ''),
    );
    for (const [field, reason] of Object.entries(j.reasons)) if (reason) lines.push('      ' + field + ': ' + reason);
  }
  const unfinished = mediaJobs.filter((j) => j.status === 'failed' || j.status === 'skipped').slice(-limit).reverse();
  if (unfinished.length) {
    lines.push('', 'Skipped or failed jobs (newest ' + unfinished.length + ')');
    for (const j of unfinished) lines.push('  ' + day(j.finishedAt) + ' · ' + j.status + ' · ' + j.anchor.kind + ' ' + termFor(view, j.anchor) + ' · ' + (j.outcome ?? ''));
  }
  return { text: lines.join('\n'), levels, decisions: mediaDecisions, jobs: mediaJobs, media: view.media, settings: view.settings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = mediaReport(reportPath(), Date.now(), Number(option('limit')) || 20);
    if (flag('json')) {
      const { text, ...data } = report;
      console.log(JSON.stringify(data, null, 2));
    } else console.log(report.text);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
