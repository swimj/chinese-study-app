import { useEffect, useState } from 'react';
import type { ContentSharingDigest, ContentSharingExample, ContentSharingKind } from '../domain/content-sharing';
import { sharingTimestamp, sharingWeekLabel, shiftSharingWeek } from '../features/operator/sharing-presentation';
import { fetchContentSharingDigest } from '../services/api';

const attemptsLabel = (value: number) => `${value.toLocaleString()} ${value === 1 ? 'attempt' : 'attempts'}`;

const KIND_LABELS: Record<ContentSharingKind, string> = {
  introduction: 'Introduction', rehearsal: 'Practice exercise', production_cue: 'Production cue', pure_cue: 'Standalone cue',
};

export function ContentSharingPanel() {
  const [week, setWeek] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [payload, setPayload] = useState<ContentSharingDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    void fetchContentSharingDigest(week).then(next => {
      if (!cancelled) setPayload(next);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load content sharing.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [week, refresh]);
  // Fence the previous response immediately when week navigation changes state.
  const visiblePayload = payload && (week === undefined || payload.weekStart === week) ? payload : null;
  return <section className="content-sharing-panel stack" aria-label="Weekly content sharing">
    <div className="sharing-heading">
      <div><h2>Weekly sharing digest</h2><p className="notes">How prepared content reaches another learner.</p></div>
      <button type="button" className="secondary-button" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh digest</button>
    </div>
    <div className="sharing-week-controls" aria-label="Digest week">
      <button type="button" className="secondary-button" disabled={loading || !visiblePayload}
        onClick={() => visiblePayload && setWeek(shiftSharingWeek(visiblePayload.weekStart, -1))}>Previous week</button>
      <button type="button" className="secondary-button" disabled={loading || !visiblePayload || visiblePayload.isCurrentWeek}
        onClick={() => visiblePayload && setWeek(shiftSharingWeek(visiblePayload.weekStart, 1))}>Next week</button>
      <button type="button" className="secondary-button" disabled={loading || week === undefined}
        onClick={() => setWeek(undefined)}>Current week</button>
    </div>
    {loading && <p role="status">Loading sharing digest…</p>}
    {error && <p role="alert">{error} Use Refresh digest to try again.</p>}
    {!loading && !error && visiblePayload && <ContentSharingReport payload={visiblePayload} />}
  </section>;
}

export function ContentSharingReport({ payload }: { payload: ContentSharingDigest }) {
  const groups = new Map<string, ContentSharingExample[]>();
  for (const example of payload.examples) {
    const key = example.wordId === null ? `content:${example.contentKey}` : `word:${example.wordId}`;
    const group = groups.get(key) ?? [];
    group.push(example);
    groups.set(key, group);
  }
  const reused = payload.newlyReused;
  const total = reused.introductions + reused.rehearsals + reused.reviewCues;
  return <div className="sharing-report">
    <div className="sharing-period"><strong>{sharingWeekLabel(payload.weekStart, payload.weekEnd)} · UTC</strong>
      <span className="notes">{payload.isCurrentWeek ? 'Week in progress' : 'Completed week'} · Refreshed {sharingTimestamp(payload.generatedAt)} UTC</span>
    </div>
    <div className="sharing-metrics">
      <SharingMetric label="Introductions newly reused" value={reused.introductions} note="Reached a second learner this week" />
      <SharingMetric label="Practice exercises newly reused" value={reused.rehearsals} note="Exact content reached a second learner" />
      <SharingMetric label="Reflection cues used by others" value={payload.reflectionCuesAttemptedByOthers.total} note="Attempted by someone other than their originator" />
    </div>
    <p className="notes">Review cue versions newly reused: <strong>{reused.reviewCues.toLocaleString()}</strong>.
      {' '}Reflection reuse includes {payload.reflectionCuesAttemptedByOthers.productionCues.toLocaleString()} production
      {' '}and {payload.reflectionCuesAttemptedByOthers.pureCues.toLocaleString()} standalone cues.</p>
    <h3>Sharing examples this week</h3>
    {total === 0 && <p>No recorded content reached its second learner this week.
      {payload.reflectionCuesAttemptedByOthers.total > 0 && ' Learner-originated cues were still used by other learners, as counted above.'}</p>}
    {payload.examples.length > 0 && <>
      <p className="notes">{payload.examples.length < total ? `Showing ${payload.examples.length} of ${total.toLocaleString()} newly reused items.` : 'Items that reached a second learner this week.'}</p>
      <div className="sharing-examples">{[...groups.entries()].map(([key, examples]) => <SharingExampleGroup key={key} examples={examples} />)}</div>
    </>}
    <div className="sharing-context"><h3>Sharing potential · current</h3>
      <p><strong>{payload.overlap.wordsStudiedByMultipleLearners.toLocaleString()} words</strong> have Practice or Review state for multiple learners,
        {' '}out of {payload.overlap.studiedWords.toLocaleString()} studied words.</p>
      <p className="notes">Includes historical/imported progress. This current overlap is separate from confirmed reuse in the selected week.</p>
    </div>
    <details className="sharing-definitions"><summary>Counting rules and coverage</summary>
      <dl>
        <dt>Newly reused</dt><dd>A distinct content item reaches its second learner for the first time during this UTC week. Earlier first use can be in any week. Repeated encounters and a third learner do not count again.</dd>
        <dt>What counts as use</dt><dd>Introductions use recorded package openings. Practice and review use exact frozen content encounters. An opening or encounter alone does not prove a completed study session.</dd>
        <dt>Reflection cues used by others</dt><dd>Distinct shared cues originating from a learner, with a recorded attempt this week by another learner. This count follows cue identity; it does not establish identical served text after a revision.</dd>
        <dt>Reporting period</dt><dd>Monday 00:00 through the following Monday 00:00 UTC. Past weeks are reconstructed from available records; the current week is partial.</dd>
        <dt>Evidence limits</dt><dd>{payload.coverageNotes.map((note, index) => <p key={index}>{note}</p>)}</dd>
      </dl>
    </details>
  </div>;
}

function SharingMetric({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="operator-usage-tile"><div className="operator-usage-tile-label">{label}</div>
    <div className="sharing-metric-value">{value.toLocaleString()}</div><p className="notes">{note}</p></div>;
}

function SharingExampleGroup({ examples }: { examples: ContentSharingExample[] }) {
  const first = examples[0];
  const kinds = [...new Set(examples.map(example => example.kind))];
  const summary = kinds.map(kind => {
    const count = examples.filter(example => example.kind === kind).length;
    return `${count.toLocaleString()} ${KIND_LABELS[kind].toLowerCase()}${count === 1 ? '' : 's'}`;
  }).join(' · ');
  return <article className="stat-card sharing-example">
    <div className="sharing-example-heading">
      <h4>{first.word ? <>{first.word.hanzi} <span className="notes">{first.word.pinyin}</span></> : first.title}</h4>
      <span className="sharing-learner-count">{examples.length.toLocaleString()} newly reused {examples.length === 1 ? 'item' : 'items'}</span>
    </div>
    <p>{summary} reached a second learner this week.</p>
    <details><summary>See reuse evidence</summary>
      <div className="sharing-evidence-list">{examples.map((example, index) => <section key={example.contentKey} aria-label={`${KIND_LABELS[example.kind]} evidence ${index + 1}`}>
        <h5>{KIND_LABELS[example.kind]}{examples.filter(e => e.kind === example.kind).length > 1 ? ` · ${examples.slice(0, index + 1).filter(e => e.kind === example.kind).length}` : ''}</h5>
        {(example.kind === 'production_cue' || example.kind === 'pure_cue') && <p className="notes">{example.title}</p>}
        <p>A second learner {example.kind === 'introduction' ? 'opened this introduction' : 'encountered this exact content'}
          {' '}on {sharingTimestamp(example.secondLearnerUsedAt)} UTC.</p>
        <dl className="sharing-evidence">
          <dt>Exact content reference</dt><dd><code>{example.contentKey}</code></dd>
          <dt>First learner’s use</dt><dd>{sharingTimestamp(example.firstUsedAt)} UTC</dd>
          <dt>Second learner’s first use</dt><dd>{sharingTimestamp(example.secondLearnerUsedAt)} UTC</dd>
          <dt>Learners with recorded use</dt><dd>{example.learnerCount.toLocaleString()} through this report’s cutoff</dd>
          {example.completedLearnerCount !== null && <><dt>Introduction completions</dt><dd>{example.completedLearnerCount.toLocaleString()} distinct learners</dd></>}
          {example.generation && <><dt>Recorded preparation for this word</dt><dd>
            Bootstrap: {attemptsLabel(example.generation.bootstrapAttempts)} ({example.generation.bootstrapSuccessfulAttempts.toLocaleString()} successful).
            {' '}Teaching: {attemptsLabel(example.generation.teachingAttempts)} ({example.generation.teachingSuccessfulAttempts.toLocaleString()} successful).
            <p className="notes">Word-level preparation records; these counts do not by themselves establish how many provider calls produced this exact item.</p>
          </dd></>}
        </dl>
      </section>)}</div>
    </details>
  </article>;
}
