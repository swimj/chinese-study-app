import { passageLookups, characterLookup } from './reader-lookup.js';

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

export function createAnnotations({ submit, getState, canSubmit }) {
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
  termLine.append(spelling, pronunciation);
  dictionary.append(termLine, gloss);
  const quickActions = element('div', 'an-quick-actions');
  const capture = button('an-capture', 'Save');
  const compose = button('an-compose', 'Ask');
  const withNote = button('an-with-note', 'Add note');
  quickActions.append(capture, withNote, compose);
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
  panel.append(head, chooser, messages, savedActions, form);
  document.body.append(toolbar, panel, confirmation);

  const sources = () => getState()?.annotationThreads || [];
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
    const thread = sources().find(t => t.id === current.id);
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
    const stamp = JSON.stringify(thread?.messages || []);
    if (messages.dataset.stamp !== stamp) {
      messages.dataset.stamp = stamp;
      messages.replaceChildren(...(thread?.messages || []).map(m => {
        const row = element('div', 'an-entry');
        row.append(element('span', 'an-author', m.role === 'assistant' ? 'Tutor' : 'You'), element('p', 'an-text', m.text));
        return row;
      }));
      messages.scrollTop = messages.scrollHeight;
    }
    messages.hidden = !thread?.messages.length;
    const capturing = current.mode === 'capture';
    const compact = current.mode === 'inspect' && savedPassage(thread);
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

  function offer(anchor, entry, whole, trigger) {
    candidate = anchor;
    lookup = entry;
    lookupTrigger = trigger;
    const reading = anchor.surface === 'read';
    toolbar.removeAttribute('aria-describedby');
    dictionary.hidden = !entry;
    capture.hidden = withNote.hidden = !reading;
    compose.textContent = reading ? 'Ask' : 'Quote';
    toolbar.classList.toggle('has-gloss', Boolean(entry?.gloss));
    if (entry) {
      spelling.replaceChildren();
      if (entry.gloss) toolbar.setAttribute('aria-describedby', gloss.id);
      let offset = 0;
      for (const glyph of entry.anchor.quote) {
        const piece = characterLookup(entry, offset);
        if (piece) {
          const narrow = button('an-character', glyph);
          narrow.setAttribute('aria-label', 'Look up ' + glyph);
          narrow.onclick = () => {
            offer(piece.anchor, piece, entry, trigger);
            spelling.querySelector('button')?.focus({ preventScroll: true });
          };
          spelling.append(narrow);
        } else spelling.append(glyph);
        offset += glyph.length;
      }
      if (whole) {
        const widen = button('an-whole', '↩ ' + whole.anchor.quote);
        widen.setAttribute('aria-label', 'Back to ' + whole.anchor.quote);
        widen.onclick = () => {
          offer(whole.anchor, whole, undefined, trigger);
          spelling.querySelector('button')?.focus({ preventScroll: true });
        };
        spelling.append(widen);
      }
      pronunciation.textContent = entry.pinyin || '';
      gloss.textContent = entry.gloss || '';
      gloss.hidden = !entry.gloss;
    }
    updateCapture();
    toolbar.hidden = false;
    paintLookup();
    position();
  }

  function pointAt(block, event, entries) {
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
      const entry = entries.find(({ anchor }) => anchor.startOffset <= startOffset && anchor.endOffset > startOffset);
      const { annotationOwner: ownerId, annotationBlock: blockId } = block.dataset;
      const anchor = entry?.anchor || { surface: 'read', ownerId, startId: blockId, endId: blockId,
        startOffset, endOffset: startOffset + quote.length, quote };
      offer(anchor, entry || { anchor }, undefined, block.parentElement);
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
      block.onclick = event => pointAt(block, event, entries);
      for (const entry of entries) {
        const inspect = button('an-shortcut', 'Look up ' + entry.anchor.quote);
        inspect.onclick = () => {
          close();
          offer(entry.anchor, entry, undefined, inspect);
          toolbar.querySelector('button:not([hidden]):enabled')?.focus({ preventScroll: true });
        };
        rail.append(inspect);
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
    const target = lookupTrigger || startBlock(anchor)?.parentElement;
    const rect = toolbar.getBoundingClientRect();
    const keyboard = toolbar.contains(document.activeElement);
    if (!await submit({ type: 'captureReading', anchor })) return;
    if (!candidate || anchorKey(candidate) !== anchorKey(anchor)) return;
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
    const existing = new Set(sources().map(t => t.id));
    inFlight = key;
    updateButtons();
    try {
      const source = view.id ? { annotationId: view.id } : { anchor: view.anchor };
      const message = input.value.trim();
      const action = view.mode === 'capture' ? { type: 'captureReading', anchor: view.anchor, note: message }
        : { type: 'annotationPost', ...source, message, askTutor };
      if (!await submit(action)) return;
      setDraft(key, '');
      if (current !== view) return;
      const id = view.id || sources().find(t => !existing.has(t.id) && anchorKey(t.anchor) === anchorKey(view.anchor))?.id;
      if (id && askTutor) open(id);
      else {
        if (id) view.id = id;
        view.trigger = controls.get(startBlock(view.anchor))?.marker;
        close(true);
      }
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
    if (!next) { if (!lookup) clearCandidate(); return; }
    if (current) close();
    offer(next);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (current || candidate)) {
      e.preventDefault();
      if (candidate) window.getSelection()?.removeAllRanges();
      close(true);
    } else if (candidate && !toolbar.hidden && e.key === 'Tab' && !e.shiftKey && !toolbar.contains(document.activeElement)) {
      e.preventDefault();
      ((lookup && spelling.querySelector('button')) || (capture.hidden || capture.disabled ? compose : capture)).focus({ preventScroll: true });
    }
  });
  document.addEventListener('pointerdown', e => {
    if (!panel.contains(e.target) && !e.target.closest('.an-rail') && !toolbar.contains(e.target)) close();
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
