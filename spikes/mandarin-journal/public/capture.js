export function replyTarget(state, message) {
  if (message?.role !== 'assistant') return;
  if (message.captureQuestionId && !message.captureResolved) {
    const original = state.tutor.find(turn => turn.role === 'user' && turn.id === message.captureQuestionId);
    return { captureQuestionId: message.captureQuestionId, label: original?.text || 'this question' };
  }
  const item = wordForTurn(state, message);
  if (item?.status === 'clarify') return { wordReplyTo: { intakeId: item.id, requestId: item.requestId }, label: item.text };
}
export function wordForTurn(state, message) {
  if (!message.wordIntakeId || message.role !== 'assistant') return;
  return state.wordIntakes.find(item => item.id === message.wordIntakeId && item.requestId === message.wordRequestId);
}

export function createCapture({ get, submit, canSubmit, ui, persist, refresh }) {
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
    if (text && canSubmit()) submit({ type: 'capture', text, ...(source ? { context: source } : {}) });
  };

  function accepted(action) {
    if (input.value.trim() !== action.text || context.value.trim() !== (action.context || '')) return;
    input.value = '';
    context.value = '';
    contextToggle.open = false;
    delete ui.wordDraft;
    delete ui.wordContext;
    persist();
  }
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
  return { accepted, watch };
}
