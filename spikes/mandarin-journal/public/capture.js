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

// The trial changes when a draft is composed. Both slips send the same capture action.
function wireTrial({ variant, get, ui, persist, send }) {
  const form = get('word-form');
  const body = get('word-text');
  const line = body.closest('.intake-line');
  const details = get('word-context-toggle');
  const summary = details.querySelector('summary');
  const note = get('word-context');
  const heading = get('word-heading');
  const back = get('word-back');
  const next = get('word-next');
  const skip = get('word-skip');
  const submit = get('capture-submit');
  const stepwise = variant === 'stepwise';
  form.dataset.slip = variant;
  form.append(submit);

  function render() {
    const eligible = offersContext(body.value);
    const takingNote = stepwise && eligible && ui.wordStep === 'context';
    line.hidden = takingNote;
    back.hidden = !takingNote;
    skip.hidden = !takingNote;
    next.hidden = !stepwise || !eligible || takingNote;
    submit.hidden = !next.hidden;
    if (takingNote) {
      back.textContent = '← ' + body.value.trim();
      back.ariaLabel = 'Edit original text · ' + body.value.trim();
    }
    heading.textContent = takingNote ? 'Where did you meet it?' : 'Jot something down';
    details.hidden = !eligible || (stepwise && !takingNote);
    if (stepwise || !eligible) details.open = takingNote;
    summary.hidden = stepwise;
    summary.textContent = details.open ? 'Where you met it' : note.value.trim() ? 'Edit context' : 'Add context';
    submit.textContent = isReadingLink(body.value) ? 'Import reading' : 'Send';
  }
  function turn(toContext) {
    if (toContext) ui.wordStep = 'context';
    else delete ui.wordStep;
    persist();
    render();
    (toContext ? note : body).focus();
  }
  summary.onclick = event => {
    event.preventDefault();
    details.open = !details.open;
    render();
    if (details.open) note.focus();
  };
  back.onclick = () => turn(false);
  skip.onclick = () => send('');
  form.onsubmit = event => {
    event.preventDefault();
    if (!next.hidden) turn(true);
    else send(offersContext(body.value) ? note.value.trim() : '');
  };
  form.onkeydown = event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (event.repeat) return;
      if (!skip.hidden) send('');
      else if (details.open) {
        details.open = false;
        render();
        body.focus();
      } else heading.focus();
    } else if (event.key === 'Enter' && (event.target === body || event.target === note)
        && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (!event.repeat) form.requestSubmit();
    }
  };
  render();
  return render;
}

export function createCapture({ get, submit, canSubmit, ui, persist, refresh, openReading, variant }) {
  const form = get('word-form');
  const input = get('word-text');
  const context = get('word-context');
  const contextToggle = get('word-context-toggle');
  const error = get('word-refresh-error');
  let pollTimer;
  let polling = false;
  let hasPendingWords = false;
  const trial = variant === 'inline' || variant === 'stepwise';

  input.value = ui.wordDraft || '';
  context.value = ui.wordContext || '';
  contextToggle.open = Boolean(context.value);
  form.onsubmit = event => {
    event.preventDefault();
    send(context.value.trim());
  };
  const renderSlip = trial && wireTrial({ variant, get, ui, persist, send });
  form.oninput = () => {
    if (trial) renderSlip();
    ui.wordDraft = input.value;
    ui.wordContext = context.value;
    persist();
  };
  function send(source) {
    const text = input.value.trim();
    if (!text || !canSubmit()) return;
    // The pending action owns this submission. A new draft stays independent.
    setDraft('', '');
    if (trial) input.focus();
    submit({ type: 'capture', text, ...(source ? { context: source } : {}) });
  }
  function setDraft(text, source) {
    input.value = text;
    context.value = source;
    contextToggle.open = Boolean(source);
    delete ui.wordStep;
    if (trial) renderSlip();
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
  return { offerReading, restore, watch, importOnSend: trial };
}
