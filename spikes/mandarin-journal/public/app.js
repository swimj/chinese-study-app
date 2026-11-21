const get = (id) => document.getElementById(id);
const pages = new Set(['home', 'read', 'chat', 'practice', 'saved']);
const reading = {
  title: '散场以后',
  text: Array.from(get('passage').querySelectorAll('p'), (p) => p.textContent.trim()).join('\n'),
};
const readingSource = reading.title + '\n' + reading.text;
const labels = {
  home: 'Journal',
  read: reading.title,
  chat: 'Conversation',
  practice: 'Practice',
  saved: 'Saved',
};
const uiKey = 'mandarin-journal.ui.v1';

function readUi() {
  try {
    return JSON.parse(sessionStorage.getItem(uiKey) || '{}') || {};
  } catch {
    return {};
  }
}
const ui = readUi();
function persist() {
  try {
    sessionStorage.setItem(uiKey, JSON.stringify(ui));
  } catch {
    /* Private browsing can disable storage. */
  }
}
function currentPage() {
  const hash = location.hash.slice(1);
  return pages.has(hash) ? hash : 'home';
}
function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

let state;
let page = currentPage();
let busy = false;
let loadFailed = false;
let selectedText = '';
let activeTutorContext = '';
let focusBeforeTutor;
const draftInputs = {
  tutor: get('tutor-draft'),
  chat: get('chat-draft'),
};
for (const [name, input] of Object.entries(draftInputs)) {
  input.value = ui[name + 'Draft'] || '';
  input.addEventListener('input', () => {
    ui[name + 'Draft'] = input.value;
    persist();
  });
}

get('today').textContent = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
}).format(new Date());
function sourceFor(surface) {
  if (surface === 'read') return activeTutorContext || readingSource;
  if (surface === 'chat') {
    const last = state.chat
      .slice(-2)
      .map((m) => m.text)
      .join('\n');
    return ('Conversation\n' + last).slice(0, 1500);
  }
  if (surface === 'practice') return state.practice.card?.prompt || 'Practice';
  return labels[surface];
}

function setTutor(open, focus = false) {
  ui.tutorOpen = open;
  persist();
  get('layout').classList.toggle('with-tutor', open);
  get('tutor').hidden = !open;
  get('open-tutor').hidden = open;
  get('open-tutor').setAttribute('aria-expanded', String(open));
  if (open) {
    get('tutor-messages').scrollTop = get('tutor-messages').scrollHeight;
    if (focus) {
      focusBeforeTutor = document.activeElement;
      draftInputs.tutor.focus();
    }
  } else if (focus) {
    (focusBeforeTutor?.offsetParent ? focusBeforeTutor : get('open-tutor')).focus();
  }
}
get('open-tutor').onclick = () => setTutor(true, true);
get('close-tutor').onclick = () => setTutor(false, true);
get('tutor').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    setTutor(false, true);
  }
});

function showError(message) {
  get('error-message').textContent = message;
  get('notice').hidden = !message;
  get('retry').hidden = !(loadFailed || ui.pending);
  if (message) get('notice').scrollIntoView({ block: 'nearest' });
}
function markBusy(value) {
  busy = value;
  const action = ui.pending?.type;
  const label = action === 'chat' ? 'Waiting for a reply…' : action === 'saveReading' ? 'Saving…' : 'Working…';
  get('pending').textContent = value ? label : '';
  document.body.dataset.waiting = String(value);
  get('runtime').textContent = [
    state ? (state.mode === 'live' ? 'Live tutor' : 'Demo tutor') : 'Connecting…',
    value ? label : '',
  ]
    .filter(Boolean)
    .join(' · ');
  document
    .querySelectorAll(
      'form button[type="submit"], form button:not([type]), button[data-mutation], #save-reading, #reflect, #practice-mode, .phrase, #ask-selection',
    )
    .forEach((el) => {
      el.disabled =
        value ||
        !state ||
        (el.id === 'save-reading' && isReadingSaved()) ||
        (el.id === 'reflect' && !state?.chat.length);
    });
}
function isReadingSaved() {
  return state?.saved.some((item) => item.title === reading.title && item.kind.toLowerCase() === 'reading');
}
function renderMessages(container, messages, placeholder = '') {
  const log = get(container);
  const nearEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 35;
  const hadMessages = log.querySelector('.message');
  // Append new turns without re-announcing the whole log or disturbing a learner reading an old reply.
  const existing = Array.from(log.querySelectorAll('.message'));
  const matches = existing.every(
    (el, i) => messages[i]?.text === el.lastChild?.textContent && el.dataset.role === messages[i]?.role,
  );
  if (!matches) log.replaceChildren();
  const displayed = matches ? existing.length : 0;
  if (messages.length && !displayed) log.replaceChildren();
  for (const message of messages.slice(displayed)) {
    const p = node('p', undefined, 'message' + (message.role === 'user' ? ' out' : ''));
    p.dataset.role = message.role;
    p.append(
      node(
        'span',
        message.role === 'user' ? 'You: ' : container === 'tutor-messages' ? 'Tutor: ' : 'Conversation partner: ',
        'sr',
      ),
      document.createTextNode(message.text),
    );
    log.append(p);
  }
  if (!messages.length && placeholder && !log.firstChild) log.append(node('p', placeholder, 'sub'));
  if (nearEnd || !hadMessages) log.scrollTop = log.scrollHeight;
}

