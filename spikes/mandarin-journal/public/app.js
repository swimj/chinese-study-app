import { readChatStream } from './chat-stream.js';
import { createTurnProgress } from './turn-progress.js';
import { createCapture, replyTarget, wordForTurn } from './capture.js';
import { createAnnotations } from './annotations.js';
import { createReading, readingLabel, referenceForSource } from './reading.js';
import { createScrapbook, wallOffers } from './scrapbook.js';
import { compose } from './media-policy.js';
import { createTeaching } from './teaching.js';

const get = (id) => document.getElementById(id);
const labels = { home: 'Journal', scrapbook: 'Scrapbook', read: 'Reading', chat: 'Conversation', practice: 'Practice', saved: 'List' };
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
// Small line icons that inherit the text color; decorative, so screen readers read only the label.
const ICONS = {
  ask: 'M4 5h16v11H9l-5 4z',
  flag: 'M5 21V4m0 0c2.5-1.5 4.5-1.5 7 0s4.5 1.5 7 0v8c-2.5 1.5-4.5 1.5-7 0s-4.5-1.5-7 0',
};
function labelled(el, name) {
  el.setAttribute('aria-label', name);
  el.title = name;
  return el;
}
function withIcon(el, name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  el.prepend(svg);
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
let pendingError = '';
const getPending = () => ({ action: ui.pending, busy, error: pendingError });
const retryPending = () => ui.pending && runAction(ui.pending);
const turnProgress = createTurnProgress({ get, retryPending });
let requestRevision = 0;
let loadFailed = false;
let focusBeforeTutor;
let renderedThread;
let renderedPractice;
const chatDraft = get('chat-draft');
const tutorDraft = get('tutor-draft');
tutorDraft.value = ui.tutorDraft || '';
tutorDraft.oninput = () => {
  if (!ui.tutorDraft && !ui.tutorContext && !ui.tutorReply) ui.tutorReply = defaultReply();
  ui.tutorDraft = tutorDraft.value;
  persist();
};
chatDraft.oninput = () => {
  if (!state) return;
  ui.chatDrafts ??= {};
  ui.chatDrafts[state.activeThreadId] = chatDraft.value;
  persist();
};

async function readerRequest(path, body) {
  return responseJson(await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}
const annotations = createAnnotations({
  getPending, retryPending, onViewChange: displayPendingError,
  lookupPassage: body => readerRequest('/api/reader-lookup', body),
  flagLookup: id => readerRequest('/api/reader-lookup/feedback', { id }),
  submit,
  getState: () => state,
  canSubmit: () => Boolean(state && !busy && !ui.pending),
});
const capture = createCapture({
  get, submit, ui, persist,
  openReading(url) { importUrl = url; location.hash = 'home/import'; },
  canSubmit: () => Boolean(state && !busy && !ui.pending),
  refresh: async () => {
    const revision = requestRevision;
    const updated = await responseJson(await fetch('/api/state', { cache: 'no-store' }));
    if (revision !== requestRevision || busy || ui.pending) return;
    if (JSON.stringify(state.wordIntakes) === JSON.stringify(updated.wordIntakes)) return;
    state.wordIntakes = updated.wordIntakes;
    state.saved = updated.saved;
    state.board = updated.board;
    state.activity = updated.activity;
    state.tutor = updated.tutor;
    renderTutor();
    capture.watch(state.wordIntakes);
    if (page === 'saved') renderSaved();
    renderWall(scrapbook.render());
  },
});
const reader = createReading({
  getPending, retryPending,
  openAnnotation: id => annotations.open(id),
  refreshAnnotations: () => annotations.render(),
  host: document.querySelector('[data-page="read"]'),
  importPanel: get('home-import'),
  canSubmit: () => Boolean(state && !busy && !ui.pending),
  submit, discussInChinese,
  navigate: (dest, ref) => { location.hash = href(dest, ref ? 'source' : '', ref); },
});
let importUrl = '';
let importReturnFocus;
const importDialog = get('home-import');
const notice = get('notice');
function dismissImport() {
  const repairId = route().id;
  location.hash = repairId ? href('read', 'source', repairId) : '#home';
}
get('close-import').onclick = dismissImport;
importDialog.oncancel = event => { event.preventDefault(); dismissImport(); };

const scrapbook = createScrapbook({
  host: get('scrapbook'), viewport: get('scrap-viewport'), world: get('scrap-world'),
  node, link, ui, persist, readingLabel, compose, submit,
  getState: () => state,
  react: (mediaId, reaction) => submit({ type: 'mediaReaction', mediaId, reaction }),
  openThread: async (id) => {
    if (id === state.activeThreadId || await submit({ type: 'selectThread', threadId: id })) location.hash = 'chat';
  },
});
const tutorSeals = document.querySelectorAll('[data-tutor-toggle]');
for (const seal of tutorSeals) seal.onclick = () => setTutor(get('tutor-body').inert, true, true, seal);
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
function renderWall(clusters) {
  const { practice, practiceTime, reading, conversation, piece, pieceCount } = wallOffers(state, clusters);
  const ticket = get('wall-practice');
  ticket.querySelector('.offer').textContent = practiceTime || practice;
  ticket.querySelector('.offer-detail').textContent = practiceTime ? practice : '';
  const book = get('wall-read');
  book.href = reading?.href || '#home/import';
  book.querySelector('.offer').textContent = reading?.title || 'Bring a reading';
  book.querySelector('.offer-detail').textContent = reading?.excerpt || '';
  book.querySelector('.bookmark-note').textContent = reading?.bookmark || '';
  const talk = get('wall-talk');
  talk.href = conversation ? href('chat', 'thread', conversation.id) : '#chat';
  talk.onclick = !conversation && state.chat.length ? event => { event.preventDefault(); justTalk(); } : null;
  const turns = conversation?.id === state.activeThreadId ? state.chat : [];
  const lastLearnerLine = turns.findLast(turn => turn.role === 'user');
  const quoteAsTitle = conversation?.title === 'Conversation' && lastLearnerLine;
  talk.querySelector('.offer').textContent = quoteAsTitle ? lastLearnerLine.text : conversation?.title || 'Just talk';
  const caption = quoteAsTitle ? turns.at(-1) : lastLearnerLine;
  const postscript = get('wall-talk-line');
  postscript.textContent = caption && !(quoteAsTitle && caption === lastLearnerLine) ? caption.text : '';
  postscript.hidden = !postscript.textContent;
  get('wall-just-talk').hidden = !conversation;
  const revisit = get('wall-piece');
  revisit.hidden = !piece;
  if (piece) {
    revisit.textContent = pieceCount + (pieceCount === 1 ? ' piece' : ' pieces') + ' · Revisit ' + piece.title;
    revisit.href = piece.href;
  }
}
get('wall-just-talk').onclick = justTalk;
async function justTalk() {
  const origin = location.hash;
  const empty = state.threads.find(t => !t.hasTurns && !t.source && t.title === 'Conversation');
  const action = empty ? { type: 'selectThread', threadId: empty.id } : { type: 'newThread', title: 'Conversation' };
  if (await submit(action) && location.hash === origin) location.hash = 'chat';
}
get('wall-date').textContent = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', month: 'short', day: 'numeric',
}).format(new Date());

