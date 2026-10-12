import { useEffect, useState } from 'react';
import { fetchOperatorServiceBanner, saveOperatorServiceBanner, clearOperatorServiceBanner, type ServiceBanner } from '../services/api';
import { buildUpdateNotice } from '../features/operator/service-banner';

export function ServiceBannerPanel() {
  const [banner, setBanner] = useState<ServiceBanner | null>(null);
  const [message, setMessage] = useState('');
  const [localKickoff, setLocalKickoff] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchOperatorServiceBanner().then(({ serviceBanner }) => {
      if (cancelled) return;
      setBanner(serviceBanner);
      setMessage(serviceBanner?.message ?? '');
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load service banner');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save(request: { message: string; expiresAt?: string }) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await saveOperatorServiceBanner(request);
      setBanner(result.serviceBanner);
      setMessage(result.serviceBanner.message);
      setNotice('Service banner saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save service banner'); }
    finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await clearOperatorServiceBanner();
      setBanner(null); setMessage(''); setLocalKickoff('');
      setNotice(result.status === 'cleared' ? 'Service banner cleared.' : 'There was no active banner.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to clear service banner'); }
    finally { setBusy(false); }
  }

  const plannedNotice = buildUpdateNotice(localKickoff);
  const invalidMessage = !message.trim() || message.trim().length > 280 || /[\r\n]/.test(message);

  return <section className="operator-service-banner">
    <h2>Service banner</h2>
    <p className="notes">Post a notice shown to signed-in learners outside an active study session.</p>
    {loading ? <p className="notes">Loading current banner…</p> : banner ? <div className="operator-banner-current"><strong>Current banner</strong><p>{banner.message}</p>
      <details><summary>Notice details</summary><p className="notes">Posted {new Date(banner.postedAt).toLocaleString()}<br />Expires {new Date(banner.expiresAt).toLocaleString()}</p></details></div>
      : <p className="notes">No active banner.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {notice && <p role="status" className="notes">{notice}</p>}
    <div className="operator-banner-action">
      <h3>Planned update</h3>
      <label>Estimated update kickoff (your local time)
        <input type="datetime-local" value={localKickoff} disabled={busy || loading} onChange={(event) => setLocalKickoff(event.target.value)} />
      </label>
      {plannedNotice ? <div className="operator-banner-preview"><strong>Message preview</strong><p>{plannedNotice.message}</p>
        <details><summary>Notice expiry</summary><p className="notes">Expires {new Date(plannedNotice.expiresAt).toLocaleString()} — 24 hours after the estimated kickoff. A successful service update also clears the banner.</p></details></div>
        : <p className="notes">Choose a future kickoff time to preview the standard notice.</p>}
      <button type="button" disabled={busy || loading || !plannedNotice} onClick={() => {
        const request = buildUpdateNotice(localKickoff);
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

