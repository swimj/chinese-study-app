// Learning days are the learner's local calendar days. Instants stay UTC ISO
// strings in storage; every day-based learning rule (recall due days and
// intervals, the check-up, clean days, the new-word allowance, practiced today,
// the daily read limit) derives its day key here from the stored instant and the
// learner's IANA time zone. Because keys are recomputed from instants, a zone
// change or a DST shift moves day boundaries without rewriting any history.

/** Whether the runtime knows this IANA zone name. */
export function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone learning days use when the learner has not reported one: the server
 * machine's own zone. Acceptable while the journal runs on the learner's machine;
 * a hosted journal sets the learner's zone from the browser before it matters.
 */
export function serverZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** The learner's zone from settings, or the server's when none is set. */
export const learnerZone = (settings: { timeZone?: string } | undefined) => settings?.timeZone || serverZone();

const formats = new Map<string, Intl.DateTimeFormat>();
/** The learner's calendar day (YYYY-MM-DD) of an instant in the given zone. */
export function learningDay(at: string | number | Date, zone: string): string {
  const instant = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(instant.getTime())) throw new Error('Not an instant: ' + String(at));
  let format = formats.get(zone);
  if (!format) {
    // en-CA formats a date as YYYY-MM-DD.
    format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formats.set(zone, format);
  }
  return format.format(instant);
}

/** Calendar arithmetic on a day key; days, not 24-hour spans, so DST does not shift it. */
export function addDays(day: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Not a day key: ' + day);
  return new Date(Date.parse(day + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}
