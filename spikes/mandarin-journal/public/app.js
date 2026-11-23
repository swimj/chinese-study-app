import { createWordInbox } from './words.js';
import { createAnnotations } from './annotations.js';
import { createReading, readingLabel, referenceForSource } from './reading.js';
import { createScrapbook, todayStep } from './scrapbook.js';

const get = (id) => document.getElementById(id);
const labels = { home: 'Journal', read: 'Reading', chat: 'Conversation', practice: 'Practice', saved: 'Scrapbook' };
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
    /* The journal can still run when browser storage is disabled. */
  }
}
function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function button(title, action, cls, mutation = false) {
  const el = node('button', title, cls);
  el.type = 'button';
  if (mutation) el.dataset.mutation = '';
  el.onclick = action;
  return el;
}
function link(title, href, cls) {
  const a = node('a', title, cls);
  a.href = href;
  return a;
}
function route() {
  const [page, kind, value] = location.hash.slice(1).split('/');
  let id = '';
  try { id = decodeURIComponent(value || ''); } catch { /* Invalid bookmark. */ }
  return { page: Object.hasOwn(labels, page) ? page : 'home', kind, id };
}
function href(page, kind, id) {
  return '#' + page + (kind ? '/' + kind + '/' + encodeURIComponent(id) : '');
}
function sourceHref(ref) {
  if (ref.kind === 'annotation') {
    const annotation = state.annotationThreads.find(item => item.id === ref.id);
    return annotation && href(annotation.anchor.surface, 'annotation', annotation.id);
  }
  if (ref.kind === 'attempt') return href('practice', 'attempt', ref.id);
  if (ref.kind === 'reflection') return href('chat', 'reflection', ref.id);
  if (ref.kind === 'reading') return href('read', 'source', ref.id);
}
function thread() {
  return state.threads.find((item) => item.id === state.activeThreadId);
}
function threadReflections() {
  return state.reflections.filter((r) => r.threadId === state.activeThreadId);
}
let state;
let page;
let busy = false;
let requestRevision = 0;
let loadFailed = false;
let focusBeforeTutor;
let renderedThread;
let renderedPractice;
const chatDraft = get('chat-draft');
const tutorDraft = get('tutor-draft');
tutorDraft.value = ui.tutorDraft || '';
tutorDraft.oninput = () => { ui.tutorDraft = tutorDraft.value; persist(); };
chatDraft.oninput = () => {
  if (!state) return;
  ui.chatDrafts ??= {};
  ui.chatDrafts[state.activeThreadId] = chatDraft.value;
  persist();
};