function renderPractice() {
  const body = get('practice-body');
  body.replaceChildren();
  const { mode, card, result, done } = state.practice;
  get('home-mode').textContent = mode || 'Daily mix';
  get('practice-mode').value = mode || 'Daily mix';
  function actionButton(title, action, cls) {
    const button = node('button', title, cls);
    button.type = 'button';
    button.dataset.mutation = '';
    button.onclick = action;
    return button;
  }
  if (done || !card) {
    const emptyReview = mode === 'Past mistakes' && !card;
    body.append(
      node(
        'p',
        emptyReview ? 'No missed exercises to revisit.' : done ? 'Session complete.' : 'Ready when you are.',
      ),
    );
    body.append(
      actionButton(
        done ? 'Practice again' : 'Start practice',
        () => startPractice(get('practice-mode').value),
        'primary',
      ),
    );
    return;
  }
  body.append(node('p', card.prompt, 'prompt'));
  if (result) {
    if (ui.answer?.cardId === card.id) body.append(node('p', 'Your answer · ' + ui.answer.value, 'sub'));
    if (typeof result.correct === 'boolean') body.append(node('strong', result.correct ? 'Correct' : 'Review'));
    body.append(
      node('p', result.feedback, 'result'),
      actionButton('Continue →', () => submit({ type: 'next', cardId: card.id }), 'primary'),
    );
    return;
  }
  function answer(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    ui.answer = { cardId: card.id, value: trimmed };
    persist();
    submit({ type: 'answer', cardId: card.id, answer: trimmed });
  }
  if (card.kind === 'choice') {
    const choices = node('div', undefined, 'options');
    for (const choice of card.choices) choices.append(actionButton(choice, () => answer(choice), ''));
    body.append(choices);
  } else {
    const form = node('form');
    const label = node('label', 'Your answer');
    const field = node('textarea');
    field.required = true;
    field.maxLength = 1600;
    field.value = ui.practiceDraft?.id === card.id ? ui.practiceDraft.text : '';
    field.oninput = () => {
      ui.practiceDraft = { id: card.id, text: field.value };
      persist();
    };
    label.append(field);
    const button = node('button', 'Answer', 'primary');
    button.type = 'submit';
    form.append(label, button);
    form.onsubmit = (e) => {
      e.preventDefault();
      answer(field.value);
    };
    body.append(form);
  }
}
function renderSaved() {
  const list = get('saved-items');
  list.replaceChildren();
  if (!state.saved.length) {
    list.append(node('p', 'Your saved readings, words, and notes will appear here.', 'sub'));
    return;
  }
  for (const item of [...state.saved].reverse()) {
    const row = node('article', undefined, 'saved-row');
    row.append(node('span', item.kind, 'small'), node('h2', item.title));
    if (item.detail) row.append(node('p', item.detail));
    if (item.title === reading.title || item.source?.includes(reading.title)) {
      const link = node('a', 'Open 散场以后 ↗', 'sub');
      link.href = '#read';
      row.append(link);
    } else if (item.source) row.append(node('small', item.source, 'sub'));
    list.append(row);
  }
}
function renderState() {
  get('session-notice').textContent = state.notice || '';
  get('session-notice').hidden = !state.notice;
  renderMessages('tutor-messages', state.tutor, 'What’s on your mind?');
  renderMessages('chat-messages', state.chat);
  get('conversation-opener').hidden = Boolean(state.chat.length);
  get('conversation-opener').textContent = ui.chatReading
    ? '散场以后，你一般会马上回家吗？'
    : '今天有什么想聊的？';
  get('conversation-context').hidden = !ui.chatReading;
  get('conversation-context').textContent = ui.chatReading ? '散场以后 · Reading' : '';
  get('save-reading').textContent = isReadingSaved() ? 'Reading saved' : 'Save reading';
  renderPractice();
  renderSaved();
  markBusy(busy);
}

