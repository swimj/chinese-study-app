export function replyTarget(state, message) {
  if (message?.role !== 'assistant') return;
  if (message.captureQuestionId && !message.captureResolved) {
    const submission = state.tutor.find(turn => turn.role === 'user' && turn.id === message.captureQuestionId);
    const original = submission?.captureOriginId
      ? state.tutor.find(turn => turn.id === submission.captureOriginId)
      : submission;
    return { captureQuestionId: message.captureQuestionId, label: original?.text || 'this question' };
  }
  const item = wordForTurn(state, message);
  if (item?.status === 'clarify') return { wordReplyTo: { intakeId: item.id, requestId: item.requestId }, label: item.text };
}
export function wordForTurn(state, message) {
  if (!message.wordIntakeId || message.role !== 'assistant') return;
  return state.wordIntakes.find(item => item.id === message.wordIntakeId && item.requestId === message.wordRequestId);
}

export function createCapture({ get, submit, canSubmit, ui, persist, refresh, openReading }) {
  const form = get('word-form');
  const input = get('word-text');
  const context = get('word-context');
  const contextToggle = get('word-context-toggle');
  const error = get('word-refresh-error');
  let pollTimer;
  let polling = false;
  let hasPendingWords = false;

  input.value = ui.wordDraft || '';
  context.value = ui.wordContext || '';
  contextToggle.open = Boolean(context.value);
  form.oninput = () => {
    ui.wordDraft = input.value;
    ui.wordContext = context.value;
    persist();
  };
  form.onsubmit = event => {
    event.preventDefault();
    const text = input.value.trim();
    const source = context.value.trim();
    if (!text || !canSubmit()) return;
    // The pending action keeps this exact submission through a reload or retry.
    // Free the composer immediately so a new (even identical) draft stays independent.
    setDraft('', '');
    submit({ type: 'capture', text, ...(source ? { context: source } : {}) });
  };

  function setDraft(text, source) {
    input.value = text;
    context.value = source;
    contextToggle.open = Boolean(source);
    ui.wordDraft = text;
    ui.wordContext = source;
    persist();
  }

  // A late URL handoff or rejected submission can arrive after the learner
  // has moved on. Keep it reachable at home without replacing their new draft.
  let handoffs;
  function renderHandoffs() {
    if (!ui.captureHandoffs?.length) {
      handoffs?.remove();
      return;
    }
    handoffs ??= document.createElement('div');
    handoffs.className = 'capture-handoffs';
    if (!handoffs.isConnected) form.before(handoffs);
    handoffs.replaceChildren();
    for (const item of ui.captureHandoffs) {
      const row = document.createElement('div');
      row.className = 'capture-handoff';
      const label = document.createElement('span');
      label.textContent = item.text;
      const open = document.createElement('button');
      open.type = 'button';
      const reading = item.type === 'reading';
      open.textContent = reading ? 'Import reading' : 'Use draft';
      open.setAttribute('aria-label', open.textContent + ' · ' + item.text);
      open.onclick = () => {
        ui.captureHandoffs = ui.captureHandoffs.filter(other => other !== item);
        if (reading) openReading(item.text);
        else {
          if (input.value || context.value) remember({ type: 'draft', text: input.value, context: context.value });
          setDraft(item.text, item.context);
          input.focus();
        }
        persist();
        renderHandoffs();
      };
      row.append(label, open);
      handoffs.append(row);
    }
  }
  function remember(item) {
    ui.captureHandoffs ??= [];
    if (!ui.captureHandoffs.some(other => other.type === item.type && other.text === item.text && other.context === item.context))
      ui.captureHandoffs.push(item);
  }
  function offerReading(action) {
    remember({ type: 'reading', text: action.text });
    persist();
    renderHandoffs();
  }
  function restore(action) {
    const source = action.context || '';
    if (!input.value && !context.value) setDraft(action.text, source);
    else if (action.text !== input.value || source !== context.value) {
      remember({ type: 'draft', text: action.text, context: source });
      persist();
      renderHandoffs();
    }
  }
  renderHandoffs();
  function schedule() {
    clearTimeout(pollTimer);
    if (hasPendingWords && !polling) pollTimer = setTimeout(poll, error.hidden ? 1250 : 5000);
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
      schedule();
    }
  }
  function watch(words) {
    hasPendingWords = words.some(item => item.status === 'pending');
    if (!hasPendingWords) error.hidden = true;
    schedule();
  }
  return { offerReading, restore, watch };
}
