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

function isReadingLink(text) {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
function offersContext(text) {
  return /\p{Script=Han}/u.test(text) && !isReadingLink(text);
}

export function createCapture({ get, submit, canSubmit, ui, persist, refresh, openReading }) {
  const form = get('word-form');
  const input = get('word-text');
  const context = get('word-context');
  const heading = get('word-heading');
  const back = get('word-back');
  const next = get('word-next');
  const send = get('capture-submit');
  const sendLabel = get('capture-submit-label');
  const error = get('word-refresh-error');
  let pollTimer;
  let polling = false;
  let hasPendingWords = false;

  input.value = ui.wordDraft || '';
  context.value = ui.wordContext || '';
  function renderComposer() {
    const eligible = offersContext(input.value);
    const takingNote = eligible && ui.wordStep === 'context';
    input.hidden = takingNote;
    context.hidden = !takingNote;
    back.hidden = !takingNote;
    const needsContextStep = eligible && !takingNote;
    next.hidden = !needsContextStep;
    send.hidden = needsContextStep;
    heading.textContent = takingNote ? 'Any context you want to add?' : 'Jot something down';
    if (takingNote) {
      back.textContent = '← ' + input.value.trim();
      back.ariaLabel = 'Edit original text · ' + input.value.trim();
    }
    sendLabel.textContent = isReadingLink(input.value) ? 'Import reading' : 'Send';
  }
  function activeField() {
    return context.hidden ? input : context;
  }
  function editOriginal() {
    delete ui.wordStep;
    persist();
    renderComposer();
    input.focus();
  }
  back.onclick = editOriginal;
  form.oninput = () => {
    ui.wordDraft = input.value;
    ui.wordContext = context.value;
    persist();
    renderComposer();
  };
  form.onsubmit = event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (context.hidden && offersContext(text)) {
      ui.wordStep = 'context';
      persist();
      renderComposer();
      context.focus();
      return;
    }
    if (!canSubmit()) return;
    const source = context.hidden ? '' : context.value.trim();
    // The pending action owns this submission. A new draft stays independent.
    setDraft('', '');
    input.focus();
    submit({ type: 'capture', text, ...(source ? { context: source } : {}) });
  };
  form.onkeydown = event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (event.repeat) return;
      if (!context.hidden) editOriginal();
      else heading.focus();
    } else if (event.key === 'Enter' && (event.target === input || event.target === context)
        && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (!event.repeat) form.requestSubmit();
    }
  };
  function setDraft(text, source) {
    input.value = text;
    context.value = source;
    ui.wordDraft = text;
    ui.wordContext = source;
    if (source && offersContext(text)) ui.wordStep = 'context';
    else delete ui.wordStep;
    persist();
    renderComposer();
  }
  renderComposer();

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
          setDraft(item.text, item.context || '');
          activeField().focus();
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
    if (!input.value && !context.value) {
      const focused = form.matches(':focus-within');
      setDraft(action.text, source);
      if (focused) activeField().focus();
    } else if (action.text !== input.value || source !== context.value) {
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
  return { activeField, offerReading, restore, watch };
}
