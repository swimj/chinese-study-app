import { useState } from 'react';
import { timestampDisplayLabel, timestampZoneOptions, type TimestampDisplay } from './operator-timestamps';

export function TimestampDisplayControl({ value, onChange }: {
  value: TimestampDisplay; onChange: (value: TimestampDisplay) => void;
}) {
  const [zones] = useState(timestampZoneOptions);
  return <div className="operator-timestamp-controls">
    <label>Timestamp display<select value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value as TimestampDisplay['mode'] })}>
      <option value="utc">UTC</option><option value="local">Local time</option><option value="zone">Specific time zone</option>
    </select></label>
    {value.mode === 'zone' && <label>Time zone<select value={value.zone} onChange={(event) => onChange({ ...value, zone: event.target.value })}>
      {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
    </select></label>}
    <span className="notes">{timestampDisplayLabel(value)} · Date filters and reporting periods use UTC.</span>
  </div>;
}
