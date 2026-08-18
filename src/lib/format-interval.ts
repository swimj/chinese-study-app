/** Format a positive hour interval as days and leftover hours for display. */
export function formatIntervalHours(intervalHours: number): string {
  const totalHours = Math.max(0, Math.floor(intervalHours));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const daysLabel = `${days} day${days === 1 ? '' : 's'}`;
  if (hours === 0) {
    return daysLabel;
  }

  return `${daysLabel}, ${hours} hour${hours === 1 ? '' : 's'}`;
}