function setTutor(open, focus = false, remember = true, opener = document.activeElement) {
  if (remember) { ui.tutorOpen = open; persist(); }
  for (const seal of tutorSeals) seal.setAttribute('aria-expanded', String(open));
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
  displayPendingError();
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
function defaultReply() {
  if (page !== 'home' || ui.pending?.type === 'tutor' || ui.tutorContext || !state || importDialog.open) return;
  const reply = replyTarget(state, state.tutor.at(-1));
  if (reply && (reply.captureQuestionId || reply.wordReplyTo.requestId) !== ui.dismissedQuestion) return reply;
}
function activeReply() {
  return ui.tutorReply || (!tutorDraft.value.trim() && defaultReply());
}
function renderTutorContext() {
  const target = ui.tutorContext || activeReply();
  get('tutor-context').hidden = !target;
  get('tutor-context-label').textContent = target ? 'About ' + target.label : '';
}
function primeTutor(context) {
  delete ui.tutorReply;
  ui.tutorContext = context;
  renderTutorContext();
  setTutor(true, true);
}
function chooseReply(reply) {
  scrapbook.clearAsked();
  delete ui.tutorContext;
  ui.tutorReply = reply;
  const legacyDraft = ui.wordReplies?.[reply.wordReplyTo?.intakeId];
  const item = state.wordIntakes.find(i => i.id === reply.wordReplyTo?.intakeId);
  if (item && !tutorDraft.value && legacyDraft?.question === item.question) {
    ui.tutorDraft = tutorDraft.value = legacyDraft.text;
  }
  renderTutorContext();
  setTutor(true, true);
}
get('clear-context').onclick = () => {
  scrapbook.clearAsked();
  delete ui.tutorContext;
  const reply = ui.tutorReply || defaultReply();
  if (reply) ui.dismissedQuestion = reply.captureQuestionId || reply.wordReplyTo.requestId;
  delete ui.tutorReply;
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
function renderPending() {
  if (!state) return;
  renderConversationTurn();
  turnProgress.render({ ...getPending(), state });
}
function markBusy(value) {
  busy = value;
  const waiting = value || !state || Boolean(ui.pending);
  const mode = state ? (state.mode === 'live' ? 'Live tutor' : 'Demo tutor') : 'Connecting…';
  get('runtime').textContent = mode;
  const chatting = value && (ui.pending?.type === 'chat' || ui.pending?.type === 'tutor');
  get('pending').textContent = chatting ? 'Waiting for a reply…' : '';
  renderPending();
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
  } else if (message.sourceLabel) el.append(node('span', message.sourceLabel, 'message-source'));
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
// The visible draft turn sits beside the live history. Only committed messages
// enter that history, so assistive technology gets one reply announcement.
function renderConversationTurn() {
  const action = ui.pending;
  for (const kind of ['chat', 'tutor']) {
    const box = get(kind + '-turn');
    const history = kind === 'tutor' ? state.tutor : state.chat;
    const relevant = action?.type === kind && !history.some(m => m.id === action.id)
      && (kind === 'tutor' || !action.threadId || action.threadId === state.activeThreadId);
    if (!relevant) {
      if (!box.hidden) { box.hidden = true; box.replaceChildren(); delete box.dataset.action; }
      continue;
    }
    const follow = followsConversation(kind);
    if (box.dataset.action !== action.id) {
      box.dataset.action = action.id;
      const sourceLabel = action.wordReplyTo || action.captureQuestionId ? action.source : action.sourceLabel;
      const outgoing = messageNode({ role: 'user', text: action.message, sourceLabel });
      const incoming = node('div', 'Replying…', 'message turn-status');
      incoming.dataset.preview = '';
      const failure = node('p', undefined, 'turn-error');
      failure.append(node('span'), button('Retry', retryPending, 'text-button'));
      failure.firstChild.setAttribute('role', 'status');
      failure.lastChild.dataset.turnRetry = '';
      box.replaceChildren(outgoing, incoming, failure);
      if (kind === 'tutor' && !state.tutor.length) get('tutor-history').replaceChildren();
    }
    box.hidden = false;
    const incoming = box.querySelector('[data-preview]');
    incoming.hidden = Boolean(pendingError) && incoming.classList.contains('turn-status');
    const failure = box.lastChild;
    failure.hidden = !pendingError;
    failure.firstChild.textContent = pendingError;
    if (follow) followConversation(kind);
  }
}
function followsConversation(kind) {
  if (kind === 'chat') {
    const bottom = get('chat-messages').getBoundingClientRect().bottom;
    return page === 'chat' && bottom > 0 && bottom <= window.innerHeight + 48;
  }
  const log = get('tutor-messages');
  return !get('tutor-body').inert && log.scrollHeight - log.scrollTop - log.clientHeight < 48;
}
function followConversation(kind) {
  if (kind === 'chat') get('chat-form').scrollIntoView({ block: 'nearest' });
  else get('tutor-messages').scrollTop = get('tutor-messages').scrollHeight;
}
function appendChatText(text) {
  if (!text) return;
  const follow = followsConversation('chat');
  const bubble = get('chat-turn').querySelector('[data-preview]');
  if (!bubble) return;
  if (bubble.classList.contains('turn-status')) {
    bubble.classList.remove('turn-status');
    bubble.replaceChildren();
    bubble.lang = 'zh';
  }
  bubble.append(document.createTextNode(text));
  if (follow) followConversation('chat');
}
function renderTutor() {
  const scroll = get('tutor-messages');
  const log = get('tutor-history');
  const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;
  const existing = [...log.querySelectorAll('[data-turn]')];
  state.tutor.forEach((message, i) => {
    const item = wordForTurn(state, message);
    const stamp = JSON.stringify([message, item?.status, message.reference && sourceHref(message.reference)]);
    if (existing[i]?.dataset.turn === stamp) return;
    const el = messageNode(message);
    const reply = replyTarget(state, message);
    if (reply || item?.status === 'failed') {
      const actions = node('div', undefined, 'options word-choices');
      if (reply) {
        for (const choice of item?.suggestions || []) {
          actions.append(button(choice, () => submit({ type: 'tutor', message: choice, surface: 'home', source: item.text, wordReplyTo: reply.wordReplyTo }), '', true));
        }
        actions.append(button('Reply', () => chooseReply(reply), 'text-button'));
      } else {
        actions.append(button('Retry', () => submit({ type: 'retryWord', intakeId: item.id }), '', true));
      }
      el.append(actions);
    }
    el.dataset.turn = stamp;
    if (existing[i]) existing[i].replaceWith(el);
    else {
      if (!i) log.replaceChildren();
      log.append(el);
    }
  });
  for (const extra of existing.slice(state.tutor.length)) extra.remove();
  const needsReply = state.tutor.some(turn => replyTarget(state, turn));
  for (const seal of tutorSeals) {
    seal.classList.toggle('needs-reply', needsReply);
    seal.setAttribute('aria-label', needsReply ? 'Tutor has a question' : 'Tutor');
  }
  get('tutor-attention').hidden = !needsReply;
  if (!state.tutor.length && ui.pending?.type !== 'tutor') log.replaceChildren(node('p', 'What’s on your mind?', 'sub'));
  if (atEnd || !existing.length) scroll.scrollTop = scroll.scrollHeight;
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
  const log = get('chat-history');
  if (renderedThread !== state.activeThreadId) {
    renderedThread = state.activeThreadId;
    log.replaceChildren();
  }
  // Keep existing turns in the live log. A reflection’s visible notes can change when the learner deletes a piece.
  const entries = [];
  state.chat.forEach((message, i) => {
    entries.push({ key: 'turn-' + message.id, message });
    const snapshot = byEnd.get(i + 1);
    if (snapshot) entries.push({ key: 'reflection-' + snapshot.id, snapshot });
  });
  const matches = Array.from(log.children).every((el, i) => el.dataset.entry === entries[i]?.key);
  if (!matches) log.replaceChildren();
  entries.forEach((entry, i) => {
    const existing = log.children[i];
    const noteCount = entry.snapshot && String(entry.snapshot.takeaways.length);
    if (existing && existing.dataset.noteCount === noteCount) return;
    const el = entry.snapshot ? reflectionSummary(entry.snapshot) : messageNode(entry.message, true);
    el.dataset.entry = entry.key;
    if (entry.snapshot) {
      el.dataset.noteCount = noteCount;
      el.open = existing?.open || false;
    }
    if (existing) existing.replaceWith(el);
    else log.append(el);
  });
  chatDraft.value = ui.chatDrafts?.[state.activeThreadId] || '';
}
function attemptContent(attempt, card, result, next) {
  const box = node('div', undefined, 'feedback');
  if (attempt) {
    box.append(node('p', 'Your answer', 'small'), node('p', attempt.answer, 'answer-text'));
  }
  box.append(node('strong', result.correct === true ? 'Correct' : result.correct === false ? 'Review' : 'Tutor feedback'),
    node('p', result.feedback, 'result'));
  if (!attempt) {
    if (next) box.append(next);
    return box;
  }
  const actions = node('div', undefined, 'feedback-actions');
  actions.append(withIcon(labelled(button('Ask', () => primeTutor({
    surface: 'practice', referenceId: attempt.id, label: 'your practice answer',
    source: [card.prompt, attempt.answer, result.feedback].join('\n'),
  }), 'text-button'), 'Ask the tutor about this answer'), 'ask'));
  // A bad exercise counts neither for nor against the learner.
  if (attempt.flagged) actions.append(withIcon(node('p', 'Flagged · won’t count', 'small flagged'), 'flag'));
  else actions.append(withIcon(labelled(button('Flag', () => submit({ type: 'flagExercise', attemptId: attempt.id }), 'text-button quiet'), 'Flag as a bad exercise'), 'flag'));
  if (next) actions.append(next);
  box.append(actions);
  return box;
}
function renderSessionProgress(session) {
  const bar = get('session-progress');
  // The end state gives its own summary.
  bar.hidden = !session || state.practice.done;
  if (bar.hidden) return;
  const spent = Math.min(session.spentMinutes, session.budgetMinutes);
  get('session-time').textContent = spent + ' of ' + session.budgetMinutes + ' min';
  const meter = get('session-meter');
  meter.max = session.budgetMinutes;
  meter.value = spent;
}
// The state of practice with no card in front of the learner. Returns the element to focus.
function renderSessionEnd(body, mode, done, session) {
  if (session?.waiting) {
    const waiting = node('p', 'Preparing the next exercise…', 'session-waiting');
    waiting.setAttribute('role', 'status');
    body.append(waiting);
    return waiting;
  }
  const latestResults = new Map(state.attempts.map((a) => [a.card.id, a.result.correct]));
  const emptyReview = done && mode === 'Past mistakes' && ![...latestResults.values()].includes(false);
  if (emptyReview || !done || !session) {
    const text = node('p', emptyReview ? 'No missed exercises left to revisit.' : 'Ready when you are.');
    body.append(text);
    if (emptyReview) return text;
    const start = button('Start practice', () => startPractice(mode, done), 'primary', true);
    body.append(start);
    return start;
  }
  const failed = session.stopped === 'failed' && !session.ended;
  // Nothing left to ask about: say so instead of offering more time that would stay empty.
  const exhausted = session.stopped === 'exhausted';
  const end = node('section', undefined, 'session-end');
  const heading = node('h2', failed ? 'Practice paused' : exhausted && !session.ended ? 'Nothing more to practice for now' : 'Session complete');
  end.append(heading);
  if (session.exercises) {
    const count = session.exercises === 1 ? '1 exercise' : session.exercises + ' exercises';
    end.append(node('p', count + ' · ' + session.spentMinutes + ' min', 'sub'));
  }
  if (!exhausted) {
    const actions = node('div', undefined, 'session-actions');
    actions.append(button(failed ? 'Try again' : 'Keep going · 5 min', () => startPractice(mode, true), 'primary', true));
    if (!failed) actions.append(link('Back home', '#home'));
    end.append(actions);
  }
  body.append(end);
  return heading;
}
let practiceFocused = false;
document.addEventListener('focusin', (e) => {
  practiceFocused = get('practice-body').contains(e.target);
});
// While the learner waits for a card being prepared, check back until it arrives.
let practicePoll;
function schedulePracticePoll() {
  clearTimeout(practicePoll);
  if (page !== 'practice' || !state.practice.session?.waiting) return;
  practicePoll = setTimeout(async () => {
    const revision = requestRevision;
    try {
      const updated = await responseJson(await fetch('/api/state', { cache: 'no-store' }));
      if (revision !== requestRevision || busy || ui.pending) return schedulePracticePoll();
      state.practice = updated.practice;
      state.notice = updated.notice;
      get('session-notice').textContent = state.notice || '';
      get('session-notice').hidden = !state.notice;
      renderPractice();
    } catch {
      schedulePracticePoll();
    }
  }, 900);
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
  const session = state.practice.session;
  const stamp = JSON.stringify([historical, target.id, mode, card, result, done, attempt, session]);
  schedulePracticePoll();
  if (renderedPractice === stamp) return;
  renderedPractice = stamp;
  renderSessionProgress(session);
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
  // A learner moving through the session by keyboard keeps their place when the body
  // is replaced. A control disabled during the request drops focus to the page, so
  // the last focus inside the session is what counts.
  const hadFocus = practiceFocused || body.contains(document.activeElement);
  body.replaceChildren();
  const settleFocus = (el) => {
    if (!hadFocus || !el) return;
    if (!el.matches('button, a[href], textarea, input, select')) el.tabIndex = -1;
    // A completed request reenables its controls at the end of this render.
    queueMicrotask(() => {
      if (el.isConnected && page === 'practice') el.focus();
    });
  };
  if (!card) {
    settleFocus(renderSessionEnd(body, mode, done, session));
    return;
  }
  if (card.kind === 'lesson') {
    renderLesson(body, card, hadFocus);
    return;
  }
  // A Continue that ends the session says so.
  const exercise = renderExercise(card, result, attempt, session?.last ? 'Finish session →' : 'Continue →');
  const focusExercise = () => settleFocus(exercise.querySelector(result ? '.practice-next' : 'input, textarea') ?? exercise.querySelector('.prompt'));
  const beats = card.teaching?.length ? card.teaching : null;
  if (!beats) {
    body.append(exercise);
    focusExercise();
    return;
  }
  const step = ui.teaching?.id === card.id ? ui.teaching : null;
  const taught = !!result || !!step?.done;
  const teaching = createTeaching(beats, {
    shown: step?.shown,
    done: taught,
    onAdvance(shown) {
      ui.teaching = { id: card.id, shown };
      persist();
    },
    onDone() {
      ui.teaching = { id: card.id, shown: beats.length, done: true };
      persist();
      body.append(exercise);
      const first = exercise.querySelector('.options button, textarea, input');
      first?.focus({ preventScroll: true });
      exercise.scrollIntoView({ block: 'nearest' });
    },
  });
  body.append(teaching.element);
  if (taught) {
    body.append(exercise);
    focusExercise();
    return;
  }
  // Opening a taught card puts Continue under the learner's hand, unless they are typing elsewhere.
  const active = document.activeElement;
  if (teaching.control && page === 'practice' && (hadFocus || !active || active === document.body || body.contains(active)))
    teaching.control.focus({ preventScroll: true });
}
// A lesson teaches in beats and asks nothing: its last Continue moves the session on.
function renderLesson(body, card, hadFocus) {
  const beats = card.teaching ?? [];
  const step = ui.teaching?.id === card.id ? ui.teaching : null;
  const teaching = createTeaching(beats, {
    shown: step?.shown,
    onAdvance(shown) {
      ui.teaching = { id: card.id, shown };
      persist();
    },
    async onDone() {
      if (await submit({ type: 'next', cardId: card.id })) return;
      // The lesson stays in front of the learner when moving on fails.
      renderedPractice = null;
      renderPractice();
    },
  });
  body.append(teaching.element);
  const active = document.activeElement;
  if (teaching.control && page === 'practice' && (hadFocus || !active || active === document.body || body.contains(active)))
    teaching.control.focus({ preventScroll: true });
}
function renderExercise(card, result, attempt, continueLabel = 'Continue →') {
  const body = node('div', undefined, 'exercise');
  const formName = { choice: 'Multiple choice', recall: 'Recall', open: 'Conversation' };
  body.append(node('p', formName[card.kind], 'small card-type'), node('p', card.prompt, 'prompt'));
  if (result) {
    const next = button(continueLabel, () => submit({ type: 'next', cardId: card.id }), 'primary practice-next', true);
    next.setAttribute('aria-keyshortcuts', 'Space');
    body.append(attemptContent(attempt, card, result, next));
    return body;
  }
  function answer(value) {
    if (value.trim()) return submit({ type: 'answer', cardId: card.id, answer: value.trim() });
  }
  if (card.kind === 'choice') {
    const choices = node('div', undefined, 'options');
    for (const choice of card.choices) choices.append(button(choice, () => answer(choice), '', true));
    body.append(choices);
  } else {
    const recall = card.kind === 'recall';
    const form = node('form', undefined, 'practice-response');
    const label = node('label', recall ? 'Your answer' : 'Your reply');
    const field = node(recall ? 'input' : 'textarea');
    field.lang = 'zh';
    field.required = true;
    field.maxLength = recall ? 80 : 1600;
    if (recall) {
      field.type = 'text';
      field.autocomplete = 'off';
      field.spellcheck = false;
    }
    field.value = ui.practiceDraft?.id === card.id ? ui.practiceDraft.text : '';
    field.oninput = () => { ui.practiceDraft = { id: card.id, text: field.value }; persist(); };
    const send = node('button', recall ? 'Check answer' : 'Send reply', 'primary');
    if (!recall) {
      send.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
      send.title = 'Send with Ctrl+Enter or ⌘+Enter';
      field.onkeydown = (e) => {
        if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey ||
            e.repeat || e.isComposing || e.keyCode === 229 || send.disabled) return;
        e.preventDefault();
        form.requestSubmit(send);
      };
    }
    label.append(field);
    form.append(label, send);
    form.onsubmit = (e) => { e.preventDefault(); answer(field.value); };
    body.append(form);
  }
  return body;
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
for (const option of document.querySelectorAll('input[name="pictures"]')) {
  option.onchange = async () => {
    if (!await submit({ type: 'settings', pictures: option.value })) renderPictures();
  };
}
function renderPictures() {
  for (const option of document.querySelectorAll('input[name="pictures"]')) option.checked = option.value === (state.settings?.pictures || 'normal');
}
function renderState() {
  renderPictures();
  get('session-notice').textContent = state.notice || '';
  get('session-notice').hidden = !state.notice;
  renderTutor();
  renderChat();
  renderPractice();
  renderSaved();
  capture.watch(state.wordIntakes);
  reader.render(state);
  renderWall(scrapbook.render());
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
  if (get('board-actions').open) get('board-actions').close();
  if (location.hash === '#read/import' || location.hash === '#read/import/') {
    history.replaceState(null, '', '#home/import');
  }
  const target = route();
  if (importDialog.open && !(target.page === 'home' && target.kind === 'import')) {
    reader.closeImport();
    get('layout').before(notice);
    if (target.page === 'home' && !target.kind) importReturnFocus?.focus({ preventScroll: true });
  }
  annotations.close();
  page = target.page;
  if (previous === 'read' && page !== 'read') reader.leave();
  if (previous && previous !== page && ui.tutorContext && !tutorDraft.value.trim()) {
    delete ui.tutorContext;
    renderTutorContext();
  }
  for (const section of document.querySelectorAll('[data-page]')) section.hidden = section.dataset.page !== page;
  document.body.dataset.view = page;
  get('tutor-point').hidden = page !== 'scrapbook';
  if (page !== 'scrapbook') scrapbook.stopPicking();
  setTutor(Boolean(ui.tutorOpen), false, false);
  renderTutorContext();
  get('saved-link').setAttribute('aria-current', page === 'saved' ? 'page' : 'false');
  persist();
  if (!initial && previous !== page && !target.kind) {
    window.scrollTo(0, 0);
    const heading = document.querySelector('[data-page="' + page + '"] h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  if (!state) return;
  if (page === 'scrapbook' && target.kind === 'piece' && !scrapbook.showPiece(target.id)) {
    focusTarget(document.querySelector('#scrapbook h1'));
    showError('This piece is no longer in the scrapbook.');
  }
  if (page === 'chat' && target.kind === 'thread' && target.id !== state.activeThreadId) {
    if (!state.threads.some(t => t.id === target.id)) { showError('This conversation could not be found.'); return; }
    if (!await submit({ type: 'selectThread', threadId: target.id }) || location.hash !== href('chat', 'thread', target.id)) return;
  }
  if (page === 'scrapbook' && previous === 'read' && !target.kind) {
    scrapbook.showReading(reader.documentId());
  }
  if (page === 'home' && target.kind === 'import') {
    if (!importDialog.open) {
      importReturnFocus = importUrl ? get('word-text') : get('wall-read');
      importDialog.append(notice);
      reader.openImport(importUrl, target.id);
      importUrl = '';
    }
  }
  if (page === 'home' && target.kind === 'words') {
    const waiting = state.tutor.findLast(turn => replyTarget(state, turn));
    if (waiting) chooseReply(replyTarget(state, waiting));
    else setTutor(true, true);
  }
  const note = target.kind === 'annotation' && state.annotationThreads.find(t => t.id === target.id && t.anchor.surface === page);
  if (target.kind === 'annotation' && !note) {
    showError('This annotation could not be found.');
    return;
  }
  if (page === 'saved') {
    renderSaved();
    if (target.kind === 'archive' && !get('board-archive').hidden) {
      get('board-archive').open = true;
      focusTarget(get('board-archive').querySelector('summary'));
    }
  }
  if (page === 'chat' && target.kind === 'thread') chatDraft.focus({ preventScroll: true });
  if (page === 'read') {
    const requested = note ? note.anchor.ownerId + '/' + note.anchor.startId
      : target.kind === 'source' && target.id ? target.id : state.reading.documentId;
    if (!reader.openReference(requested)) showError('This reading location could not be found.');
    reader.enter();
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
    const { card, done, session } = state.practice;
    if (!target.kind && !card && !done && !session?.waiting && !ui.pending && !busy) startPractice(state.practice.mode);
  }
  renderPending();
  displayPendingError();
}
window.addEventListener('hashchange', () => navigate());
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
    reportTimeZone();
    await navigate(true);
    if (ui.pending && !busy) {
      if (hasCommittedTurn(ui.pending)) await runAction(ui.pending);
      else showPendingError('The previous request was interrupted. Retry to recover it.');
    }
  }
}
// Learning days are the learner's local days: the journal keeps the zone this
// browser is in, and a new zone (travel, a moved machine) replaces it.
async function reportTimeZone() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timeZone || state.settings?.timeZone === timeZone) return;
  try {
    await sendAction({ id: crypto.randomUUID(), type: 'timeZone', timeZone });
    state.settings = { ...state.settings, timeZone };
  } catch {
    // The server's zone stands in until a later visit reports this one.
  }
}
function hasCommittedTurn(action) {
  if (action.type === 'chat') return state.chat.some(m => m.id === action.id);
  if (action.type === 'tutor' || action.type === 'capture') return state.tutor.some(m => m.id === action.id);
  if (action.type === 'annotationPost') return state.annotationThreads.some(t => t.messages.some(m => m.id === action.id));
  if (action.type === 'answer') return state.attempts.some(a => a.id === action.id);
  return false;
}
function showPendingError(message) {
  pendingError = message;
  markBusy(false);
  displayPendingError();
}
function displayPendingError() {
  if (!pendingError || !ui.pending) return;
  const surface = document.querySelector('dialog[open]') || document;
  const inline = [...surface.querySelectorAll('[data-turn-retry]')].some(el => el.checkVisibility() && !el.closest('[inert]'));
  const message = inline ? '' : pendingError;
  if (get('error-message').textContent !== message) showError(message);
}
async function sendAction(action) {
  const chat = action.type === 'chat';
  const response = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(chat ? { Accept: 'application/x-ndjson' } : {}) },
    body: JSON.stringify(action),
  });
  if (chat && response.ok && response.headers.get('content-type')?.startsWith('application/x-ndjson'))
    return readChatStream(response, appendChatText);
  return responseJson(response);
}
async function runAction(action) {
  if (busy || !state) return false;
  ++requestRevision;
  const startingHash = location.hash;
  const isImport = action.type === 'importReading' || action.type === 'importPdf';
  const tracksImport = isImport && reader.trackImport(action);
  const currentImport = () => tracksImport && tracksImport() && location.hash === startingHash;
  const isRetry = ui.pending?.id === action.id;
  if (!isRetry && action.type === 'chat' && chatDraft.value.trim() === action.message) {
    chatDraft.value = '';
    if (ui.chatDrafts) delete ui.chatDrafts[action.threadId || state.activeThreadId];
  }
  if (!isRetry && action.type === 'tutor') {
    if (tutorDraft.value.trim() === action.message) {
      tutorDraft.value = '';
      delete ui.tutorDraft;
    }
    if (action.wordReplyTo || action.captureQuestionId) delete ui.tutorReply;
  }
  ui.pending = action;
  pendingError = '';
  // A retry may follow a partially streamed answer.
  if (isRetry && action.type === 'chat') delete get('chat-turn').dataset.action;
  persist();
  markBusy(true);
  showError('');
  try {
    const updated = await sendAction(action);
    const follow = (action.type === 'chat' || action.type === 'tutor') && followsConversation(action.type);
    state = updated;
    if (action.type === 'capture' && state.captureResult?.id !== action.id) {
      throw new Error('The journal did not return a result for this input.');
    }
    if (action.type === 'tutor' && action.wordReplyTo && ui.wordReplies) delete ui.wordReplies[action.wordReplyTo.intakeId];
    if (action.type === 'answer') delete ui.practiceDraft;
    delete ui.pending;
    persist();
    renderState();
    if (follow) followConversation(action.type);
    if (currentImport()) reader.imported();
    if (action.type === 'capture') {
      const result = state.captureResult;
      const atCapture = page === 'home' && location.hash === startingHash && !importDialog.open
        && !get('word-text').value.trim() && !get('word-context').value.trim();
      if (result.kind === 'reading') {
        if (atCapture) {
          importUrl = result.url;
          location.hash = 'home/import';
        } else capture.offerReading(action);
      } else if (atCapture && !tutorDraft.value.trim()) {
        delete ui.tutorContext;
        delete ui.tutorReply;
        renderTutorContext();
        setTutor(true, true, true, get('word-text'));
      }
    }
    return true;
  } catch (err) {
    if (isImport && err.status) {
      delete ui.pending;
      persist();
      if (currentImport()) {
        if (action.type === 'importPdf') reader.pdfMessage(err.message);
        else reader.importError(action.url, err.message, err.preview, err.canPaste, action.pastedText);
      }
      return false;
    }
    if (err.status === 400 || err.status === 409) {
      if (action.type === 'annotationPost' && action.askTutor) annotations.restore(action);
      if (action.type === 'capture') capture.restore(action);
      if (action.type === 'chat' || action.type === 'tutor') {
        // A definitive rejection releases the composer. Preserve any newer draft too.
        const field = action.type === 'chat' ? chatDraft : tutorDraft;
        field.value = [action.message, field.value].filter(Boolean).join('\n');
        field.dispatchEvent(new Event('input'));
      }
      delete ui.pending;
      persist();
      await load();
      showError(err.message);
    } else showPendingError(err.message || 'Could not complete this action.');
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
// Space turns the practice card when the learner is reading the lesson or feedback.
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.repeat || e.isComposing || e.keyCode === 229 || e.defaultPrevented || page !== 'practice' || busy || ui.pending || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (get('active-practice').hidden || e.target.closest?.('#tutor')) return;
  const next = get('practice-body').querySelector('.teaching-next, .practice-next');
  if (!next || e.target.closest?.('input, textarea, select, button, a[href], summary, [contenteditable], dialog')) return;
  e.preventDefault();
  next.click();
  next.focus({ preventScroll: true });
});
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
get('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const message = chatDraft.value.trim();
  if (!message || busy || ui.pending) return;
  chatDraft.focus({ preventScroll: true });
  submit({ type: 'chat', message, threadId: state.activeThreadId, source: thread().source || thread().title });
};
get('reflect').onclick = async () => {
  const latest = threadReflections().at(-1);
  if (latest && latest.end === state.chat.length) {
    showReflection(latest.id);
    return;
  }
  const start = location.hash;
  if (await submit({ type: 'reflect', threadId: state.activeThreadId, source: thread().title })) {
    const reflection = threadReflections().at(-1);
    if (reflection && location.hash === start) {
      const details = get('reflection-' + reflection.id);
      if (details) details.open = true;
      if (document.activeElement === document.body || document.activeElement === get('reflect')) showReflection(reflection.id);
    }
  }
};
get('tutor-form').onsubmit = (e) => {
  e.preventDefault();
  const message = tutorDraft.value.trim();
  if (!message || busy) return;
  tutorDraft.focus({ preventScroll: true });
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
  const reply = activeReply();
  if (reply && !ui.tutorContext) {
    const { label, ...target } = reply;
    submit({ type: 'tutor', message, surface: 'home', source: label, ...target });
    return;
  }
  const context = ui.tutorContext || { surface: page === 'scrapbook' ? 'home' : page, source, referenceId };
  const sourceLabel = context.label || (page === 'chat' ? thread().title : page === 'read' ? reader.title() : undefined);
  submit({ type: 'tutor', message, source: context.source, surface: context.surface, referenceId: context.referenceId, sourceLabel });
};
navigate(true);
load();