const annotations = createAnnotations({
  submit,
  getState: () => state,
  canSubmit: () => Boolean(state && !busy && !ui.pending),
});
const wordInbox = createWordInbox({
  get, node, button, submit, ui, persist,
  hideReady: true,
  intercept: (text, context) => {
    const kind = captureKind(text);
    if (kind === 'link') {
      importUrl = text;
      location.hash = 'read/import';
      return true;
    }
    if (kind === 'passage') {
      setTutor(true);
      submit({ type: 'tutor', message: [text, context].filter(Boolean).join('\n'), surface: 'home', source: context || '' });
      return true;
    }
    return false;
  },
  canSubmit: () => Boolean(state && !busy && !ui.pending),
  refresh: async () => {
    const revision = requestRevision;
    const updated = await responseJson(await fetch('/api/state', { cache: 'no-store' }));
    if (revision !== requestRevision || busy || ui.pending) return;
    if (JSON.stringify(state.wordIntakes) === JSON.stringify(updated.wordIntakes)) return;
    state.wordIntakes = updated.wordIntakes;
    state.saved = updated.saved;
    state.activity = updated.activity;
    if (page === 'saved') renderSaved();
  },
});
const reader = createReading({
  openAnnotation: id => annotations.open(id),
  quoteBlock: (...args) => annotations.openBlock(...args),
  refreshAnnotations: () => annotations.render(),
  host: document.querySelector('[data-page="read"]'),
  getState: () => state,
  canSubmit: () => Boolean(state && !busy && !ui.pending),
  submit, discussInChinese,
  navigate: (dest, ref) => { location.hash = href(dest, ref ? 'source' : '', ref); },
});
let importUrl = '';
// A drop is a word unless it is plainly a link or a whole sentence.
function captureKind(text) {
  const value = text.trim();
  if (/^https?:\/\/\S+$/i.test(value)) return 'link';
  if (value.length > 24 || /[。！？!?；;]|[，,].{4,}/.test(value)) return 'passage';
  return 'word';
}
const captureLabels = { word: 'Add word', link: 'Import reading', passage: 'Ask tutor' };
get('word-text').addEventListener('input', () => {
  get('capture-submit').textContent = captureLabels[captureKind(get('word-text').value)];
});
const scrapbook = createScrapbook({
  host: get('scrapbook'), viewport: get('scrap-viewport'), world: get('scrap-world'),
  node, link, ui, persist, readingLabel,
  getState: () => state,
  openThread: async (id) => {
    if (id === state.activeThreadId || await submit({ type: 'selectThread', threadId: id })) location.hash = 'chat';
  },
});
get('dock-tutor').onclick = (e) => setTutor(get('tutor-body').inert, true, true, e.currentTarget);
const pointButton = get('tutor-point');
function setPointing(on) {
  pointButton.setAttribute('aria-pressed', String(on));
  pointButton.textContent = on ? 'Pick a piece on the table' : 'Point to something';
}
pointButton.onclick = () => {
  if (pointButton.getAttribute('aria-pressed') === 'true') { scrapbook.stopPicking(); return; }
  setPointing(true);
  scrapbook.pick((piece) => primeTutor({ label: piece.label, surface: 'home', source: piece.source }), () => setPointing(false));
};
function renderToday() {
  const step = todayStep(state, { readingLabel });
  const text = get('today-text');
  text.textContent = step.text;
  if (step.lang) text.lang = step.lang; else text.removeAttribute('lang');
  get('today-action').textContent = step.label;
  get('today-action').href = step.href;
  for (const place of document.querySelectorAll('.places a')) place.hidden = place.getAttribute('href') === step.href.split('/')[0];
}
get('today').textContent = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', month: 'long', day: 'numeric',
}).format(new Date());

