import { passageLookups } from './reader-lookup.js';

const sourceSelector = '[data-annotation-surface][data-annotation-owner][data-annotation-block]';

function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(className, label) {
  const el = element('button', className, label);
  el.type = 'button';
  return el;
}

function blocksOf(surface, ownerId) {
  return [...document.querySelectorAll(sourceSelector)].filter(el =>
    el.dataset.annotationSurface === surface && el.dataset.annotationOwner === ownerId);
}

function sourceAt(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return el?.closest(sourceSelector);
}

function selectedAnchor() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const touched = [...document.querySelectorAll(sourceSelector)].filter(el =>
    el.getClientRects().length && range.intersectsNode(el));
  const first = touched[0], last = touched.at(-1);
  if (!first) return;
  const { annotationSurface: surface, annotationOwner: ownerId } = first.dataset;
  if (touched.some(el => el.dataset.annotationSurface !== surface || el.dataset.annotationOwner !== ownerId)) return;

  // Browsers may place a line selection's endpoint on the paragraph itself.
  function offset(block, node, point) {
    if (node === block.parentElement) {
      const index = [...node.childNodes].indexOf(block);
      return point <= index ? 0 : block.textContent.length;
    }
    if (sourceAt(node) !== block) return;
    const part = document.createRange();
    part.selectNodeContents(block);
    part.setEnd(node, point);
    return part.toString().length;
  }
  const startOffset = offset(first, range.startContainer, range.startOffset);
  const endOffset = offset(last, range.endContainer, range.endOffset);
  if (startOffset === undefined || endOffset === undefined) return;
  const quote = touched.map(el => el.textContent.slice(el === first ? startOffset : 0, el === last ? endOffset : undefined)).join('\n');
  if (!quote.trim()) return;
  return { surface, ownerId, startId: first.dataset.annotationBlock, endId: last.dataset.annotationBlock, startOffset, endOffset, quote };
}

function sourceRanges(anchor) {
  const blocks = blocksOf(anchor.surface, anchor.ownerId);
  const first = blocks.findIndex(el => el.dataset.annotationBlock === anchor.startId);
  const last = blocks.findIndex(el => el.dataset.annotationBlock === anchor.endId);
  if (first < 0 || last < first) return [];
  const ranges = [];
  for (let i = first; i <= last; i++) {
    const node = blocks[i].firstChild;
    if (node?.nodeType !== Node.TEXT_NODE) return [];
    const start = i === first ? anchor.startOffset : 0;
    const end = i === last ? anchor.endOffset : node.length;
    if (start < 0 || end < start || end > node.length) return [];
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    ranges.push(range);
  }
  return ranges;
}

function anchorKey(anchor) {
  return JSON.stringify([anchor.surface, anchor.ownerId, anchor.startId, anchor.startOffset, anchor.endId, anchor.endOffset]);
}

function savedPassage(thread) {
  return thread?.capturedAt && !thread.messages.some(message => message.role === 'assistant');
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(value, hi));
}