function navigate(initial = false) {
  const previous = page;
  page = currentPage();
  for (const section of document.querySelectorAll('[data-page]')) section.hidden = section.dataset.page !== page;
  if (page !== previous) activeTutorContext = '';
  if (page === 'practice' && (!initial || ui.tutorOpen === undefined)) setTutor(true);
  else setTutor(Boolean(ui.tutorOpen));
  if (page !== 'home' && page !== 'saved') ui.recent = page;
  if (ui.recent && labels[ui.recent]) {
    get('recent').hidden = false;
    get('recent-link').textContent = labels[ui.recent] + ' ↗';
    get('recent-link').href = '#' + ui.recent;
  }
  persist();
  if (!initial) {
    window.scrollTo(0, 0);
    const heading = document.querySelector('[data-page="' + page + '"] h1');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  if (
    page === 'practice' &&
    state &&
    !state.practice.card &&
    (!state.practice.done || previous !== 'practice') &&
    !ui.pending &&
    !busy
  )
    startPractice(get('practice-mode').value || 'Daily mix');
}
window.addEventListener('hashchange', () => navigate());

async function responseJson(response) {
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(
      typeof body.error === 'string' ? body.error : 'Request failed (' + response.status + ').',
    );
    error.status = response.status;
    throw error;
  }
  return body;
}
async function load() {
  loadFailed = false;
  markBusy(true);
  showError('');
  try {
    state = await responseJson(await fetch('/api/state', { cache: 'no-store' }));
    renderState();
  } catch (err) {
    loadFailed = true;
    showError(err.message || 'Could not open the journal.');
  } finally {
    markBusy(false);
  }
  if (state) {
    navigate(true);
    if (ui.pending && !busy) showError('An earlier action still needs a response. Retry to recover it.');
  }
}
async function runAction(action) {
  if (busy || !state) return;
  ui.pending = action;
  persist();
  markBusy(true);
  showError('');
  try {
    state = await responseJson(
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      }),
    );
    if (
      (action.type === 'chat' || action.type === 'tutor') &&
      draftInputs[action.type].value.trim() === action.message
    ) {
      draftInputs[action.type].value = '';
      ui[action.type + 'Draft'] = '';
    }
    if (action.type === 'answer') delete ui.practiceDraft;
    delete ui.pending;
    persist();
    renderState();
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      delete ui.pending;
      persist();
      await load();
    }
    showError(err.message || 'Could not complete this action.');
  } finally {
    markBusy(false);
  }
}
function submit(fields) {
  if (busy || !state) return;
  if (ui.pending) {
    const { id, ...old } = ui.pending;
    if (JSON.stringify(old) === JSON.stringify(fields)) return runAction(ui.pending);
    showError('Retry the previous action before starting another.');
    return;
  }
  return runAction({ id: crypto.randomUUID(), ...fields });
}
get('retry').onclick = () => {
  if (loadFailed || !state) load();
  else if (ui.pending) runAction(ui.pending);
};
function startPractice(mode) {
  return submit({ type: 'practice', mode });
}
get('practice-mode').onchange = (e) => startPractice(e.target.value);
get('save-reading').onclick = () =>
  submit({ type: 'saveReading', title: reading.title, detail: reading.text, source: reading.title });
get('discuss').onclick = () => {
  ui.chatReading = true;
  persist();
  if (state) renderState();
  location.hash = 'chat';
};
const chatEntry = document.querySelector('a[href="#chat"].activity');
chatEntry.onclick = () => {
  ui.chatReading = false;
  persist();
  if (state) renderState();
};
get('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const message = draftInputs.chat.value.trim();
  if (!message) return;
  submit({ type: 'chat', message, source: ui.chatReading ? readingSource : 'Conversation' });
};
get('reflect').onclick = () => {
  setTutor(true, true);
  submit({ type: 'reflect', source: sourceFor('chat') });
};
get('tutor-form').onsubmit = (e) => {
  e.preventDefault();
  const message = draftInputs.tutor.value.trim();
  if (!message) return;
  submit({ type: 'tutor', message, surface: page, source: sourceFor(page) });
};
function askPhrase(phrase) {
  activeTutorContext = reading.title + ' · ' + phrase + '\n' + reading.text;
  setTutor(true, true);
  submit({
    type: 'tutor',
    message: 'What does “' + phrase + '” mean here?',
    surface: 'read',
    source: activeTutorContext,
  });
}
document.querySelectorAll('[data-phrase]').forEach((b) => {
  b.onclick = () => askPhrase(b.dataset.phrase);
});
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  const passage = get('passage');
  if (
    page !== 'read' ||
    !sel ||
    !passage.contains(sel.anchorNode) ||
    !passage.contains(sel.focusNode) ||
    !sel.toString().trim()
  )
    return;
  selectedText = sel.toString().trim().slice(0, 160);
  get('ask-selection').hidden = false;
});
get('ask-selection').onclick = () => {
  if (selectedText) askPhrase(selectedText);
};
navigate(true);
load();