function setTutor(open, focus = false, remember = true, opener = document.activeElement) {
  if (remember) { ui.tutorOpen = open; persist(); }
  get('dock-tutor').setAttribute('aria-expanded', String(open));
  if (!open && typeof scrapbook !== 'undefined') { scrapbook.stopPicking(); scrapbook.clearAsked(); }
  const toggle = get('tutor-toggle');
  const body = get('tutor-body');
  const changed = toggle.getAttribute('aria-expanded') !== String(open);
  if (!open && body.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  get('layout').classList.toggle('with-tutor', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Tuck tutor away' : 'Expand tutor');
  body.inert = !open;
  body.setAttribute('aria-hidden', String(!open));
  if (open) {
    if (changed) get('tutor-messages').scrollTop = get('tutor-messages').scrollHeight;
    if (focus) {
      focusBeforeTutor = opener;
      tutorDraft.focus({ preventScroll: true });
    }
  } else if (focus) {
    (focusBeforeTutor?.offsetParent && !body.contains(focusBeforeTutor) ? focusBeforeTutor : toggle).focus({ preventScroll: true });
  }
}
get('tutor-toggle').onclick = event => setTutor(get('tutor-body').inert, true, true, event.currentTarget);
get('tutor').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); setTutor(false, true); }
});
function renderTutorContext() {
  get('tutor-context').hidden = !ui.tutorContext;
  get('tutor-context-label').textContent = ui.tutorContext ? 'About ' + ui.tutorContext.label : '';
}
function primeTutor(context) {
  ui.tutorContext = context;
  renderTutorContext();
  setTutor(true, true);
}
get('clear-context').onclick = () => {
  scrapbook.clearAsked();
  delete ui.tutorContext;
  persist();
  renderTutorContext();
  tutorDraft.focus();
};
function showError(message) {
  get('error-message').textContent = message;
  get('notice').hidden = !message;
  get('retry').hidden = !(loadFailed || ui.pending);
  if (message) get('notice').scrollIntoView({ block: 'nearest' });
}
function markBusy(value) {
  busy = value;
  const waiting = value || !state;
  const action = ui.pending?.type;
  const label = (action === 'importReading' || action === 'importPdf') ? 'Importing reading…' : action === 'addWord' ? 'Adding word…' : action === 'chat' ? 'Waiting for a reply…' : action === 'reflect' ? 'Reflecting…' : 'Working…';
  get('pending').textContent = value ? label : '';
  document.body.dataset.waiting = String(value);
  get('runtime').textContent = [
    state ? (state.mode === 'live' ? 'Live tutor' : 'Demo tutor') : 'Connecting…', value ? label : '',
  ].filter(Boolean).join(' · ');
  for (const el of document.querySelectorAll(
    '#chat-form button, #tutor-form button, #thread-form button[type="submit"], #thread-form button:not([type]), #practice-mode, #practice-body form button, [data-mutation]',
  )) el.disabled = waiting;
  const lastSnapshot = state && threadReflections().at(-1);
  get('reflect').disabled = waiting || !state?.chat.length;
  get('reflect').textContent = lastSnapshot && state.chat.length === lastSnapshot.end ? 'View reflection' : 'Reflect with tutor';
  reader.setBusy(waiting);
  if (state) annotations.render();
}
function messageNode(message, casual = false) {
  const observation = message.kind === 'observation';
  const el = node('div', undefined, 'message' + (observation ? ' observation' : message.role === 'user' ? ' out' : ''));
  if (casual && message.id) {
    el.id = 'chat-line-' + message.id;
    el.tabIndex = -1;
  }
  if (!observation) el.append(node('span', message.role === 'user' ? 'You: ' : casual ? 'Conversation partner: ' : 'Tutor: ', 'sr'));
  if (observation) el.append(node('span', 'Tutor’s note', 'small'));
  const ref = message.reference;
  if (ref && sourceHref(ref)) {
    const a = link(ref.label + ' ↗', sourceHref(ref), 'source-link');
    if (ref.quote) a.append(node('span', ref.quote, 'source-quote'));
    el.append(a);
  }
  if (message.text) {
    const words = node('span', message.text, 'message-text');
    if (casual) {
      words.dataset.annotationSurface = 'chat';
      words.dataset.annotationOwner = state.activeThreadId;
      words.dataset.annotationBlock = message.id;
    }
    el.append(words);
  }
  return el;
}
function renderTutor() {
  const log = get('tutor-messages');
  const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  const existing = [...log.querySelectorAll('[data-turn]')];
  const matches = existing.every((el, i) => el.dataset.turn === JSON.stringify(state.tutor[i]));
  if (!matches || !existing.length) log.replaceChildren();
  for (const message of state.tutor.slice(matches ? existing.length : 0)) {
    const el = messageNode(message);
    el.dataset.turn = JSON.stringify(message);
    log.append(el);
  }
  if (!state.tutor.length) log.replaceChildren(node('p', 'What’s on your mind?', 'sub'));
  if (atEnd || !existing.length) log.scrollTop = log.scrollHeight;
  renderTutorContext();
}
function reflectionSummary(reflection) {
  const el = node('details', undefined, 'reflection-summary');
  el.id = 'reflection-' + reflection.id;
  const count = reflection.takeaways.length;
  el.append(node('summary', count ? 'Reflection · ' + count + (count === 1 ? ' note' : ' notes') : 'Reflection'));
  el.append(node('p', reflection.overview));
  for (const takeaway of reflection.takeaways) {
    el.append(link('“' + takeaway.quote + '”', href('chat', 'annotation', takeaway.annotationId), 'reflection-quote'));
  }
  el.append(button('Discuss reflection', () => primeTutor({
    surface: 'chat', referenceId: reflection.id, source: reflection.overview, label: 'this reflection',
  }), 'text-button'));
  return el;
}
function showReflection(id) {
  const el = get('reflection-' + id);
  if (!el) return false;
  el.open = true;
  focusTarget(el.querySelector('summary'));
  return true;
}
function renderChat() {
  const picker = get('thread-picker');
  picker.replaceChildren(...state.threads.map((t) => new Option(t.title, t.id)));
  picker.value = state.activeThreadId;
  const byEnd = new Map(threadReflections().map((snapshot) => [snapshot.end, snapshot]));
  const log = get('chat-messages');
  if (renderedThread !== state.activeThreadId) {
    renderedThread = state.activeThreadId;
    log.replaceChildren();
  }
  // Turns and reflections are immutable. Preserve old nodes so the live log only announces additions.
  const entries = [];
  state.chat.forEach((message, i) => {
    entries.push({ key: 'turn-' + message.id, message });
    const snapshot = byEnd.get(i + 1);
    if (snapshot) entries.push({ key: 'reflection-' + snapshot.id, snapshot });
  });
  const matches = Array.from(log.children).every((el, i) => el.dataset.entry === entries[i]?.key);
  if (!matches) log.replaceChildren();
  for (const entry of entries.slice(log.childElementCount)) {
    const el = entry.snapshot ? reflectionSummary(entry.snapshot) : messageNode(entry.message, true);
    el.dataset.entry = entry.key;
    log.append(el);
  }
  chatDraft.value = ui.chatDrafts?.[state.activeThreadId] || '';
}
function attemptContent(attempt, card, result) {
  const box = node('div', undefined, 'feedback');
  if (attempt) {
    box.append(node('p', 'Your answer', 'small'), node('p', attempt.answer, 'answer-text'));
  }
  box.append(node('strong', result.correct === true ? 'Correct' : result.correct === false ? 'Review' : 'Tutor feedback'),
    node('p', result.feedback, 'result'));
  if (attempt) box.append(button('Ask the tutor about this answer', () => primeTutor({
    surface: 'practice', referenceId: attempt.id, label: 'your practice answer',
    source: [card.prompt, attempt.answer, result.feedback].join('\n'),
  }), 'text-button'));
  return box;
}
function renderPractice() {
  const { mode, card, result, done } = state.practice;
  const target = route();
  const historical = target.page === 'practice' && target.kind === 'attempt';
  const record = get('attempt-detail');
  get('active-practice').hidden = historical;
  record.hidden = !historical;
  get('practice-mode').value = mode;
  const attempt = historical ? state.attempts.find((a) => a.id === target.id)
    : result && state.attempts.findLast((a) => a.card.id === card?.id);
  const stamp = JSON.stringify([historical, target.id, mode, card, result, done, attempt]);
  if (renderedPractice === stamp) return;
  renderedPractice = stamp;
  if (historical) {
    record.replaceChildren();
    if (attempt) {
      record.append(node('p', 'Earlier attempt', 'small'), node('h2', attempt.card.prompt, 'prompt'),
        attemptContent(attempt, attempt.card, attempt.result));
    } else record.append(node('p', 'This practice answer could not be found.'));
    record.append(link('Return to current practice →', '#practice', 'text-button'));
    return;
  }
  const body = get('practice-body');
  body.replaceChildren();
  if (!card) {
    const latestResults = new Map(state.attempts.map((a) => [a.card.id, a.result.correct]));
    const emptyReview = done && mode === 'Past mistakes' && ![...latestResults.values()].includes(false);
    body.append(node('p', emptyReview ? 'No missed exercises left to revisit.' : done ? 'Batch complete.' : 'Ready when you are.'));
    if (!emptyReview) body.append(button(done ? 'Next batch →' : 'Start practice', () => startPractice(mode, done), 'primary', true));
    return;
  }
  if (card.introduction) body.append(node('p', card.introduction, 'word-introduction'));
  body.append(node('p', card.prompt, 'prompt'));
  if (result) {
    body.append(attemptContent(attempt, card, result),
      button('Continue →', () => submit({ type: 'next', cardId: card.id }), 'primary', true));
    return;
  }
  function answer(value) {
    if (value.trim()) return submit({ type: 'answer', cardId: card.id, answer: value.trim() });
  }
  if (card.kind === 'choice') {
    const choices = node('div', undefined, 'options');
    for (const choice of card.choices) choices.append(button(choice, () => answer(choice), '', true));
    body.append(choices);
  } else {
    const form = node('form');
    const label = node('label', 'Your answer');
    const field = node('textarea');
    field.required = true;
    field.maxLength = 1600;
    field.value = ui.practiceDraft?.id === card.id ? ui.practiceDraft.text : '';
    field.oninput = () => { ui.practiceDraft = { id: card.id, text: field.value }; persist(); };
    label.append(field);
    form.append(label, node('button', 'Answer', 'primary'));
    form.onsubmit = (e) => { e.preventDefault(); answer(field.value); };
    body.append(form);
  }
}
function renderSaved() {
  const list = get('saved-items');
  scrapbook.renderList(list);
  if (!list.childElementCount) list.append(node('p', 'Nothing kept yet.', 'sub'));
  const activity = get('activity-list');
  activity.replaceChildren();
  for (const item of [...state.activity].reverse()) {
    const row = node('li');
    const date = new Date(item.at);
    if (Number.isFinite(date.getTime())) {
      const time = node('time', date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), 'small');
      time.dateTime = date.toISOString();
      row.append(time);
    }
    row.append(node('p', item.text));
    if (item.reference && sourceHref(item.reference)) row.append(link(item.reference.label + ' ↗', sourceHref(item.reference), 'text-button'));
    else if (item.source) row.append(node('span', item.source, 'sub'));
    activity.append(row);
  }
  if (!state.activity.length) activity.append(node('li', 'No activity yet.', 'sub'));
}
function renderState() {
  get('session-notice').textContent = state.notice || '';
  get('session-notice').hidden = !state.notice;
  renderTutor();
  renderChat();
  renderPractice();
  renderSaved();
  wordInbox.render(state);
  reader.render(state);
  renderToday();
  scrapbook.render();
  markBusy(busy);
}
function focusTarget(el) {
  if (!el) return;
  if (!el.matches('summary, a[href], button, input, textarea, select')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center' });
}
async function navigate(initial = false) {
  const previous = page;
  const target = route();
  annotations.close();
  page = target.page;
  if (previous === 'read' && page !== 'read') reader.leave();
  if (previous && previous !== page && ui.tutorContext && !tutorDraft.value.trim()) {
    delete ui.tutorContext;
    renderTutorContext();
  }
  for (const section of document.querySelectorAll('[data-page]')) section.hidden = section.dataset.page !== page;
  document.body.dataset.view = page;
  get('tutor-point').hidden = page !== 'home';
  if (page === 'practice' && ui.tutorOpen === undefined) setTutor(matchMedia('(min-width: 861px)').matches, false, false);
  else setTutor(Boolean(ui.tutorOpen), false, false);
  if (page !== 'home' && page !== 'saved') ui.recent = page;
  if (Object.hasOwn(labels, ui.recent)) {
    get('recent').hidden = false;
    get('recent-link').textContent = labels[ui.recent] + ' ↗';
    get('recent-link').href = '#' + ui.recent;
  }
  wordInbox.updateAttention();
  get('saved-link').setAttribute('aria-current', page === 'saved' ? 'page' : 'false');
  persist();
  if (!initial && previous !== page && !target.kind) {
    window.scrollTo(0, 0);
    const heading = document.querySelector('[data-page="' + page + '"] h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  if (!state) return;
  if (page === 'home' && target.kind === 'words') {
    const first = get('word-items').querySelector('[data-status="clarify"] strong');
    focusTarget(first || get('word-heading'));
  }
  const note = target.kind === 'annotation' && state.annotationThreads.find(t => t.id === target.id && t.anchor.surface === page);
  if (target.kind === 'annotation' && !note) {
    showError('This annotation could not be found.');
    return;
  }
  if (page === 'saved') renderSaved();
  if (page === 'read') {
    const requested = note ? note.anchor.ownerId + '/' + note.anchor.startId
      : target.kind === 'source' && target.id ? target.id : state.reading.documentId;
    if (!reader.openReference(requested)) showError('This reading location could not be found.');
    reader.enter();
    if (target.kind === 'import') { reader.openImport(importUrl); importUrl = ''; }
  }
  if (note) {
    if (page === 'chat' && note.anchor.ownerId !== state.activeThreadId) {
      if (!await submit({ type: 'selectThread', threadId: note.anchor.ownerId })) return;
      if (location.hash !== href(page, 'annotation', note.id)) return;
    }
    const source = [...document.querySelectorAll('[data-annotation-block]')].find(el =>
      el.dataset.annotationSurface === page && el.dataset.annotationOwner === note.anchor.ownerId &&
      el.dataset.annotationBlock === note.anchor.startId);
    source?.scrollIntoView({block:'nearest'});
    annotations.render();
    annotations.open(note.id);
  }
  if (page === 'chat' && target.kind === 'reflection') {
    const reflection = state.reflections.find((r) => r.id === target.id);
    if (reflection && reflection.threadId !== state.activeThreadId) {
      if (!await submit({ type: 'selectThread', threadId: reflection.threadId })) return;
      if (location.hash !== href('chat', 'reflection', reflection.id)) return;
    }
    if (!showReflection(target.id)) showError('This reflection could not be found.');
  }
  if (page === 'chat' && target.kind === 'line') {
    const reflection = state.reflections.find((r) => r.takeaways.some((note) => note.messageId === target.id));
    if (reflection && reflection.threadId !== state.activeThreadId) {
      if (!await submit({ type: 'selectThread', threadId: reflection.threadId })) return;
      if (location.hash !== href('chat', 'line', target.id)) return;
    }
    const el = get('chat-line-' + target.id);
    if (el) focusTarget(el);
    else showError('This message could not be found.');
  }
  annotations.render();
  if (page === 'practice') {
    renderPractice();
    if (!target.kind && !state.practice.card && !state.practice.done && !ui.pending && !busy) startPractice(state.practice.mode);
  }
}
window.addEventListener('hashchange', () => {
  reader.resetImportFeedback();
  navigate();
});
// An already-open bookmark still brings its source back into view.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (a && a.hash === location.hash && route().kind && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    navigate();
  }
});
async function responseJson(response) {
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(typeof body.error === 'string' ? body.error : 'Request failed (' + response.status + ').');
    error.status = response.status;
    if (response.status === 422) {
      error.preview = body.preview;
      error.canPaste = body.canPaste === true;
    }
    throw error;
  }
  return body;
}
async function load() {
  ++requestRevision;
  loadFailed = false;
  markBusy(true);
  showError('');
  try {
    state = await responseJson(await fetch('/api/state', { cache: 'no-store' }));
    if (ui.chatDraft) {
      ui.chatDrafts ??= {};
      ui.chatDrafts[state.activeThreadId] ??= ui.chatDraft;
      delete ui.chatDraft;
      persist();
    }
    renderState();
  } catch (err) {
    loadFailed = true;
    showError(err.message || 'Could not open the journal.');
  } finally {
    markBusy(false);
  }
  if (state && !loadFailed) {
    await navigate(true);
    if (ui.pending && !busy) showError('An earlier action still needs a response. Retry to recover it.');
  }
}
async function runAction(action) {
  if (busy || !state) return false;
  ++requestRevision;
  const startingHash = location.hash;
  const currentImport = action.type === 'importReading' && reader.trackImport(action.url);
  ui.pending = action;
  persist();
  markBusy(true);
  showError('');
  try {
    state = await responseJson(await fetch('/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
    }));
    if (action.type === 'chat' && chatDraft.value.trim() === action.message) {
      chatDraft.value = '';
      if (ui.chatDrafts) delete ui.chatDrafts[action.threadId || state.activeThreadId];
    }
    if (action.type === 'tutor' && tutorDraft.value.trim() === action.message) {
      tutorDraft.value = '';
      delete ui.tutorDraft;
    }
    if (action.type === 'answer') delete ui.practiceDraft;
    delete ui.pending;
    persist();
    renderState();
    if (action.type === 'importPdf' && page === 'read' && location.hash === startingHash) reader.imported(undefined, true);
    if (currentImport && currentImport() && location.hash === startingHash) reader.imported(action.url, page === 'read');
    return true;
  } catch (err) {
    if (action.type === 'importPdf' && err.status) {
      delete ui.pending;
      persist();
      if (page === 'read' && location.hash === startingHash) reader.pdfMessage(err.message);
      else showError(err.message);
      return false;
    }
    if (action.type === 'importReading' && err.status) {
      delete ui.pending;
      persist();
      if (currentImport() && startingHash === location.hash) {
        if (page === 'read') reader.importError(action.url, err.message, err.preview, err.canPaste, action.pastedText);
        else showError(err.message);
      }
      return false;
    }
    if (err.status === 400 || err.status === 409) {
      delete ui.pending;
      persist();
      await load();
    }
    showError(err.message || 'Could not complete this action.');
    return false;
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
function startPractice(mode, more = false) {
  return submit({ type: 'practice', mode, ...(more ? { continue: true } : {}) });
}
get('practice-mode').onchange = (e) => startPractice(e.target.value);
function openThreadForm(open) {
  get('thread-form').hidden = !open;
  get('new-thread').setAttribute('aria-expanded', String(open));
  (open ? get('thread-title') : get('new-thread')).focus();
}
get('new-thread').onclick = () => openThreadForm(get('thread-form').hidden);
get('cancel-thread').onclick = () => openThreadForm(false);
get('thread-picker').onchange = async (e) => {
  const id = e.target.value;
  if (await submit({ type: 'selectThread', threadId: id })) {
    history.replaceState(null, '', '#chat');
    chatDraft.focus();
  } else get('thread-picker').value = state.activeThreadId;
};
get('thread-form').onsubmit = async (e) => {
  e.preventDefault();
  const title = get('thread-title').value.trim();
  if (title && await submit({ type: 'newThread', title })) {
    get('thread-title').value = '';
    openThreadForm(false);
    history.replaceState(null, '', '#chat');
    chatDraft.focus();
  }
};
async function discussInChinese({ title, source }) {
  const existing = state.threads.find((t) => t.title === title && t.source === source);
  const action = existing ? { type: 'selectThread', threadId: existing.id } : { type: 'newThread', title, source };
  if (await submit(action)) location.hash = 'chat';
}
get('chat-form').onsubmit = async (e) => {
  e.preventDefault();
  const message = chatDraft.value.trim();
  if (message && await submit({ type: 'chat', message, threadId: state.activeThreadId, source: thread().source || thread().title })) chatDraft.focus();
};
get('reflect').onclick = async () => {
  const latest = threadReflections().at(-1);
  if (latest && latest.end === state.chat.length) {
    showReflection(latest.id);
    return;
  }
  if (await submit({ type: 'reflect', threadId: state.activeThreadId, source: thread().title })) {
    const reflection = threadReflections().at(-1);
    if (reflection && page === 'chat') showReflection(reflection.id);
  }
};
get('tutor-form').onsubmit = (e) => {
  e.preventDefault();
  const message = tutorDraft.value.trim();
  if (!message) return;
  let source = labels[page];
  let referenceId;
  if (page === 'read') { source = reader.source(); referenceId = reader.currentReference(); }
  if (page === 'chat') source = [thread().title, ...state.chat.slice(-2).map((m) => m.text)].join('\n');
  if (page === 'practice') {
    if (route().kind === 'attempt') {
      const attempt = state.attempts.find((a) => a.id === route().id);
      if (attempt) { source = attempt.card.prompt; referenceId = attempt.id; }
    } else source = state.practice.card?.prompt || 'Practice';
  }
  const context = ui.tutorContext || { surface: page, source, referenceId };
  submit({ type: 'tutor', message, source: context.source, surface: context.surface, referenceId: context.referenceId });
};
navigate(true);
load();
