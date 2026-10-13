export type TimestampDisplay = {
  mode: 'utc' | 'local' | 'zone';
  zone: string;
};

export const defaultTimestampDisplay: TimestampDisplay = { mode: 'utc', zone: 'UTC' };

export function timestampZone(display: TimestampDisplay): string {
  return display.mode === 'utc' ? 'UTC'
    : display.mode === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : display.zone;
}

export function timestampDisplayLabel(display: TimestampDisplay): string {
  const zone = timestampZone(display);
  return display.mode === 'local' ? `Local: ${zone}` : zone;
}

export function timestampZoneOptions(): string[] {
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  }).supportedValuesOf;
  const zones = supportedValuesOf ? supportedValuesOf('timeZone')
    : ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney'];
  return [...new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, ...zones])].sort();
}

export function createTimestampFormatter(display: TimestampDisplay): (timestamp: string) => string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timestampZone(display), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
  });
  return (timestamp) => {
    const parts = formatter.formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)!.value;
    const offset = part('timeZoneName').replace(/^GMT(?:[+-]0(?::00)?)?$/, 'UTC');
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} ${offset}`;
  };
}
