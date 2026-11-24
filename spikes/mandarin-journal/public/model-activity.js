// Costs are often a fraction of a cent. Keep metered zero and unknown distinct.
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
export function money(amount) {
  if (amount === null) return 'Unknown';
  return amount > 0 && amount < 0.000001 ? '<$0.000001' : dollars.format(amount);
}
export function actionSpend(action) {
  if (action.callCount > 0 && action.unpriced === action.callCount) return 'Unknown';
  return money(action.knownUsd) + (action.unpriced ? ' + unknown' : '');
}
function elapsed(row) {
  return row.finishedAt === null ? null : Date.parse(row.finishedAt) - Date.parse(row.startedAt);
}
function duration(ms) {
  if (ms === null) return '—';
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60_000) return Number((ms / 1000).toFixed(2)) + ' s';
  return Math.floor(ms / 60_000) + 'm ' + Math.floor(ms % 60_000 / 1000) + 's';
}
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function utc(iso) { return clock.format(new Date(iso)); }
function count(value) { return value === null ? 'Unknown' : value.toLocaleString(); }
function outcome(row) { return row.outcome ?? (row.finishedAt ? 'Finished' : 'No finish recorded'); }
function identity(row) { return [row.provider, row.model].filter(Boolean).join(' · ') || 'Model unknown'; }

