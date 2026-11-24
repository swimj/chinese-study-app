// One foreground action at a time. Keep its temporary content beside the control
// that submitted it, outside the journal's committed conversation and practice data.
export function createTurnProgress({ get, retryPending }) {
  const box = document.createElement('div');
  box.className = 'turn-progress';
  const submitted = document.createElement('p');
  submitted.className = 'turn-submitted';
  const source = document.createElement('p');
  source.className = 'turn-source';
  const footer = document.createElement('div');
  footer.className = 'turn-progress-line';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.dataset.turnRetry = '';
  retry.onclick = retryPending;
  footer.append(status, retry);
  box.append(submitted, source, footer);

  // Keep the same nodes through navigation, retry, and unrelated state renders.
  function show(container, { before = null, text = '', context = '', label }, { busy, error }) {
    const focusingRetry = document.activeElement === retry;
    if (box.parentElement !== container) container.insertBefore(box, before);
    if (submitted.textContent !== text) submitted.textContent = text;
    submitted.hidden = !text;
    if (source.textContent !== context) source.textContent = context;
    source.hidden = !context;
    const message = busy ? label : error || 'The journal hasn’t confirmed this yet.';
    if (status.textContent !== message) status.textContent = message;
    box.classList.toggle('turn-working', busy);
    retry.hidden = busy;
    if (focusingRetry && busy) {
      status.tabIndex = -1;
      status.focus({ preventScroll: true });
    }
  }

  function render(pending) {
    const { action, state } = pending;
    const practice = get('practice-body');
    const exercise = practice.querySelector('.exercise');
    // Leave the prompt and teaching visible. The submitted answer takes the
    // place of its editable control until the journal returns the result.
    const onCard = action?.cardId && action.cardId === state?.practice.card?.id;
    const answering = action?.type === 'answer' && onCard && !state.practice.result;
    const focusedInput = answering && exercise?.contains(document.activeElement) && !box.contains(document.activeElement);
    exercise?.classList.toggle('answer-submitted', Boolean(answering));
    switch (action?.type) {
      case 'capture': {
        const form = get('word-form');
        show(form.parentElement, { before: form, text: action.text, context: action.context, label: 'Sending…' }, pending);
        return;
      }
      case 'reflect':
        if (state && (!action.threadId || action.threadId === state.activeThreadId)) {
          show(get('chat-messages'), { label: 'Reflecting…' }, pending);
          return;
        }
        break;
      case 'answer':
        if (!onCard || !exercise) break;
        show(exercise, { text: answering ? action.answer : '', label: 'Checking your answer…' }, pending);
        if (focusedInput) {
          status.tabIndex = -1;
          status.focus({ preventScroll: true });
        }
        return;
      case 'practice':
        show(practice, { label: 'Preparing practice…' }, pending);
        return;
      case 'next':
        if (onCard) {
          const label = state.practice.session?.last ? 'Finishing the session…' : 'Getting the next exercise…';
          show(practice, { label }, pending);
          return;
        }
    }
    box.remove();
  }
  return { render };
}
