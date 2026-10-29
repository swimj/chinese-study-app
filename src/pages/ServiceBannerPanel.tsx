import { useEffect, useState } from 'react';
import { fetchOperatorServiceBanner, saveOperatorServiceBanner, clearOperatorServiceBanner, type ServiceBanner } from '../services/api';
import type { ServiceBannerRequest } from '../domain/service-banner';
import { UPDATE_NOTICE_TTL_MS } from '../domain/service-banner';
import { buildUpdateNotice, formatBannerTimestamp, serviceBannerMessage } from '../features/operator/service-banner';

export function ServiceBannerPanel() {
  const [banner, setBanner] = useState<ServiceBanner | null>(null);
  const [message, setMessage] = useState('');
  const [localKickoff, setLocalKickoff] = useState('');
  const [preservedKickoff, setPreservedKickoff] = useState<string | null>(null);
  const [perspective, setPerspective] = useState<'local' | 'utc'>('local');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchOperatorServiceBanner().then(({ serviceBanner }) => {
      if (cancelled) return;
      setBanner(serviceBanner);
      setMessage(serviceBanner ? serviceBannerMessage(serviceBanner) : '');
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load service banner');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save(request: ServiceBannerRequest) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await saveOperatorServiceBanner(request);
      setBanner(result.serviceBanner);
      setMessage(serviceBannerMessage(result.serviceBanner));
      setNotice('Service banner saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save service banner'); }
    finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await clearOperatorServiceBanner();
      setBanner(null); setMessage(''); setLocalKickoff(''); setPreservedKickoff(null);
      setNotice(result.status === 'cleared' ? 'Service banner cleared.' : 'There was no active banner.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to clear service banner'); }
    finally { setBusy(false); }
  }

  const plannedNotice = preservedKickoff
    ? (Date.parse(preservedKickoff) > Date.now() ? { kickoffAt: preservedKickoff } : null)
    : buildUpdateNotice(localKickoff, Date.now(), perspective);
  const invalidMessage = !message.trim() || message.trim().length > 280 || /[\r\n]/.test(message);

  return <section className="operator-service-banner">
    <h2>Service banner</h2>
    <p className="notes">Post a notice shown to signed-in learners outside an active study session.</p>
    {loading ? <p className="notes">Loading current banner…</p> : banner ? <div className="operator-banner-current"><strong>Current banner</strong><p>{serviceBannerMessage(banner)}</p>
      <details><summary>Notice details</summary><p className="notes">Posted {formatBannerTimestamp(banner.postedAt)}<br />Expires {formatBannerTimestamp(banner.expiresAt)}</p></details></div>
      : <p className="notes">No active banner.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {notice && <p role="status" className="notes">{notice}</p>}
    <div className="operator-banner-action">
      <h3>Planned update</h3>
      <label>Enter kickoff in
        <select value={perspective} disabled={busy || loading} onChange={(event) => {
          const next = event.target.value as 'local' | 'utc';
          const current = plannedNotice;
          if (current) {
            setPreservedKickoff(current.kickoffAt);
            const date = new Date(current.kickoffAt);
            const display = next === 'utc' ? date : new Date(date.getTime() - date.getTimezoneOffset() * 60000);
            setLocalKickoff(display.toISOString().slice(0, 16));
          }
          setPerspective(next);
        }}><option value="local">Your local time</option><option value="utc">UTC</option></select>
      </label>
      <p className="notes">Local time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
      <fieldset className="operator-kickoff-fields">
        <legend>Estimated update kickoff ({perspective === 'utc' ? 'UTC' : 'your local time'})</legend>
        <label>Kickoff date
          <input type="date" value={localKickoff.split('T')[0]} disabled={busy || loading} onChange={(event) => {
            setLocalKickoff(`${event.target.value}T${localKickoff.split('T')[1] ?? ''}`); setPreservedKickoff(null);
          }} />
        </label>
        <label>Kickoff time
          <input type="time" value={localKickoff.split('T')[1] ?? ''} disabled={busy || loading} onChange={(event) => {
            setLocalKickoff(`${localKickoff.split('T')[0]}T${event.target.value}`); setPreservedKickoff(null);
          }} />
        </label>
      </fieldset>
      {plannedNotice ? <div className="operator-banner-preview"><strong>Message preview</strong><p>{serviceBannerMessage({ message: '', ...plannedNotice })}</p><p className="notes">Each learner sees the kickoff in their own local time zone.</p>
        <details><summary>Notice expiry</summary><p className="notes">Expires {formatBannerTimestamp(new Date(new Date(plannedNotice.kickoffAt).getTime() + UPDATE_NOTICE_TTL_MS).toISOString())} — 24 hours after the estimated kickoff. A successful service update also clears the banner.</p></details></div>
        : <p className="notes">Choose a future kickoff time to preview the standard notice.</p>}
      <button type="button" disabled={busy || loading || !plannedNotice} onClick={() => {
        const request = plannedNotice;
        if (request) void save(request);
      }}>Post update notice</button>
    </div>
    <div className="operator-banner-action">
      <h3>Custom message</h3>
      <p className="notes">Starts with the current banner. Saving replaces it and expires 24 hours from now.</p>
      <label>Message (single line, 280 characters or less)
        <textarea rows={3} maxLength={280} value={message} disabled={busy || loading} onChange={(event) => setMessage(event.target.value)} />
      </label>
      {/[\r\n]/.test(message) && <p role="alert" className="error-message">Keep the message on one line to save it.</p>}
      <button type="button" disabled={busy || loading || invalidMessage} onClick={() => void save({ message })}>Replace with custom message</button>
    </div>
    <button type="button" className="secondary-button" disabled={busy || loading || !banner} onClick={() => void clear()}>Clear banner</button>
  </section>;
}