export function traceLayout(action, spans) {
  const origin = Date.parse(action.startedAt);
  const entries = spans.filter(span => span.id !== action.id).map(row => ({
    row, start: Date.parse(row.startedAt) - origin, duration: elapsed(row), kind: row.kind,
  }));
  if (action.phase === 'foreground' && action.finishedAt !== null) {
    entries.push({ row: action, kind: 'reply', start: elapsed(action), duration: 0 });
  }
  entries.sort((a, b) => a.start - b.start);
  const positioned = new Map(entries.filter(item => item.kind !== 'reply').map(item => [item.row.id, item]));
  entries.forEach((item, i) => { item.ordinal = i + 1; });
  for (const item of entries) {
    const parent = positioned.get(item.row.parentId);
    item.parent = parent?.ordinal ?? null;
    let ancestor = parent;
    let depth = 0;
    // Preserve true parent references even when several steps start in the same millisecond.
    while (ancestor && depth < 3) {
      depth++;
      ancestor = positioned.get(ancestor.row.parentId);
    }
    item.depth = depth;
    item.retry = item.kind === 'model' && (item.row.dependsOn ?? []).some(id => {
      const previous = positioned.get(id)?.row;
      return previous?.kind === 'model' && previous.parentId === item.row.parentId
        && (previous.outcome === 'error' || /^HTTP [45]\d\d$/.test(previous.outcome));
    });
    item.dependencies = (item.row.dependsOn ?? []).map(id => {
      const dependency = positioned.get(id);
      return dependency ? '#' + dependency.ordinal + ' ' + dependency.row.label : id;
    });
  }
  const throughMs = entries.reduce((end, item) => Math.max(end, item.start + (item.duration ?? 0)), elapsed(action) ?? 0);
  return { entries, throughMs };
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function note(cell, text) { if (text) cell.append(node('small', text)); }
const sorts = {
  latest: 'Newest first', spend: 'Highest known spend', duration: 'Longest recorded time', calls: 'Most model calls',
};
export function sortRows(rows, sort, actions) {
  const value = (row) => {
    if (sort === 'calls') return row.callCount;
    if (sort === 'duration') return elapsed(row) ?? -Infinity;
    if (sort === 'spend') {
      if (!actions) return row.costUsd ?? -Infinity;
      return row.callCount > 0 && row.unpriced === row.callCount ? -Infinity : row.knownUsd;
    }
    return Date.parse(row.startedAt);
  };
  return [...rows].sort((a, b) => value(b) - value(a) || b.startedAt.localeCompare(a.startedAt));
}

function startPage() {
  const byId = id => document.getElementById(id);
  let data, view = 'actions', visible = 12;
  let periodRequest, traceRequest, selection = null;
  const order = { actions: 'latest', calls: 'latest' };
  const switches = document.querySelectorAll('button[data-view]');

  function paintSummary(hours) {
    const summary = data.summary;
    byId('since').textContent = 'Started since ' + utc(data.since) + ' UTC';
    byId('action-count').textContent = count(summary.actions);
    byId('call-count').textContent = count(summary.calls);
    const hourly = (summary.calls / hours).toLocaleString(undefined, { maximumFractionDigits: 3 });
    byId('rate').textContent = hourly + ' calls/hour on average';
    byId('spend').textContent = summary.calls > 0 && summary.calls === summary.unpriced ? 'Unknown' : money(summary.knownUsd);
    byId('coverage').textContent = count(summary.unpriced) + ' unpriced';
    byId('background').textContent = count(summary.backgroundCalls);
    const groups = data.behaviors;
    byId('behavior-summary').hidden = !groups.length;
    const list = byId('behavior-list');
    list.replaceChildren();
    for (const group of groups) {
      const item = node('li');
      const average = (group.calls / group.actions).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const spend = actionSpend({ callCount: group.calls, knownUsd: group.knownUsd, unpriced: group.unpriced });
      item.append(node('strong', group.label), node('span', count(group.actions) + (group.actions === 1 ? ' action · ' : ' actions · ')
        + count(group.calls) + (group.calls === 1 ? ' call · ' : ' calls · ') + average + ' calls/action · ' + spend));
      list.append(item);
    }
  }

  function paintList() {
    const actions = view === 'actions';
    const rows = sortRows(data[view], order[view], actions);
    const total = data.summary[view];
    const table = byId('ledger');
    table.replaceChildren();
    const headers = actions ? ['App action', 'Start (UTC)', 'Model calls', 'Server reply', 'Model spend']
      : ['Model call', 'App action', 'Start (UTC)', 'Input / output tokens', 'Latency', 'Model spend'];
    table.setAttribute('aria-label', actions ? 'App actions' : 'Model calls');
    const header = table.createTHead().insertRow();
    headers.forEach((label, i) => {
      const th = node('th', label, i >= (actions ? 2 : 3) ? 'numeric' : '');
      th.scope = 'col'; header.append(th);
    });
    const body = table.createTBody();
    rows.slice(0, visible).forEach(row => {
      const tr = body.insertRow();
      const cell = (value, secondary) => {
        const index = tr.cells.length;
        const td = tr.insertCell();
        if (index >= (actions ? 2 : 3)) td.className = 'numeric';
        td.dataset.label = headers[index];
        if (typeof value === 'string') td.textContent = value;
        else td.append(value);
        note(td, secondary);
        return td;
      };
      const pick = node('button', row.label, 'pick');
      pick.type = 'button';
      pick.dataset.action = row.actionId;
      if (!actions) pick.dataset.call = row.id;
      pick.setAttribute('aria-controls', 'trace');
      if (actions) {
        cell(pick, outcome(row));
        cell(utc(row.startedAt));
        cell(count(row.callCount));
        cell(row.phase === 'background' ? '—' : duration(elapsed(row)), row.phase === 'background' ? 'Background action' : '');
        cell(actionSpend(row), row.unpriced ? count(row.unpriced) + ' unpriced' : '');
      } else {
        cell(pick, identity(row));
        cell(row.actionLabel, row.phase);
        cell(utc(row.startedAt));
        cell(count(row.inputTokens) + ' / ' + count(row.outputTokens));
        cell(duration(elapsed(row)), outcome(row));
        cell(money(row.costUsd), row.costUsd === null ? '' : row.costSource);
      }
    });
    markSelection();
    const truncated = actions ? data.truncatedActions : data.truncatedCalls;
    const noun = actions ? 'actions' : 'model calls';
    byId('row-count').textContent = rows.length === 0 ? 'No ' + noun + ' started in this period.'
      : 'Showing ' + count(Math.min(visible, rows.length)) + ' of ' + count(total) + ' ' + noun
        + (truncated ? ' · Ordering covers the newest ' + count(rows.length) + '.' : '.');
    if (actions && rows.length) byId('row-count').textContent += ' Each action includes its later calls.';
    byId('more').hidden = visible >= rows.length;
  }

  function markSelection() {
    for (const button of byId('ledger').querySelectorAll('[data-action]')) {
      const selected = button.dataset.action === selection?.actionId && (view === 'actions' || button.dataset.call === selection?.callId);
      button.closest('tr').classList.toggle('current', selected);
      if (selected) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  function paintTrace({ action, spans }) {
    const { entries, throughMs } = traceLayout(action, spans);
    const content = byId('trace-content');
    content.replaceChildren();
    byId('trace-title').textContent = action.label;
    const info = [action.reference, utc(action.startedAt) + ' UTC', outcome(action)];
    content.append(node('div', info.filter(Boolean).join(' · '), 'byline'));
    const annotations = [];
    if (action.phase === 'foreground' && action.finishedAt) annotations.push('Server reply ' + duration(elapsed(action)));
    annotations.push(duration(throughMs) + ' through latest recorded event', count(action.callCount) + ' model calls', actionSpend(action) + ' model spend');
    content.append(node('div', annotations.join(' · ')));
    const list = node('ol', undefined, 'trace-list');
    list.setAttribute('aria-label', 'Action timeline');
    for (const entry of entries) {
      const {row, kind} = entry;
      const reply = kind === 'reply';
      const li = node('li', undefined, 'trace-row');
      li.dataset.open = String(entry.duration === null);
      li.dataset.kind = kind;
      if (row.id === selection?.callId) {
        li.classList.add('current');
        li.setAttribute('aria-current', 'true');
        li.tabIndex = -1;
        li.setAttribute('aria-label', 'Selected model call, step ' + entry.ordinal + ', ' + row.label + ', ' + outcome(row));
      }
      const name = node('div', undefined, 'trace-name');
      name.style.setProperty('--depth', String(entry.depth));
      name.append(node('span', '#' + entry.ordinal + ' ', 'step'), node('strong', reply ? 'Server reply' : row.label));
      note(name, reply ? 'Foreground' : [kind, row.phase, entry.parent ? 'inside #' + entry.parent : null].filter(Boolean).join(' · '));
      if (entry.dependencies.length) note(name, (entry.retry ? 'Retry after ' : 'After ') + entry.dependencies.join(', '));
      const timing = node('div', undefined, 'trace-timing');
      const track = node('div', undefined, 'track');
      track.setAttribute('aria-hidden', 'true');
      const bar = node('span', undefined, 'mark');
      const scale = Math.max(1, throughMs);
      bar.style.setProperty('--offset', Math.max(0, 100 * entry.start / scale) + '%');
      bar.style.setProperty('--length', 100 * (entry.duration ?? 0) / scale + '%');
      track.append(bar); timing.append(track);
      const times = ['+' + duration(entry.start)];
      if (!reply && entry.duration !== null) times.push(duration(entry.duration) + ' duration');
      timing.append(node('small', times.join(' · ')));
      const result = node('div', outcome(row), 'trace-outcome');
      if (!reply && row.reference) note(result, row.reference);
      if (kind === 'model') {
        note(result, identity(row));
        const spend = row.costUsd === null ? 'Unpriced' : money(row.costUsd) + ' ' + row.costSource;
        note(result, [spend, count(row.inputTokens) + ' in', count(row.outputTokens) + ' out'].join(' · '));
        const tokenDetails = [];
        if (row.cachedTokens !== null) tokenDetails.push(count(row.cachedTokens) + ' cached input');
        if (row.writeTokens != null) tokenDetails.push(count(row.writeTokens) + ' cache write');
        if (row.reasoningTokens !== null) tokenDetails.push(count(row.reasoningTokens) + ' reasoning output');
        if (tokenDetails.length || row.pricingBasis) {
          const detail = node('details');
          detail.append(node('summary', 'Accounting details'));
          note(detail, tokenDetails.join(' · '));
          if (row.pricingBasis) {
            const basis = JSON.parse(row.pricingBasis);
            const rates = basis.perMillion;
            note(detail, basis.tier + ' USD per million tokens · ' + basis.asOf);
            const prices = ['input ' + money(rates.input), 'cached ' + money(rates.cached), 'output ' + money(rates.output)];
            if (rates.write != null) prices.push('cache write ' + money(rates.write));
            if (basis.extendedWriteTokens) prices.push('12-hour write ' + money(basis.extendedWritePerMillion));
            note(detail, prices.join(' · '));
          }
          result.append(detail);
        }
      }
      if (row.id === selection?.callId) {
        const back = node('button', 'Back to selected call', 'pick');
        back.type = 'button';
        back.addEventListener('click', returnToList);
        result.append(back);
      }
      li.append(name, timing, result); list.append(li);
    }
    if (entries.length) content.append(list);
    else content.append(node('p', 'No child steps recorded.', 'byline'));
  }

  async function showTrace(actionId, callId = null, focus = false) {
    traceRequest?.abort();
    const request = new AbortController();
    traceRequest = request;
    selection = { actionId, callId };
    markSelection();
    byId('trace').hidden = false;
    byId('trace-title').textContent = 'Action detail';
    byId('trace-status').textContent = 'Loading action…';
    byId('trace-content').replaceChildren();
    byId('retry-detail').hidden = true;
    if (focus) byId('trace-title').focus();
    try {
      const response = await fetch('/api/operator/activity/' + encodeURIComponent(actionId), { signal: request.signal });
      if (!response.ok) throw Error(String(response.status));
      const detail = await response.json();
      if (request.signal.aborted) return;
      byId('trace-status').textContent = '';
      paintTrace(detail);
      if (focus && callId) {
        const selected = byId('trace-content').querySelector('li[aria-current="true"]');
        selected?.focus({ preventScroll: true });
        selected?.scrollIntoView({ block: 'center' });
      }
    } catch (error) {
      if (request.signal.aborted) return;
      byId('trace-status').textContent = 'Could not load this action (' + error.message + ').';
      byId('retry-detail').hidden = false;
    }
  }

  function setView(next) {
    view = next; visible = 12;
    switches.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    const select = byId('order');
    select.replaceChildren();
    for (const [key, label] of Object.entries(sorts)) {
      if (view === 'calls' && key === 'calls') continue;
      const option = node('option', label);
      option.value = key; select.append(option);
    }
    select.value = order[view];
    paintList();
  }

  async function load() {
    periodRequest?.abort(); traceRequest?.abort();
    const request = new AbortController();
    periodRequest = request;
    const hours = Number(byId('period').value);
    byId('status').textContent = 'Loading activity…';
    byId('activity-data').hidden = true;
    byId('trace').hidden = true;
    try {
      const response = await fetch('/api/operator/activity?hours=' + hours, { signal: request.signal });
      if (!response.ok) throw Error(String(response.status));
      const snapshot = await response.json();
      if (request.signal.aborted) return;
      data = snapshot;
      byId('status').textContent = '';
      byId('activity-data').hidden = false;
      paintSummary(hours); setView(view);
      const selected = selection && [...data.actions, ...data.calls].some(row => row.actionId === selection.actionId);
      const first = data[view][0];
      if (selected) void showTrace(selection.actionId, selection.callId);
      else if (first) void showTrace(first.actionId, view === 'calls' ? first.id : null);
      else selection = null;
    } catch (error) {
      if (!request.signal.aborted) byId('status').textContent = 'Could not load model activity (' + error.message + '). Use Refresh to retry.';
    }
  }

  switches.forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  byId('refresh').addEventListener('click', load);
  byId('period').addEventListener('change', () => { selection = null; void load(); });
  byId('order').addEventListener('change', event => { order[view] = event.target.value; paintList(); });
  byId('more').addEventListener('click', () => {
    const previousLength = byId('ledger').tBodies[0].rows.length;
    visible += 24; paintList();
    byId('ledger').tBodies[0].rows[previousLength]?.querySelector('button')?.focus();
  });
  byId('ledger').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (button) void showTrace(button.dataset.action, button.dataset.call, true);
  });
  function returnToList() {
    const previous = byId('ledger').querySelector('[aria-current="true"]');
    (previous ?? document.querySelector('button[data-view][aria-pressed="true"]')).focus();
  }
  byId('back-list').addEventListener('click', returnToList);
  byId('retry-detail').addEventListener('click', () => { void showTrace(selection.actionId, selection.callId, true); });
  void load();
}

if (typeof document !== 'undefined') startPage();
