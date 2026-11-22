export function createWordInbox({ get, node, button, submit, canSubmit, ui, persist, refresh }) {
  const form = get('word-form');
  const input = get('word-text');
  const context = get('word-context');
  const contextToggle = get('word-context-toggle');
  const list = get('word-items');
  const more = get('word-more');
  const status = get('word-status');
  const error = get('word-refresh-error');
  const rows = new Map();
  let latestState;
  let showOlder = false;
  let pollTimer;
  let polling = false;
  input.value = ui.wordDraft || '';
  context.value = ui.wordContext || '';
  contextToggle.open = Boolean(context.value);
  form.oninput = () => {
    ui.wordDraft = input.value;
    ui.wordContext = context.value;
    persist();
  };

  form.onsubmit = async event => {
    event.preventDefault();
    const text = input.value.trim();
    const source = context.value.trim();
    if (!text || !canSubmit()) return;
    if (await submit({ type: 'addWord', text, ...(source ? { context: source } : {}) })) {
      if (input.value.trim() === text && context.value.trim() === source) {
        input.value = '';
        context.value = '';
        contextToggle.open = false;
        delete ui.wordDraft;
        delete ui.wordContext;
        persist();
      }
      if (form.contains(document.activeElement) || document.activeElement === document.body) input.focus({ preventScroll: true });
    }
  };

  const labels = { pending: 'Preparing…', clarify: 'Needs your input', ready: 'Ready to practice', failed: 'Needs a retry' };

  function renderRow(row, item, words) {
    const heading = node('div', undefined, 'word-row-heading');
    heading.append(node('strong', item.text), node('span', labels[item.status], 'word-status'));
    row.replaceChildren(heading);
    row.dataset.status = item.status;
    if (item.status === 'failed') {
      row.append(node('p', item.error || 'The tutor could not prepare this word.'),
        button('Retry', () => submit({ type: 'retryWord', intakeId: item.id }), 'text-button', true));
    }
    if (item.status === 'ready' && words.length) {
      const details = node('details', undefined, 'word-result');
      const titles = words.map(word => word.title).join(' · ');
      details.append(node('summary', titles === item.text ? 'Word details' : titles));
      for (const word of words) {
        if (words.length > 1) details.append(node('strong', word.title));
        details.append(node('p', word.detail));
      }
      row.append(details);
    }
    if (item.status !== 'clarify') return;

    const question = node('p', item.question);
    question.id = 'word-question-' + item.id;
    row.append(question);
    const replyForm = node('form', undefined, 'intake-line');
    const reply = node('input');
    reply.required = true;
    reply.maxLength = 1000;
    reply.placeholder = 'Your reply';
    reply.setAttribute('aria-label', 'Your reply about ' + item.text);
    reply.setAttribute('aria-describedby', question.id);
    const draft = ui.wordReplies?.[item.id];
    reply.value = draft?.question === item.question ? draft.text : '';
    reply.oninput = () => {
      ui.wordReplies ??= {};
      ui.wordReplies[item.id] = { question: item.question, text: reply.value };
      persist();
    };
    async function answer(text) {
      if (!text || !canSubmit()) return;
      if (await submit({ type: 'clarifyWord', intakeId: item.id, reply: text })) {
        if (ui.wordReplies?.[item.id]?.question === item.question) {
          delete ui.wordReplies[item.id];
          persist();
        }
      }
    }
    if (item.suggestions?.length) {
      const choices = node('div', undefined, 'options word-choices');
      for (const choice of item.suggestions) choices.append(button(choice, () => answer(choice), '', true));
      row.append(choices);
    }
    const send = node('button', 'Reply', 'secondary');
    send.dataset.mutation = '';
    replyForm.append(reply, send);
    replyForm.onsubmit = event => {
      event.preventDefault();
      answer(reply.value.trim());
    };
    row.append(replyForm);
  }

  function updateAttention() {
    const count = latestState?.wordIntakes?.filter(item => item.status === 'clarify').length || 0;
    const attention = get('word-attention');
    attention.hidden = !count || !document.querySelector('[data-page="home"]').hidden;
    attention.textContent = count + (count === 1 ? ' word needs' : ' words need') + ' a reply';
  }

  function render(state) {
    latestState = state;
    updateAttention();
    const items = state.wordIntakes || [];
    const savedById = new Map(state.saved.map(word => [word.id, word]));
    let readyCount = 0;
    const announcements = [];
    // Walk newest-first. Inserting just the changed rows keeps other reply fields focused.
    let next = list.firstElementChild;
    for (const item of [...items].reverse()) {
      let row = rows.get(item.id);
      if (!row) {
        row = node('li');
        rows.set(item.id, row);
      }
      if (row !== next) list.insertBefore(row, next);
      next = row.nextElementSibling;
      const words = (item.savedIds || []).map(id => savedById.get(id)).filter(Boolean);
      const stamp = JSON.stringify([item, words]);
      if (row.dataset.stamp !== stamp) {
        if (row.dataset.status !== item.status) announcements.push(item.text + ' · ' + labels[item.status]);
        renderRow(row, item, words);
        row.dataset.stamp = stamp;
      }
      if (item.status === 'ready') readyCount++;
      row.hidden = item.status === 'ready' && readyCount > 2 && !showOlder;
    }
    const ids = new Set(items.map(item => item.id));
    for (const [id, row] of rows) {
      if (!ids.has(id)) { row.remove(); rows.delete(id); }
    }
    if (announcements.length) status.textContent = announcements.join('. ');
    more.hidden = readyCount <= 2;
    more.setAttribute('aria-expanded', String(showOlder));
    more.textContent = showOlder ? 'Show fewer words' : 'Show ' + (readyCount - 2) + ' earlier ' + (readyCount === 3 ? 'word' : 'words');
    clearTimeout(pollTimer);
    if (!items.some(item => item.status === 'pending')) { error.hidden = true; return; }
    if (!polling) pollTimer = setTimeout(poll, error.hidden ? 1250 : 5000);
  }

  async function poll() {
    polling = true;
    try {
      if (canSubmit()) {
        await refresh();
        error.hidden = true;
      }
    } catch {
      error.textContent = 'Could not refresh word progress. Trying again…';
      error.hidden = false;
    } finally {
      polling = false;
      render(latestState);
    }
  }
  more.onclick = () => { showOlder = !showOlder; render(latestState); };
  return { render, updateAttention };
}