export function createAnnotations({ submit, getState, canSubmit, getPending, retryPending, lookupPassage, flagLookup }) {
  const toolbar = element('div', 'an-quote-action');
  toolbar.hidden = true;
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Passage actions');
  const dictionary = element('div', 'an-dictionary');
  const termLine = element('div', 'an-term-line');
  const spelling = element('span', 'an-term');
  spelling.lang = 'zh';
  const pronunciation = element('span', 'an-pronunciation');
  const gloss = element('p', 'an-gloss');
  gloss.id = 'reader-gloss';
  gloss.setAttribute('aria-live', 'polite');
  const chunks = element('p', 'an-chunks');
  chunks.lang = 'zh';
  const check = button('an-lookup-action', 'Check in context');
  const flag = button('an-lookup-action', 'Mark as wrong');
  const feedbackError = element('span', 'an-feedback-error');
  feedbackError.setAttribute('role', 'status');
  const closeLookup = button('an-close-lookup', '×');
  closeLookup.setAttribute('aria-label', 'Close lookup');
  closeLookup.setAttribute('aria-keyshortcuts', 'Escape');
  closeLookup.title = 'Close lookup (Esc)';
  termLine.append(spelling, pronunciation, closeLookup);
  dictionary.append(termLine, gloss, chunks, check, flag, feedbackError);
  const quickActions = element('div', 'an-quick-actions');
  const capture = button('an-capture', 'Save');
  const compose = button('an-compose', 'Ask');
  const withNote = button('an-with-note', 'Add note');
  const inspect = button('an-inspect', 'Look up');
  quickActions.append(capture, withNote, compose, inspect);
  toolbar.append(dictionary, quickActions);
  const confirmation = element('span', 'an-confirmation');
  confirmation.setAttribute('role', 'status');
  const panel = element('section', 'an-panel');
  panel.hidden = true;
  panel.id = 'annotation-panel';
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Margin note');
  const head = element('div', 'an-head');
  const quote = element('blockquote', 'an-quote');
  const dismiss = button('an-close', '×');
  dismiss.setAttribute('aria-label', 'Close margin note');
  head.append(quote, dismiss);
  const chooser = element('select', 'an-chooser');
  chooser.setAttribute('aria-label', 'Notes on this passage');
  const messages = element('div', 'an-messages');
  messages.setAttribute('role', 'log');
  messages.setAttribute('aria-label', 'Margin discussion');
  const progress = element('div', 'an-progress');
  const progressText = element('span', 'an-progress-text');
  progressText.setAttribute('role', 'status');
  const retry = button('an-retry', 'Retry');
  retry.dataset.turnRetry = '';
  retry.onclick = () => retryPending();
  progress.append(progressText, retry);
  const form = element('form', 'an-form');
  const input = element('textarea', 'an-input');
  input.rows = 2;
  input.maxLength = 1600;
  const actions = element('div', 'an-actions');
  const save = button('an-save', 'Save note');
  const ask = button('an-ask', 'Ask tutor');
  save.type = ask.type = 'submit';
  actions.append(save, ask);
  form.append(input, actions);
  const savedActions = element('div', 'an-actions');
  const appendNote = button('an-ask', 'Add note');
  const discuss = button('an-ask', 'Ask');
  savedActions.append(appendNote, discuss);
  panel.append(head, chooser, messages, progress, savedActions, form);
  document.body.append(toolbar, panel, confirmation);

  const savedThreads = () => getState()?.annotationThreads || [];
  function pendingAsk() {
    const { action } = getPending();
    return action?.type === 'annotationPost' && action.askTutor ? action : undefined;
  }
  // A first question gets a margin marker immediately. The journal uses its
  // action ID as the permanent thread ID, so reopening works through completion.
  function sources() {
    const threads = savedThreads();
    const action = pendingAsk();
    if (!action?.anchor || threads.some(thread => thread.id === action.id)) return threads;
    return [...threads, { id: action.id, anchor: action.anchor, messages: [] }];
  }
  const draftKey = 'mandarin-journal.annotation-drafts.v1';
  let drafts;
  try { drafts = new Map(JSON.parse(sessionStorage.getItem(draftKey) || '[]')); }
  catch { drafts = new Map(); }
  function setDraft(key, value) {
    if (value) drafts.set(key, value);
    else drafts.delete(key);
    try { sessionStorage.setItem(draftKey, JSON.stringify([...drafts])); }
    catch { /* In-memory drafts remain available. */ }
  }
  let current, candidate, lookup, lookupTrigger, inFlight, hoverTimer, frame, confirmationTimer;
  const controls = new Map();
  const keyFor = view => (view.mode === 'capture' ? 'capture:' : '') + (view.id || anchorKey(view.anchor));
  const groupFor = (anchor) => sources().filter(t =>
    t.anchor.surface === anchor.surface && t.anchor.ownerId === anchor.ownerId && t.anchor.startId === anchor.startId);
  const startBlock = (anchor) => blocksOf(anchor.surface, anchor.ownerId).find(el => el.dataset.annotationBlock === anchor.startId);

  const threadAt = anchor => sources().find(thread => anchorKey(thread.anchor) === anchorKey(anchor));

  function updateCapture() {
    const saved = candidate && threadAt(candidate)?.capturedAt;
    capture.textContent = saved ? 'Saved' : 'Save';
    withNote.textContent = saved ? 'Add note' : 'Save with note';
    capture.disabled = Boolean(saved) || !canSubmit();
  }

  function updateButtons() {
    const disabled = !input.value.trim() || !!inFlight || !canSubmit();
    save.disabled = ask.disabled = disabled;
    input.readOnly = Boolean(inFlight && current && inFlight === keyFor(current));
    form.setAttribute('aria-busy', String(input.readOnly));
  }

  function paintLookup() {
    if (!window.CSS?.highlights || !window.Highlight) return;
    CSS.highlights.set('journal-lookup', new Highlight(...(lookup && candidate ? sourceRanges(candidate) : [])));
  }

  let rangesByBlock = new WeakMap();
  function paint() {
    rangesByBlock = new WeakMap();
    const notes = [];
    const saves = [];
    for (const thread of sources()) {
      for (const range of sourceRanges(thread.anchor)) {
        const block = range.startContainer.parentElement;
        if (!rangesByBlock.has(block)) rangesByBlock.set(block, []);
        rangesByBlock.get(block).push({range, thread});
        (savedPassage(thread) ? saves : notes).push(range);
      }
    }
    if (!window.CSS?.highlights || !window.Highlight) return;
    CSS.highlights.set('journal-note', new Highlight(...notes));
    CSS.highlights.set('journal-saved', new Highlight(...saves));
    CSS.highlights.set('journal-open-note', new Highlight(...(current ? sourceRanges(current.anchor) : [])));
  }

  function clearCandidate() {
    toolbar.hidden = true;
    candidate = undefined;
    lookupTrigger = undefined;
    if (lookup) {
      lookup = undefined;
      paintLookup();
    }
  }

  function close(restore = false) {
    clearTimeout(hoverTimer);
    const returnTo = lookupTrigger;
    clearCandidate();
    if (restore) returnTo?.focus({ preventScroll: true });
    confirmation.textContent = '';
    const active = current;
    current = undefined;
    panel.hidden = true;
    for (const { marker } of controls.values()) marker.setAttribute('aria-expanded', 'false');
    if (active) {
      paint();
      if (restore) {
        const fallback = controls.get(startBlock(active.anchor));
        const target = active.trigger?.isConnected && active.trigger !== toolbar ? active.trigger : active.id ? fallback?.marker : fallback?.shortcut;
        target?.focus({ preventScroll: true });
      }
    }
  }

  function dismissPopover() {
    if (candidate) window.getSelection()?.removeAllRanges();
    close(true);
  }
  closeLookup.onclick = dismissPopover;

  function position() {
    const view = window.visualViewport;
    const source = candidate || current?.anchor;
    const reader = source?.surface === 'read' && startBlock(source)?.closest('.reader-scroll')?.getBoundingClientRect();
    const viewportLeft = view?.offsetLeft || 0;
    const viewportTop = view?.offsetTop || 0;
    const left = Math.max(viewportLeft, reader ? reader.left : viewportLeft) + 8;
    const top = Math.max(viewportTop, reader ? reader.top : viewportTop) + 8;
    const right = Math.min(viewportLeft + (view?.width || innerWidth), reader ? reader.right : Infinity) - 8;
    const bottom = Math.min(viewportTop + (view?.height || innerHeight), reader ? reader.bottom : Infinity) - 8;
    if (candidate) {
      const rect = sourceRanges(candidate).flatMap(range => [...range.getClientRects()]).find(r => r.bottom >= top && r.top <= bottom);
      if (!rect) { clearCandidate(); return; }
      toolbar.hidden = false;
      toolbar.style.maxHeight = Math.max(0, bottom - top) + 'px';
      toolbar.style.left = clamp(rect.left, left, right - toolbar.offsetWidth) + 'px';
      toolbar.style.top = clamp(rect.top - toolbar.offsetHeight - 5 >= top ? rect.top - toolbar.offsetHeight - 5 : rect.bottom + 5, top, bottom - toolbar.offsetHeight) + 'px';
    }
    if (panel.hidden || !current) return;
    const block = startBlock(current.anchor);
    if (!block?.getClientRects().length) { close(); return; }
    const row = block.parentElement.getBoundingClientRect();
    const marker = current.id && controls.get(block)?.marker;
    const rect = marker && !marker.hidden ? marker.getBoundingClientRect()
      : sourceRanges(current.anchor)[0]?.getClientRects()[0] || block.getBoundingClientRect();
    panel.style.width = Math.min(352, right - left) + 'px';
    panel.style.maxHeight = bottom - top + 'px';
    const width = panel.offsetWidth, height = panel.offsetHeight;
    // A docked tutor may occupy the otherwise empty margin beside the source.
    const tutor = document.querySelector('.layout.with-tutor #tutor')?.getBoundingClientRect();
    const freeRight = tutor && tutor.left >= row.right && tutor.top < bottom && tutor.bottom > top
      ? Math.min(right, tutor.left - 6) : right;
    let x = marker && rect.left >= row.right ? rect.right - width : rect.left;
    let y = rect.bottom + 7;
    const afterRow = Math.max(row.right, rect.right) + 5;
    const beforeRow = Math.min(row.left, rect.left) - 5 - width;
    if (afterRow + width <= freeRight) { x = afterRow; y = rect.top - 4; }
    else if (beforeRow >= left) { x = beforeRow; y = rect.top - 4; }
    else if (y + height > bottom && rect.top - 9 - height >= top) y = rect.top - 9 - height;
    panel.style.left = clamp(x, left, freeRight - width) + 'px';
    panel.style.top = clamp(y, top, bottom - height) + 'px';
  }

  function schedulePosition() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = undefined; position(); });
  }

  function displayThread() {
    const action = pendingAsk();
    if (!current.id && action?.anchor && anchorKey(action.anchor) === anchorKey(current.anchor)) {
      current.id = action.id;
    }
    const thread = sources().find(t => t.id === current.id);
    const waiting = action && current.id === (action.annotationId || action.id)
      && !thread?.messages.some(m => m.id === action.id);
    const { busy, error } = getPending();
    quote.textContent = current.anchor.quote;
    const group = thread ? groupFor(thread.anchor) : [];
    chooser.hidden = group.length < 2;
    if (!chooser.hidden) {
      chooser.replaceChildren();
      if (group.some(savedPassage)) {
        for (const [label, items] of [
          ['Saved passages', group.filter(savedPassage)],
          ['Margin notes', group.filter(t => !savedPassage(t))],
        ]) {
          if (!items.length) continue;
          const section = document.createElement('optgroup');
          section.label = label;
          section.append(...items.map(t => new Option(t.anchor.quote, t.id)));
          chooser.append(section);
        }
      } else {
        chooser.append(...group.map((t, index) => new Option((index + 1) + ' · ' + t.anchor.quote, t.id)));
      }
      chooser.value = current.id;
    }
    const turns = thread?.messages || [];
    const entries = waiting ? [...turns, { role: 'user', text: action.message }] : turns;
    const threadKey = current.id || anchorKey(current.anchor);
    const atEnd = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 24;
    const changedThread = messages.dataset.thread !== threadKey;
    if (changedThread) {
      messages.replaceChildren();
      messages.dataset.thread = threadKey;
    }
    // Preserve the echoed question when it becomes a saved message. Only the
    // tutor's new reply should be announced on completion.
    entries.forEach((m, index) => {
      const stamp = JSON.stringify([m.role, m.text]);
      const previous = messages.children[index];
      if (previous?.dataset.entry === stamp) return;
      const row = element('div', 'an-entry');
      row.dataset.entry = stamp;
      row.append(element('span', 'an-author', m.role === 'assistant' ? 'Tutor' : 'You'), element('p', 'an-text', m.text));
      if (previous) previous.replaceWith(row);
      else messages.append(row);
    });
    while (messages.children.length > entries.length) messages.lastElementChild.remove();
    messages.hidden = !entries.length;
    if (changedThread || atEnd) messages.scrollTop = messages.scrollHeight;
    progress.hidden = !waiting;
    const status = waiting ? (busy ? 'Tutor is replying…' : error || 'Reply interrupted.') : '';
    if (progressText.textContent !== status) progressText.textContent = status;
    retry.hidden = !waiting || busy;
    const capturing = current.mode === 'capture';
    const compact = current.mode === 'inspect' && !waiting && savedPassage(thread);
    form.hidden = Boolean(compact);
    savedActions.hidden = !compact;
    ask.hidden = capturing;
    panel.classList.toggle('an-saved-passage', Boolean(compact));
    panel.setAttribute('aria-label', compact ? 'Saved passage' : capturing ? 'Save with a note' : 'Margin note');
    input.placeholder = capturing ? 'Add a note…' : current.mode === 'ask' ? 'Ask about this passage…'
      : thread ? 'Reply in the margin…' : 'Add a note or ask your tutor…';
    input.setAttribute('aria-label', capturing ? 'Note for this save' : thread ? 'Reply to this note' : 'Note about the quoted text');
    save.textContent = capturing ? 'Save note' : thread ? 'Reply' : 'Save note';
    updateButtons();
  }

  function show(anchor, id, trigger, mode = 'edit') {
    const block = startBlock(anchor);
    if (!block?.getClientRects().length) return false;
    clearTimeout(hoverTimer);
    clearCandidate();
    current = { anchor, id, trigger, preview: mode === 'hover', mode };
    form.classList.toggle('an-asking', mode === 'ask');
    input.value = drafts.get(keyFor(current)) || '';
    panel.hidden = false;
    displayThread();
    for (const [el, { marker }] of controls) marker.setAttribute('aria-expanded', String(Boolean(id && el === block)));
    paint();
    position();
    if (mode === 'edit' || mode === 'ask' || mode === 'capture') input.focus({ preventScroll: true });
    if (mode === 'inspect') panel.focus({ preventScroll: true });
    return true;
  }

  function open(id) {
    const thread = sources().find(t => t.id === id);
    const block = thread && startBlock(thread.anchor);
    if (!block?.getClientRects().length) return false;
    block.scrollIntoView({ block: 'nearest' });
    return show(thread.anchor, id, controls.get(block)?.marker, 'inspect');
  }

  function openBlock(surface, ownerId, blockId) {
    const block = blocksOf(surface, ownerId).find(el => el.dataset.annotationBlock === blockId);
    if (!block) return false;
    const quote = block.textContent;
    if (!quote.trim()) return false;
    return show({ surface, ownerId, startId: blockId, endId: blockId, startOffset: 0, endOffset: quote.length, quote },
      undefined, document.activeElement);
  }

  function updateLookupActions() {
    const quickAnswer = lookup?.answer && lookup.route !== 'context';
    check.hidden = !quickAnswer;
    check.disabled = !lookup?.canCheckContext;
    check.setAttribute('aria-disabled', String(check.disabled || Boolean(lookup?.checkingFrom)));
    check.textContent = lookup?.checkingFrom ? 'Checking…'
      : check.disabled ? 'Check in context (unavailable)' : 'Check in context';
    flag.hidden = !lookup?.answer || lookup.route !== 'context';
    flag.disabled = Boolean(lookup?.flagged || lookup?.flagPending);
    flag.textContent = lookup?.flagged ? 'Marked as wrong' : 'Mark as wrong';
    feedbackError.textContent = lookup?.feedbackError || '';
  }

  flag.onclick = async () => {
    const entry = lookup;
    if (!entry?.id || flag.hidden || flag.disabled) return;
    entry.flagPending = true;
    entry.feedbackError = '';
    updateLookupActions();
    try {
      await flagLookup(entry.id);
      entry.flagged = true;
    } catch {
      entry.feedbackError = 'Couldn’t record feedback. Try again.';
    } finally {
      entry.flagPending = false;
      if (lookup === entry) { updateLookupActions(); position(); }
    }
  };

  function offer(anchor, entry, trigger) {
    const previousFocus = toolbar.contains(document.activeElement) ? document.activeElement : null;
    candidate = anchor;
    lookup = entry;
    lookupTrigger = trigger;
    const reading = anchor.surface === 'read';
    toolbar.removeAttribute('aria-describedby');
    dictionary.hidden = !entry;
    capture.hidden = withNote.hidden = !reading;
    const retry = entry?.error || entry?.route === 'unavailable';
    inspect.hidden = !reading || Boolean(entry && !retry);
    inspect.textContent = retry ? 'Retry lookup' : 'Look up';
    compose.textContent = reading ? 'Ask' : 'Quote';
    toolbar.classList.toggle('has-gloss', Boolean(entry));
    if (entry) {
      spelling.replaceChildren();
      const chars = [...anchor.quote];
      if (anchor.startId === anchor.endId && entry.answer && chars.length > 1 && chars.length <= 8) {
        let start = anchor.startOffset;
        for (const glyph of chars) {
          const piece = { ...anchor, startOffset: start, endOffset: start + glyph.length, quote: glyph };
          if (/\p{Script=Han}/u.test(glyph)) {
            const narrow = button('an-character', glyph);
            narrow.setAttribute('aria-label', 'Look up ' + glyph);
            narrow.onclick = () => startLookup(piece, 'selection', trigger, entry.checkingFrom || entry);
            spelling.append(narrow);
          } else spelling.append(glyph);
          start = piece.endOffset;
        }
      } else spelling.textContent = anchor.quote;
      if (entry.whole) {
        const whole = entry.whole;
        const widen = button('an-whole', '↩ ' + whole.anchor.quote);
        widen.setAttribute('aria-label', 'Back to ' + whole.anchor.quote);
        widen.onclick = () => {
          offer(whole.anchor, whole, trigger);
          spelling.querySelector('button')?.focus({ preventScroll: true });
        };
        spelling.append(widen);
      }
      pronunciation.textContent = entry.answer?.pinyin || '';
      gloss.textContent = entry.answer?.gloss || entry.error || (entry.pending ? 'Looking up…' : 'No gloss available.');
      chunks.textContent = entry.answer?.chunks?.join(' / ') || '';
      chunks.hidden = !chunks.textContent;
      toolbar.setAttribute('aria-describedby', gloss.id);
    }
    updateLookupActions();
    updateCapture();
    toolbar.hidden = false;
    paintLookup();
    position();
    if (previousFocus && (!previousFocus.isConnected || previousFocus.hidden)) {
      (spelling.querySelector('.an-whole') || (capture.disabled ? compose : capture)).focus({ preventScroll: true });
    }
  }

  // The displayed quote can expand after a tap. Keep its original gesture for retries.
  function startLookup(original, kind, trigger, whole) {
    requestLookup({ anchor: original, original, kind, whole, pending: true }, trigger, {
      documentId: original.ownerId, blockId: original.startId,
      ...(original.startId !== original.endId ? { endBlockId: original.endId } : {}),
      kind, start: original.startOffset, end: original.endOffset,
    });
  }

  check.onclick = () => {
    if (check.hidden || check.disabled || lookup.checkingFrom) return;
    requestLookup({ ...lookup, checkingFrom: lookup, feedbackError: '' }, lookupTrigger,
      { previousDecisionId: lookup.id });
  };

  async function requestLookup(entry, trigger, request) {
    const block = startBlock(entry.original);
    if (!block) return;
    offer(entry.anchor, entry, trigger);
    try {
      const result = await lookupPassage(request);
      if (lookup !== entry || !block.isConnected) return;
      if (entry.kind === 'tap') {
        const quote = block.textContent.slice(result.start, result.end);
        entry.anchor = { ...entry.original, startOffset: result.start, endOffset: result.end, quote };
      }
      entry.id = result.id;
      entry.route = result.route;
      entry.canCheckContext = result.canCheckContext;
      entry.answer = result.answer;
    } catch {
      if (lookup !== entry || !block.isConnected) return;
      if (entry.checkingFrom) entry.feedbackError = 'Couldn’t check this passage. Try again.';
      else entry.error = 'Couldn’t look up this passage.';
    }
    entry.pending = false;
    entry.checkingFrom = undefined;
    offer(entry.anchor, entry, trigger);
  }

  inspect.onclick = () => {
    if (!candidate) return;
    startLookup(lookup?.original || candidate, lookup?.kind || 'selection',
      lookupTrigger || startBlock(candidate)?.parentElement, lookup?.whole);
    if (document.activeElement === inspect || document.activeElement === document.body) {
      (capture.disabled ? compose : capture).focus({ preventScroll: true });
    }
  };

  // pointerdown dismisses the old box before click resolves the tapped glyph.
  let dismissedRange;
  function pointAt(block, event) {
    const previous = dismissedRange;
    dismissedRange = undefined;
    if (event.button !== 0 || !window.getSelection()?.isCollapsed) return;
    // A caret is a boundary. Check the glyph on both sides so either half of a
    // character points at that character, including at a wrapped line ending.
    const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = !caret && document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = caret?.offsetNode || range?.startContainer;
    if (!node || node !== block.firstChild || node.nodeType !== Node.TEXT_NODE) return;
    const offset = caret?.offset ?? range.startOffset;
    for (let startOffset of [offset, offset - 1]) {
      if (startOffset < 0 || startOffset >= node.length) continue;
      if (/[\uDC00-\uDFFF]/u.test(node.data[startOffset])) startOffset--;
      const quote = String.fromCodePoint(node.data.codePointAt(startOffset));
      if (!/\p{Script=Han}/u.test(quote)) continue;
      const hit = document.createRange();
      hit.setStart(node, startOffset);
      hit.setEnd(node, startOffset + quote.length);
      const within = [...hit.getClientRects()].some(r => event.clientX >= r.left && event.clientX <= r.right &&
        event.clientY >= r.top && event.clientY <= r.bottom);
      if (!within) continue;
      if (previous?.startContainer === node && startOffset >= previous.startOffset && startOffset < previous.endOffset) return;
      const { annotationOwner: ownerId, annotationBlock: blockId } = block.dataset;
      const anchor = { surface: 'read', ownerId, startId: blockId, endId: blockId,
        startOffset, endOffset: startOffset + quote.length, quote };
      startLookup(anchor, 'tap', block.parentElement);
      return;
    }
  }

  function releasePreview() {
    clearTimeout(hoverTimer);
    if (current?.preview) hoverTimer = setTimeout(() => { if (current?.preview) close(); }, 260);
  }

  function attach(block) {
    const rail = element('span', 'an-rail');
    block.parentElement.classList.add('an-host');
    const { annotationSurface: surface, annotationOwner: owner, annotationBlock: id } = block.dataset;
    const shortcut = button('an-shortcut', 'Quote ' + (surface === 'read' ? 'paragraph' : 'message'));
    shortcut.onclick = () => openBlock(surface, owner, id);
    const marker = button('an-marker');
    marker.hidden = true;
    marker.setAttribute('aria-haspopup', 'dialog');
    marker.setAttribute('aria-controls', panel.id);
    marker.setAttribute('aria-expanded', 'false');
    const icon = element('span', 'an-glyph');
    icon.setAttribute('aria-hidden', 'true');
    const count = element('span', 'an-count');
    count.setAttribute('aria-hidden', 'true');
    marker.append(icon, count);
    function showGroup(mode) {
      const group = groupFor({ surface, ownerId: owner, startId: id });
      const thread = group.find(t => t.id === current?.id) || group[0];
      if (thread) show(thread.anchor, thread.id, marker, mode);
    }
    marker.onclick = () => {
      if (current?.trigger === marker && !current.preview) { close(true); return; }
      showGroup('inspect');
    };
    if (surface === 'read') {
      const entries = passageLookups(owner, id, block.textContent);
      block.onclick = event => pointAt(block, event);
      const text = block.textContent;
      const glyphs = [...text.matchAll(/\p{Script=Han}/gu)];
      const first = glyphs[0];
      if (first) {
        // On imported passages the same keyboard control can reach every Han character.
        const targets = entries.length ? entries.map(e => e.anchor) : [{ startOffset: first.index, quote: first[0] }];
        for (const target of targets) {
          const key = button('an-shortcut', 'Look up ' + target.quote);
          key.setAttribute('aria-description', 'Use the left and right arrows to choose a character.');
          key.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight');
          let index = glyphs.findIndex(hit => hit.index === target.startOffset);
          key.onkeydown = event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            index = clamp(index + (event.key === 'ArrowRight' ? 1 : -1), 0, glyphs.length - 1);
            key.textContent = 'Look up ' + glyphs[index][0];
            if (window.CSS?.highlights && window.Highlight) {
              const range = new Range();
              range.setStart(block.firstChild, glyphs[index].index);
              range.setEnd(block.firstChild, glyphs[index].index + glyphs[index][0].length);
              CSS.highlights.set('journal-lookup-cursor', new Highlight(range));
            }
          };
          key.onblur = () => window.CSS?.highlights?.delete('journal-lookup-cursor');
          key.onclick = () => {
            close();
            const { index: startOffset, 0: quote } = glyphs[index];
            startLookup({ surface, ownerId: owner, startId: id, endId: id, startOffset,
              endOffset: startOffset + quote.length, quote }, 'tap', key);
            (capture.disabled ? compose : capture).focus({ preventScroll: true });
          };
          rail.append(key);
        }
      }
    }
    marker.onpointerenter = e => {
      clearTimeout(hoverTimer);
      if (surface !== 'read' && e.pointerType === 'mouse' && (!current || current.preview))
        hoverTimer = setTimeout(() => showGroup('hover'), 160);
    };
    marker.onpointerleave = releasePreview;
    rail.append(shortcut, marker);
    block.after(rail);
    return { rail, marker, shortcut, count };
  }

  function render() {
    for (const [block, { rail }] of controls) {
      if (!block.isConnected || rail.previousElementSibling !== block) { rail.remove(); controls.delete(block); }
    }
    for (const block of document.querySelectorAll(sourceSelector)) {
      if (!controls.has(block)) controls.set(block, attach(block));
      const { marker, count } = controls.get(block);
      const group = groupFor({ surface: block.dataset.annotationSurface, ownerId: block.dataset.annotationOwner, startId: block.dataset.annotationBlock });
      marker.hidden = !group.length;
      count.textContent = group.length > 1 ? String(group.length) : '';
      if (group.length) {
        const onlySaved = group.every(savedPassage);
        marker.classList.toggle('an-bookmark', onlySaved);
        const label = onlySaved ? 'saved passage' : 'note';
        marker.setAttribute('aria-label', group.length === 1 ? 'Open ' + label + ' on “' + group[0].anchor.quote + '”' :
          'Open ' + group.length + (onlySaved ? ' saved passages' : ' margin items'));
        marker.setAttribute('aria-expanded', String(Boolean(current?.id && group.some(t => t.id === current.id))));
      }
    }
    if (current) {
      if (!startBlock(current.anchor)?.getClientRects().length) close();
      else displayThread();
    }
    updateCapture();
    paint();
    schedulePosition();
  }

  toolbar.onpointerdown = e => e.preventDefault();
  function openCandidate(mode) {
    if (!candidate) return;
    const anchor = candidate;
    const trigger = lookupTrigger || controls.get(startBlock(anchor))?.shortcut;
    const thread = anchor.surface === 'read' && threadAt(anchor);
    window.getSelection()?.removeAllRanges();
    show(anchor, thread?.id, trigger, anchor.surface === 'read' ? mode : 'edit');
  }
  compose.onclick = () => openCandidate('ask');
  withNote.onclick = () => openCandidate('capture');
  appendNote.onclick = () => show(current.anchor, current.id, current.trigger, 'capture');
  discuss.onclick = () => show(current.anchor, current.id, current.trigger, 'ask');
  capture.onclick = async () => {
    if (!candidate || capture.disabled) return;
    const anchor = candidate;
    const activeLookup = lookup;
    const target = lookupTrigger || startBlock(anchor)?.parentElement;
    const rect = toolbar.getBoundingClientRect();
    const keyboard = toolbar.contains(document.activeElement);
    if (!await submit({ type: 'captureReading', anchor })) return;
    if (!candidate || lookup !== activeLookup || anchorKey(candidate) !== anchorKey(anchor)) return;
    window.getSelection()?.removeAllRanges();
    clearCandidate();
    if (keyboard) target?.focus({ preventScroll: true });
    clearTimeout(confirmationTimer);
    confirmation.style.left = rect.left + 'px';
    confirmation.style.top = rect.top + 'px';
    confirmation.textContent = 'Saved';
    confirmationTimer = setTimeout(() => { confirmation.textContent = ''; }, 1100);
  };
  dismiss.onclick = () => close(true);
  panel.onpointerenter = () => clearTimeout(hoverTimer);
  panel.onpointerleave = releasePreview;
  panel.onpointerdown = panel.onfocusin = () => { if (current) current.preview = false; };
  chooser.onchange = () => open(chooser.value);
  input.oninput = () => { if (current) setDraft(keyFor(current), input.value); updateButtons(); };
  input.onkeydown = e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && !save.disabled) {
      e.preventDefault();
      form.requestSubmit(current?.mode === 'ask' ? ask : save);
    }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    if (!current || !input.value.trim() || inFlight || !canSubmit()) return;
    const view = current;
    const key = keyFor(view);
    const askTutor = e.submitter === ask;
    const source = view.id ? { annotationId: view.id } : { anchor: view.anchor };
    const message = input.value.trim();
    const action = view.mode === 'capture' ? { type: 'captureReading', anchor: view.anchor, note: message }
      : { type: 'annotationPost', ...source, message, askTutor };
    if (askTutor) {
      // The pending action owns this question. A follow-up draft belongs to
      // the new thread ID, which is also used by its margin marker.
      input.value = '';
      setDraft(key, '');
      input.focus({ preventScroll: true });
      const request = submit(action);
      const threadId = view.id;
      if (!await request && !pendingAsk()) {
        const id = savedThreads().some(t => t.id === threadId) ? threadId : undefined;
        const restoredKey = keyFor({ ...view, id });
        const draft = drafts.get(threadId) || drafts.get(restoredKey) || message;
        if (threadId && restoredKey !== threadId) setDraft(threadId, '');
        setDraft(restoredKey, draft);
        if (current && current.id === threadId && anchorKey(current.anchor) === anchorKey(view.anchor)) {
          current.id = id;
          input.value = draft;
          render();
        }
      }
      return;
    }
    const existing = new Set(sources().map(t => t.id));
    inFlight = key;
    updateButtons();
    try {
      if (!await submit(action)) return;
      setDraft(key, '');
      if (current !== view) return;
      const id = view.id || sources().find(t => !existing.has(t.id) && anchorKey(t.anchor) === anchorKey(view.anchor))?.id;
      if (id) view.id = id;
      view.trigger = controls.get(startBlock(view.anchor))?.marker;
      close(true);
    } finally { inFlight = undefined; updateButtons(); }
  };

  // Hover the actual quoted words as well as the margin marker; a drag remains a native selection.
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || event.buttons || (current && !current.preview) || candidate) return;
    if (panel.contains(event.target) || event.target.closest('.an-rail')) return;
    const block = sourceAt(event.target);
    if (block?.dataset.annotationSurface === 'read') return;
    const hits = rangesByBlock.get(block) || [];
    const hit = hits.find(({range}) => [...range.getClientRects()].some(rect =>
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
    if (!hit) { releasePreview(); return; }
    clearTimeout(hoverTimer);
    if (current?.id !== hit.thread.id) hoverTimer = setTimeout(() =>
      show(hit.thread.anchor, hit.thread.id, controls.get(startBlock(hit.thread.anchor))?.marker, 'hover'), 220);
  });

  document.addEventListener('selectionchange', () => {
    if (toolbar.contains(document.activeElement)) return;
    const next = selectedAnchor();
    if (next && candidate && anchorKey(next) === anchorKey(candidate)) return;
    if (!next) { if (!lookup) clearCandidate(); return; }
    if (current) close();
    offer(next);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (current || candidate)) {
      e.preventDefault();
      dismissPopover();
    } else if (candidate && !toolbar.hidden && e.key === 'Tab' && !e.shiftKey && !toolbar.contains(document.activeElement)) {
      e.preventDefault();
      ((lookup && spelling.querySelector('button')) || (capture.hidden || capture.disabled ? compose : capture)).focus({ preventScroll: true });
    }
  });
  document.addEventListener('pointerdown', e => {
    dismissedRange = undefined;
    if (panel.contains(e.target) || e.target.closest('.an-rail') || toolbar.contains(e.target)) return;
    const block = sourceAt(e.target);
    if (lookup && block && e.isPrimary && e.button === 0) {
      dismissedRange = sourceRanges(lookup.anchor).find(range => range.startContainer.parentElement === block);
    }
    close();
  });
  document.addEventListener('focusin', e => {
    if (candidate && toolbar.contains(e.relatedTarget) && !toolbar.contains(e.target) && e.target !== lookupTrigger) {
      clearCandidate();
    }
    if (current && !current.preview && !panel.contains(e.target) && !e.target.closest('.an-rail')) close();
  });
  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, true);
  window.visualViewport?.addEventListener('resize', schedulePosition);
  window.visualViewport?.addEventListener('scroll', schedulePosition);
  return { render, close, open };
}
