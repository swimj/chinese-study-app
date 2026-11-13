import type { ReactNode } from 'react';
import { vocabularyStudyWeek } from '../domain/vocabulary-statistics';
import type { VocabularyProgress, VocabularyProgressDay, VocabularyProgressRate } from '../domain/vocabulary-progress';

const dayDate = (dayKey: string) => new Date(`${dayKey}T00:00:00.000Z`);
const weekday = (dayKey: string, style: 'short' | 'long') => dayDate(dayKey).toLocaleDateString('en-US', { weekday: style, timeZone: 'UTC' });
const shortDate = (dayKey: string) => dayDate(dayKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthLabel = (month: string) => dayDate(`${month}-01`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "1h 40m"; a measured week under a minute still reads as a minute. */
export function formatStudyTime(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000)), hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
}
/** Measured active time over the Monday-to-Sunday week containing the progress day. */
export function weekStudyTimeMs(progress: VocabularyProgress): number {
  const week = new Set(vocabularyStudyWeek({ today: progress.today, studied: [] }).map(day => day.dayKey));
  return progress.days.filter(day => week.has(day.dayKey)).reduce((sum, day) => sum + day.activeDurationMs, 0);
}
export function WeekStudyTime({ progress }: { progress: VocabularyProgress | null }) {
  const total = progress ? weekStudyTimeMs(progress) : 0;
  return total > 0 ? <span className="study-week-time">{formatStudyTime(total)} this week</span> : null;
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="home-progress-details"><summary>{summary}</summary>{children}</details>;
}

function ActivityBars({ days }: { days: readonly VocabularyProgressDay[] }) {
  const week = days.slice(-7), top = Math.max(1, ...week.map(day => day.wordItems + day.cueItems));
  const width = 280, height = 104, base = 100, slot = width / week.length, bar = slot * 0.55;
  const scale = (count: number) => (count / top) * (base - 8);
  const label = `Items practised, last 7 days: ${week.map(day => `${weekday(day.dayKey, 'long')} ${day.wordItems} word skills, ${day.cueItems} shared cues`).join('; ')}`;
  return <section className="home-progress-activity" aria-labelledby="home-progress-activity-title">
    <h3 id="home-progress-activity-title">Items practised</h3>
    <svg className="home-progress-bars" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1="0" x2={width} y1={base} y2={base} className="home-progress-axis" />
      {week.map((day, index) => {
        const x = index * slot + (slot - bar) / 2, words = scale(day.wordItems), cues = scale(day.cueItems);
        return <g key={day.dayKey}>
          {day.wordItems ? <rect className="home-progress-bar-words" x={x} y={base - words} width={bar} height={words} /> : null}
          {day.cueItems ? <rect className="home-progress-bar-cues" x={x} y={base - words - cues} width={bar} height={cues} /> : null}
        </g>;
      })}
    </svg>
    <div className="home-progress-days" aria-hidden="true">{week.map(day => <span key={day.dayKey} className="home-progress-day">{weekday(day.dayKey, 'short')}</span>)}</div>
    <ul className="home-progress-legend">
      <li><span className="home-progress-swatch is-words" aria-hidden="true" />Word skills</li>
      <li><span className="home-progress-swatch is-cues" aria-hidden="true" />Shared cues</li>
    </ul>
  </section>;
}

const excluded = (rate: VocabularyProgressRate) => <p>Not counted: {rate.void} judged unfair, {rate.pending} awaiting judgment.</p>;
function RateRow({ name, rate }: { name: string; rate: VocabularyProgressRate }) {
  return <tr>
    <th scope="row">{name}</th>
    <td>{rate.rate === null ? 'Not enough yet' : `${Math.round(rate.rate * 100)}%`}</td>
    <td>{rate.success + rate.failure}</td>
  </tr>;
}

export function HomeProgress({ progress }: { progress: VocabularyProgress }) {
  return <section className="home-progress" aria-label="Progress">
    <div className="home-progress-column">
      <ActivityBars days={progress.days} />
      <section className="home-progress-vocabulary">
        <h3>Active vocabulary</h3>
        <p className="home-progress-total"><strong>{progress.activeVocabulary.total}</strong>
          {progress.activeVocabulary.addedLast30Days ? <span>+{progress.activeVocabulary.addedLast30Days} in the last 30 days</span> : null}</p>
        <Disclosure summary="About active vocabulary"><p>Words you have typed correctly without help in a production exercise. A shared-cue answer counts when it names exactly one word.</p></Disclosure>
      </section>
      {progress.firstProductions.length ? <section className="home-progress-first">
        <h3>First productions</h3>
        <ul>{progress.firstProductions.map(item => <li key={item.wordId}>
          <span className="home-progress-hanzi" lang="zh">{item.hanzi}</span><span className="home-progress-pinyin">{item.pinyin}</span>
          <time dateTime={item.dayKey}>{shortDate(item.dayKey)}</time>
        </li>)}</ul>
        <Disclosure summary="About first productions"><p>The day each word first entered your active vocabulary. Words from your first 14 days count toward the total but are not listed.</p></Disclosure>
      </section> : null}
    </div>
    <div className="home-progress-column">
      <section>
        <h3>Exercise results</h3>
        <div className="home-progress-table-wrap"><table className="home-progress-table">
          <thead><tr><th scope="col">Indicator</th><th scope="col">Rate</th><th scope="col">Attempts</th></tr></thead>
          <tbody>
            <RateRow name="Recognition" rate={progress.recognition} />
            <RateRow name="Stickiness" rate={progress.stickiness} />
            <RateRow name="Transfer" rate={progress.transfer} />
          </tbody>
        </table></div>
        <Disclosure summary="About recognition"><p>First answers correct without help on recognition exercises in Practice and Maintain, last 30 days.</p>{excluded(progress.recognition)}</Disclosure>
        <Disclosure summary="About stickiness"><p>First answers correct without help on items returning after 21 days or more, last 90 days.</p>
          <p>{progress.stickiness.wordAttempts} word-skill and {progress.stickiness.cueAttempts} shared-cue attempts.</p>{excluded(progress.stickiness)}</Disclosure>
        <Disclosure summary="About transfer"><p>First answers correct without help on exercises you had never seen, for shared cues or items already practised another way, last 90 days.</p>{excluded(progress.transfer)}</Disclosure>
      </section>
      {progress.efficiency.length ? <section>
        <h3>Sessions to Practice</h3>
        <div className="home-progress-table-wrap"><table className="home-progress-table">
          <thead><tr><th scope="col">Taught</th><th scope="col">Median</th><th scope="col">Settled</th><th scope="col">Settling</th></tr></thead>
          <tbody>{progress.efficiency.map(month => <tr key={month.month}>
            <th scope="row">{monthLabel(month.month)}</th>
            <td>{month.medianSessions === null ? 'Not enough yet' : month.medianSessions}</td><td>{month.settled}</td><td>{month.settling}</td>
          </tr>)}</tbody>
        </table></div>
        <Disclosure summary="About sessions to Practice"><p>Sessions a word spent in Unstudied or Solidify before reaching Practice or Maintain, by the month its teaching finished. A median needs 5 settled words.</p></Disclosure>
      </section> : null}
    </div>
  </section>;
}
