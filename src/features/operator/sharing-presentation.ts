/** UTC date keys keep operator week navigation independent of browser timezone. */
export function shiftSharingWeek(weekStart: string, direction: -1 | 1): string {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + direction * 7);
  return date.toISOString().slice(0, 10);
}

export function sharingWeekLabel(weekStart: string, weekEndExclusive: string): string {
  const end = new Date(`${weekEndExclusive}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const format = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${format.format(new Date(`${weekStart}T00:00:00.000Z`))} – ${format.format(end)}`;
}

export function sharingTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(value));
}
