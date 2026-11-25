// Home as a scrapbook: the learner's material, clustered by what it is about.
// Everything here is derived from journal state; nothing is invented or stored.

const hanzi = /[㐀-鿿]/;
const LOOSE = 'loose';
const pieceKinds = { note: 'annotation', takeaway: 'annotation', word: 'saved', saved: 'saved', line: 'line', observation: 'observation', media: 'media' };
const pieceLabels = { note: 'note', takeaway: 'takeaway', word: 'word', saved: 'saved item', line: 'chat line', observation: 'observation', media: 'clipping' };

function pieceTarget(scrap) {
  return { kind: pieceKinds[scrap.kind], pieceId: scrap.kind === 'media' ? scrap.item.id : scrap.id };
}

function hiddenGroups(board) {
  return new Set([...(board?.archivedGroups || []), ...(board?.deletedGroups || [])]);
}

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}
// A stable tilt and nudge per piece, so the page looks laid by hand but never reshuffles.
function tilt(id, range) {
  return ((hash(id) % 1000) / 1000 - 0.5) * 2 * range;
}

// `media`, when given, is the composition policy's verdict for each media item
// (media-policy.js): placed items become clippings beside their piece, and latent
// ones wait on their piece until the learner focuses it.
export function buildScrapbook(state, { readingLabel, media }) {
  const clusters = new Map();
  const cluster = (key, init) => {
    if (!clusters.has(key)) clusters.set(key, { key, scraps: [], recency: -1, also: new Set(), ...init() });
    return clusters.get(key);
  };
  const threadCluster = (id) => {
    const thread = state.threads.find((t) => t.id === id);
    return thread && cluster('chat:' + id, () => ({ kind: 'chat', id, title: thread.title }));
  };
  const documents = state.reading?.documents || [];
  const readingCluster = (id) => {
    const doc = documents.find((d) => d.id === id);
    return doc && cluster('read:' + id, () => ({ kind: 'read', id, title: doc.title, doc }));
  };
  const loose = () => cluster(LOOSE, () => ({ kind: LOOSE, title: 'Loose ends' }));

  const takeawayNotes = new Set();
  for (const reflection of state.reflections || []) {
    const home = threadCluster(reflection.threadId);
    if (!home) continue;
    home.overview = reflection.overview;
    home.reflectionId = reflection.id;
    for (const t of reflection.takeaways) {
      takeawayNotes.add(t.annotationId);
      home.scraps.push({ kind: 'takeaway', id: t.annotationId, quote: t.quote, text: t.text, href: '#chat/reflection/' + encodeURIComponent(reflection.id) });
    }
  }
  for (const note of state.annotationThreads || []) {
    if (takeawayNotes.has(note.id)) continue;
    const { surface, ownerId, quote } = note.anchor;
    const home = surface === 'chat' ? threadCluster(ownerId) : readingCluster(ownerId);
    if (!home) continue;
    const first = note.messages[0];
    home.scraps.push({
      kind: 'note', id: note.id, quote,
      text: first?.text || '', voice: first?.role === 'assistant' ? 'tutor' : 'yours',
      replies: Math.max(0, note.messages.length - 1),
      href: '#' + surface + '/annotation/' + encodeURIComponent(note.id),
    });
  }
  for (const [id, paragraphId] of Object.entries(state.reading?.positions || {})) {
    const home = readingCluster(id);
    if (!home) continue;
    const index = home.doc.paragraphs.findIndex((p) => p.id === paragraphId);
    home.progress = { at: index + 1, of: home.doc.paragraphs.length };
  }
  for (const message of state.tutor || []) {
    if (message.kind !== 'observation' || message.reference?.kind === 'reflection') continue;
    const ref = message.reference;
    const home = ref?.kind === 'reading' ? readingCluster(ref.id) : loose();
    (home || loose()).scraps.push({ kind: 'observation', id: message.id, text: message.text, quote: ref?.quote, reference: ref });
  }

  // A conversation underway but not yet reflected on still shows the learner's own latest line.
  const lastLine = [...(state.chat || [])].reverse().find((m) => m.role === 'user');
  const current = lastLine && threadCluster(state.activeThreadId);
  if (current && !current.scraps.length) current.scraps.push({ kind: 'line', id: lastLine.id || 'line', quote: lastLine.text, href: '#chat' });

  // A word lives where it showed up; if it showed up in several places, those are its links.
  const activeTurns = (state.chat || []).map((m) => m.text).join('\n');
  const textOf = (c) => [
    c.title, c.overview,
    ...c.scraps.map((s) => (s.quote || '') + '\n' + (s.text || '')),
    c.kind === 'chat' && c.id === state.activeThreadId ? activeTurns : '',
    c.kind === 'read' ? c.doc.paragraphs.map((p) => p.text).join('\n') : '',
  ].join('\n');
  const existing = [...clusters.values()];
  for (const item of state.saved || []) {
    const isWord = item.kind === 'Word' && item.word;
    const term = item.title;
    const homes = hanzi.test(term) ? existing.filter((c) => textOf(c).includes(term)) : [];
    if (!homes.length && item.reference?.kind === 'reading') {
      const r = readingCluster(item.reference.id);
      if (r) homes.push(r);
    }
    const home = homes[0] || loose();
    home.scraps.push({
      kind: isWord ? 'word' : 'saved', id: item.id, title: term,
      pinyin: item.word?.pinyin, meaning: item.word?.meaning || (!isWord ? item.detail : ''),
      example: item.word?.example, translation: item.word?.translation,
      context: item.source && item.source !== term ? item.source : '',
      also: homes.slice(1).map((c) => ({ key: c.key, title: c.title })),
    });
    for (const other of homes.slice(1)) other.also.add(home.key);
  }

  // Recency comes from the activity log; the open conversation counts as now.
  (state.activity || []).forEach((entry, index) => {
    const ref = entry.reference;
    let key;
    if (ref?.threadId) key = 'chat:' + ref.threadId;
    else if (ref?.kind === 'reading') key = 'read:' + ref.id;
    else if (ref?.kind === 'annotation') {
      const note = state.annotationThreads.find((n) => n.id === ref.id);
      if (note) key = note.anchor.surface + ':' + note.anchor.ownerId;
    }
    const c = key && clusters.get(key);
    if (c) c.recency = Math.max(c.recency, index);
  });
  const active = clusters.get('chat:' + state.activeThreadId);
  if (active) active.recency = Infinity;

  // Each reading has a place to open on the table, even before its first save.
  for (const doc of documents) readingCluster(doc.id);
  // A conversation can return from the archive while a different chat is open.
  // Its heading remains reachable even when it has no visible notes.
  for (const thread of state.threads) {
    if (thread.hasTurns) threadCluster(thread.id);
  }

  const hidden = hiddenGroups(state.board);
  const deleted = new Set((state.board?.deletedPieces || []).map(({ kind, pieceId }) => kind + ':' + pieceId));
  const visible = [...clusters.values()].filter(c => !hidden.has(c.key));
  for (const c of visible) {
    c.scraps = c.scraps.filter(scrap => !deleted.has(pieceKinds[scrap.kind] + ':' + scrap.id));
    for (const scrap of c.scraps) {
      if (scrap.also) scrap.also = scrap.also.filter(other => !hidden.has(other.key));
    }
    if (media) {
      c.scraps = c.scraps.flatMap((scrap) => {
        const attached = (state.media || []).filter((m) => m.anchor.id === scrap.id && media[m.id] && !deleted.has('media:' + m.id));
        const latent = attached.filter((m) => media[m.id].level === 'latent');
        if (latent.length) scrap.latent = latent;
        const placed = attached.filter((m) => media[m.id].level === 'placed').map((item) => ({ kind: 'media', id: 'media-' + item.id, item }));
        return [scrap, ...placed];
      });
    }
  }

  return visible
    .filter((c) => c.kind !== LOOSE || c.scraps.length)
    .sort((a, b) => (a.kind === LOOSE) - (b.kind === LOOSE) || b.recency - a.recency);
}

// One honest next step, from state alone: what is waiting, else what is underway.
export function todayStep(state, { readingLabel }) {
  const practice = state.practice;
  const queued = [...(state.activity || [])].reverse().find((a) => a.text.startsWith('Queued practice · '));
  if (practice?.card && !practice.done) {
    return { text: queued ? queued.text.replace('Queued practice · ', '') : 'An exercise is waiting where you left off.', label: 'Practice', href: '#practice' };
  }
  const hidden = hiddenGroups(state.board);
  const reading = [...Object.keys(state.reading?.positions || {}).reverse(), state.reading?.documentId]
    .find(id => id && !hidden.has('read:' + id));
  if (reading) return { text: readingLabel(state, reading), lang: 'zh', label: 'Keep reading', href: '#read/source/' + encodeURIComponent(reading) };
  return { text: 'Tell your conversation partner about your day.', label: 'Talk', href: '#chat' };
}

export function createScrapbook({ host, viewport, world, node, link, getState, readingLabel, openThread, ui, persist, compose, react, submit }) {
  const view = { x: 0, y: 0, s: 1, ...(ui.scrapView || {}) };
  let positioned = false;
  let drag;
  const narrow = matchMedia('(max-width: 760px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function apply(animate = false) {
    world.style.transition = animate && !reduced.matches ? 'transform 260ms ease' : '';
    if (narrow.matches) { world.style.transform = ''; host.classList.remove('far'); return; }
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    host.classList.toggle('far', view.s < 0.55);
    host.style.setProperty('--inv', (1 / view.s).toFixed(3));
    const label = host.querySelector('[data-zoom-label]');
    if (label) label.textContent = Math.round(view.s * 100) + '%';
  }
  function remember() { ui.scrapView = { x: Math.round(view.x), y: Math.round(view.y), s: +view.s.toFixed(3) }; persist(); }
  function zoomAt(px, py, factor) {
    const s = Math.min(1.6, Math.max(0.3, view.s * factor));
    view.x = px - ((px - view.x) / view.s) * s;
    view.y = py - ((py - view.y) / view.s) * s;
    view.s = s;
    apply();
  }
  // "See everything" shrinks to fit; the opening view stays readable and lets the rest invite panning.
  function fit(animate = true, readable = false) {
    const w = world.offsetWidth, h = world.offsetHeight;
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (!w || !h || !vw) return;
    const today = host.querySelector('.dock');
    const top = (today ? today.offsetTop + today.offsetHeight : 0) + 20, bottom = 130;
    const whole = Math.max(0.3, Math.min(1, (vw - 48) / w, (vh - top - bottom) / h));
    view.s = readable ? Math.max(whole, 0.92) : whole;
    const wide = w * view.s > vw - 48;
    view.x = wide ? 24 - 24 * view.s : (vw - w * view.s) / 2;
    view.y = top - 24 * view.s + Math.max(0, (vh - top - bottom - h * view.s) / 2);
    apply(animate);
    remember();
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (narrow.matches || e.button !== 0 || e.target.closest('a, button, input, textarea, summary, [popover]')) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    host.classList.add('dragging');
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    apply();
  });
  const endDrag = () => { if (drag?.moved) remember(); drag = undefined; host.classList.remove('dragging'); };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('wheel', (e) => {
    if (narrow.matches || e.target.closest('[popover]')) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    else { view.x -= e.deltaX; view.y -= e.deltaY; apply(); }
    clearTimeout(viewport.wheelTimer);
    viewport.wheelTimer = setTimeout(remember, 200);
  }, { passive: false });
  // Keyboard travel keeps the focused piece on screen.
  world.addEventListener('focusin', (e) => {
    if (narrow.matches) return;
    const r = e.target.getBoundingClientRect(), v = viewport.getBoundingClientRect();
    const margin = 120;
    if (r.left >= v.left + 24 && r.right <= v.right - 24 && r.top >= v.top + margin && r.bottom <= v.bottom - margin) return;
    view.x += v.left + v.width / 2 - (r.left + r.width / 2);
    view.y += v.top + v.height / 2 - (r.top + r.height / 2);
    apply(true);
    remember();
  });
  const zoomButton = (name, act) => { const b = host.querySelector('[data-zoom="' + name + '"]'); if (b) b.onclick = act; };
  zoomButton('in', () => { zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1.25); remember(); });
  zoomButton('out', () => { zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 0.8); remember(); });
  zoomButton('fit', () => fit());

  // The dock menu appears on demand and gets out of the way again.
  const menu = host.querySelector('.dock-menu');
  if (menu) {
    document.addEventListener('pointerdown', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    });
    menu.addEventListener('click', (e) => { if (e.target.closest('.dock-panel a, .dock-panel button')) menu.open = false; });
  }

  function licenseLabel(license) {
    const version = /\/(\d\.\d)\/?$/.exec(license.url || '')?.[1];
    const name = { PD: 'Public domain', CC0: 'CC0', 'CC-BY': 'CC BY', 'CC-BY-SA': 'CC BY-SA' }[license.code] || license.code;
    return license.code === 'PD' || license.code === 'CC0' || !version ? name : name + ' ' + version;
  }
  const outbound = (text, url) => Object.assign(link(text, url), { target: '_blank', rel: 'noopener noreferrer' });
  // A picture with its credit: author, license (linked) and source page.
  function picture(item) {
    const parts = [];
    if (item.kind === 'image') {
      const figure = node('figure', undefined, 'clip-figure');
      const img = node('img');
      img.src = item.source.thumbUrl;
      img.alt = (item.source.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
      img.loading = 'lazy';
      img.decoding = 'async';
      if (item.source.width && item.source.height) { img.width = item.source.width; img.height = item.source.height; }
      img.referrerPolicy = 'no-referrer';
      const caption = node('figcaption', item.caption, 'clip-caption');
      if (hanzi.test(item.caption)) caption.lang = 'zh';
      figure.append(img, caption);
      parts.push(figure);
      const credit = node('p', undefined, 'credit');
      credit.append(item.credit?.author || 'Unknown author', ' · ');
      if (item.license) credit.append(outbound(licenseLabel(item.license), item.license.url), ' · ');
      credit.append(outbound('Wikimedia Commons', item.source.pageUrl));
      parts.push(credit);
    } else {
      const caption = node('p', item.caption, 'clip-caption');
      if (hanzi.test(item.caption)) caption.lang = 'zh';
      const title = outbound(item.source.title || item.source.pageUrl, item.source.pageUrl);
      title.className = 'clip-link';
      if (hanzi.test(title.textContent)) title.lang = 'zh';
      const line = node('p', undefined, 'clip-work');
      line.append(title);
      if (item.source.year) line.append(' ', node('span', item.source.year, 'sub'));
      parts.push(caption, line);
    }
    return parts;
  }
  function control(label, action) {
    const b = node('button', label, 'clip-action');
    b.type = 'button';
    b.dataset.mutation = '';
    b.onclick = action;
    return b;
  }
  const dialog = document.getElementById('board-actions');
  const archiveAction = document.getElementById('board-archive-action');
  const deleteAction = document.getElementById('board-delete-action');
  document.getElementById('board-cancel-action').onclick = () => dialog.close();

  function moreButton(label, scrap) {
    const more = node('button', '•••', 'board-more');
    more.type = 'button';
    more.dataset.mutation = '';
    const name = 'Options for ' + (scrap ? pieceLabels[scrap.kind] + ' · ' : '') + label;
    more.setAttribute('aria-label', name);
    more.setAttribute('aria-haspopup', 'dialog');
    more.title = name;
    more.onclick = () => {
      const surface = more.closest('.scrap-world, .scrap-list');
      const parentKey = more.closest('.cluster').dataset.key;
      const neighbor = more.closest('.cluster').nextElementSibling?.dataset.key;
      async function applyChange(action) {
        dialog.close();
        if (!await submit(action) || !surface.checkVisibility() || document.activeElement !== document.body) return;
        const clusters = [...surface.querySelectorAll('.cluster')];
        const next = clusters.find(c => c.dataset.key === parentKey) || clusters.find(c => c.dataset.key === neighbor) || clusters[0];
        (next?.querySelector('.cluster-title[href], .board-more') ||
          (surface === world ? menu.querySelector('summary') : document.querySelector('[data-page="saved"] .back'))).focus();
      }
      document.getElementById('board-action-title').textContent = label;
      let description = 'Archive this board item to restore it later, or delete its scrapbook entry permanently. The source and learning history stay in the journal.';
      if (scrap) {
        description = pieceKinds[scrap.kind] === 'annotation'
          ? 'Delete this note from the scrapbook and its margin.'
          : 'Delete this piece from the scrapbook.';
        const attached = (getState().media || []).filter(item => item.anchor.id === scrap.id);
        if (attached.length) description += attached.length === 1
          ? ' Its attached clipping will also leave the board.' : ' Its attached clippings will also leave the board.';
        description += scrap.kind === 'word' ? ' The journal keeps the word and its practice history.' : ' Its learning history stays in the journal.';
      }
      document.getElementById('board-action-description').textContent = description;
      archiveAction.hidden = Boolean(scrap);
      archiveAction.onclick = () => applyChange({ type: 'boardGroup', key: parentKey, disposition: 'archived' });
      deleteAction.onclick = () => applyChange(scrap ? { type: 'deletePiece', ...pieceTarget(scrap) }
        : { type: 'boardGroup', key: parentKey, disposition: 'deleted' });
      dialog.showModal();
    };
    return more;
  }
  // A latent picture: nothing shows until the learner focuses or hovers its piece.
  function latentCue(scrap, holder, list) {
    for (const item of scrap.latent) {
      const pop = node('div', undefined, 'picture-pop');
      pop.id = (list ? 'list-picture-' : 'picture-') + item.id;
      pop.popover = 'auto';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Picture of ' + item.caption);
      const actions = node('div', undefined, 'clip-actions');
      actions.append(
        control('Keep on board', () => { pop.hidePopover(); react(item.id, 'keep'); }),
        control('Not for me', () => { pop.hidePopover(); react(item.id, 'notForMe'); }),
      );
      pop.append(...picture(item), actions);
      const cue = node('button', item.kind === 'link' ? 'link ↗' : 'picture ↗', 'picture-cue');
      cue.type = 'button';
      cue.setAttribute('popovertarget', pop.id);
      cue.setAttribute('aria-label', (item.kind === 'link' ? 'Link for ' : 'Picture of ') + item.caption);
      holder.append(cue, pop);
    }
  }

  function scrapNode(scrap, state, list = false) {
    const holder = node('div', undefined, 'scrap-holder holder-' + scrap.kind);
    if (scrap.kind === 'media') {
      const el = node('article', undefined, 'scrap scrap-media scrap-media-' + scrap.item.kind);
      el.tabIndex = 0;
      el.setAttribute('aria-label', (scrap.item.kind === 'link' ? 'Link for ' : 'Picture of ') + scrap.item.caption);
      if (!list) el.style.setProperty('--tilt', tilt(scrap.id, 2.2).toFixed(2) + 'deg');
      el.append(...picture(scrap.item));
      if (scrap.item.origin === 'system') {
        const actions = node('div', undefined, 'clip-actions clip-controls');
        actions.append(control('Not for me', () => react(scrap.item.id, 'notForMe')));
        el.append(actions);
      }
      holder.append(el);
    } else {
      holder.append(scrapElement(scrap, state, list));
      if (scrap.latent) latentCue(scrap, holder, list);
    }
    holder.append(moreButton(scrap.title || scrap.quote || scrap.text || scrap.item?.caption || 'Tutor note', scrap));
    return holder;
  }
  function scrapElement(scrap, state, list) {
    const tag = scrap.href ? 'a' : 'article';
    const el = node(tag, undefined, 'scrap scrap-' + scrap.kind);
    if (scrap.href) el.href = scrap.href;
    else if (!list) el.tabIndex = 0;
    if (!list) el.style.setProperty('--tilt', tilt(scrap.id, 1.6).toFixed(2) + 'deg');
    if (scrap.kind === 'line') {
      el.append(node('q', scrap.quote, 'yours zh-line'));
    } else if (scrap.kind === 'takeaway') {
      el.append(node('q', scrap.quote, 'yours zh-line'));
      el.append(tutorLine(scrap.text));
    } else if (scrap.kind === 'note') {
      el.append(node('mark', scrap.quote, 'zh-line'));
      if (scrap.text) el.append(scrap.voice === 'tutor' ? tutorLine(scrap.text) : node('p', scrap.text, 'yours-note'));
      if (scrap.replies) el.append(node('small', scrap.replies + (scrap.replies === 1 ? ' reply' : ' replies'), 'sub'));
    } else if (scrap.kind === 'word' || scrap.kind === 'saved') {
      const head = node('div', undefined, 'word-head');
      const term = node('strong', scrap.title);
      if (hanzi.test(scrap.title)) term.lang = 'zh';
      head.append(term);
      if (scrap.pinyin) head.append(node('span', scrap.pinyin, 'pinyin'));
      el.append(head);
      if (scrap.meaning) el.append(node('p', scrap.meaning, 'gloss'));
      if (list && scrap.example) {
        const ex = node('p', scrap.example, 'example');
        ex.lang = 'zh';
        el.append(ex);
        if (scrap.translation) el.append(node('p', scrap.translation, 'translation'));
      }
      if (scrap.context) {
        const ctx = node('p', scrap.context, 'yours-note');
        if (hanzi.test(scrap.context)) ctx.lang = 'zh';
        el.append(ctx);
      }
      if (scrap.also.length) el.append(node('small', 'also in ' + scrap.also.map((a) => a.title).join(', '), 'also'));
    } else if (scrap.kind === 'observation') {
      if (scrap.quote) el.append(node('mark', scrap.quote, 'zh-line'));
      el.append(tutorLine(scrap.text));
    }
    for (const el2 of el.querySelectorAll('.zh-line')) el2.lang = 'zh';
    return el;
  }
  function tutorLine(text) {
    const p = node('p', undefined, 'tutor-note');
    p.append(node('span', '师', 'seal-mini'), node('span', text));
    p.firstChild.setAttribute('aria-label', 'Tutor:');
    p.firstChild.lang = 'zh';
    return p;
  }
  function header(c, state) {
    const head = node('header', undefined, 'cluster-head');
    const kinds = { chat: 'Conversation', read: 'Reading', [LOOSE]: '' };
    if (kinds[c.kind]) head.append(node('span', kinds[c.kind], 'small'));
    let title;
    if (c.kind === 'chat') {
      title = link(c.title, '#chat', 'cluster-title');
      title.onclick = (e) => { e.preventDefault(); openThread(c.id); };
    } else if (c.kind === 'read') title = link(c.title, '#read/source/' + encodeURIComponent(c.id), 'cluster-title');
    else title = node('span', c.title, 'cluster-title loose-title');
    if (hanzi.test(c.title)) title.lang = 'zh';
    const h = node('h2');
    h.append(title);
    head.append(h);
    if (c.kind !== LOOSE) head.append(moreButton(c.title));
    if (c.kind === 'read') {
      const lead = c.doc.paragraphs[0]?.text || '';
      if (!c.scraps.length) head.append(Object.assign(node('p', lead.slice(0, 70) + (lead.length > 70 ? '…' : ''), 'excerpt'), { lang: 'zh' }));
      if (c.progress) {
        const bar = node('div', undefined, 'progress');
        bar.style.setProperty('--done', (c.progress.at / c.progress.of * 100).toFixed(0) + '%');
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', 'Paragraph ' + c.progress.at + ' of ' + c.progress.of);
        head.append(bar);
      }
    }
    if (c.overview) head.append(tutorLine(c.overview));
    const count = node('span', c.scraps.length + (c.scraps.length === 1 ? ' piece' : ' pieces'), 'far-count');
    count.setAttribute('aria-hidden', 'true');
    head.append(count);
    return head;
  }

  function layout() {
    if (host.hidden) return;
    if (narrow.matches) { apply(); return; }
    const items = [...world.children];
    if (!items.length) return;
    const colW = 400, gap = 72;
    const cols = Math.max(1, Math.min(items.length, Math.ceil(Math.sqrt(items.length * 1.7))));
    const heights = Array(cols).fill(0);
    for (const el of items) {
      el.style.width = colW + 'px';
      const col = heights.indexOf(Math.min(...heights));
      const nudgeX = tilt(el.dataset.key, 18), nudgeY = tilt(el.dataset.key + 'y', 14);
      el.style.left = col * (colW + gap) + nudgeX + 24 + 'px';
      el.style.top = heights[col] + nudgeY + 24 + 'px';
      heights[col] += el.offsetHeight + gap;
    }
    world.style.width = cols * (colW + gap) + 48 + 'px';
    world.style.height = Math.max(...heights) + 48 + 'px';
    if (!positioned) { positioned = true; ui.scrapView ? apply() : fit(false, true); }
    else apply();
  }
  new ResizeObserver(() => layout()).observe(viewport);
  narrow.addEventListener('change', () => { positioned = false; layout(); });

  // Picking: point at a piece to talk about it. No per-piece controls are drawn.
  let picking;
  function describe(piece) {
    const cluster = piece.closest('.cluster');
    const title = cluster?.querySelector('.cluster-title')?.textContent || '';
    const lead = (piece.querySelector('q, mark, strong, .cluster-title') || piece).textContent.trim();
    const text = [...piece.children].filter(child => child.checkVisibility() && !child.matches('.board-more'))
      .map(child => child.innerText).join(' ').replace(/\s+/g, ' ').trim();
    return { label: lead.length > 24 ? lead.slice(0, 23) + '…' : lead, source: [title, text].filter(Boolean).join('\n') };
  }
  function stopPicking() {
    if (!picking) return;
    host.classList.remove('picking');
    document.body.classList.remove('picking-piece');
    const done = picking.done;
    picking = undefined;
    done?.();
  }
  function clearAsked() {
    for (const el of world.querySelectorAll('.asked')) el.classList.remove('asked');
  }
  world.addEventListener('click', (e) => {
    if (!picking) return;
    const piece = e.target.closest('.scrap, .cluster-head');
    if (!piece) return;
    e.preventDefault();
    e.stopPropagation();
    clearAsked();
    piece.classList.add('asked');
    const onPick = picking.onPick;
    stopPicking();
    onPick(describe(piece));
  }, true);
  world.addEventListener('keydown', (e) => {
    if (picking && e.key === 'Enter' && e.target.matches('.scrap')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('keydown', (e) => { if (picking && e.key === 'Escape') { e.preventDefault(); stopPicking(); } });

  function clusterNode(c, state, list) {
    const section = node('section', undefined, 'cluster cluster-' + c.kind);
    section.dataset.key = c.key;
    section.append(header(c, state));
    const pieces = node('div', undefined, 'pieces');
    pieces.append(...c.scraps.map((s) => scrapNode(s, state, list)));
    if (c.scraps.length) section.append(pieces);
    return section;
  }

  return {
    render() {
      const state = getState();
      if (!state) return;
      // A final bookmark write can refresh the board just after returning to the story title.
      const focused = document.activeElement;
      const restoreTitle = world.contains(focused) && focused.matches('.cluster-title')
        ? focused.closest('.cluster').dataset.key : undefined;
      const clusters = buildScrapbook(state, { readingLabel, media: compose(state, Date.now()) });
      world.replaceChildren(...clusters.map((c) => clusterNode(c, state, false)));
      host.querySelector('.board-empty').hidden = Boolean(clusters.length);
      if (restoreTitle) {
        layout();
        const cluster = [...world.children].find(el => el.dataset.key === restoreTitle);
        cluster?.querySelector('.cluster-title')?.focus({ preventScroll: true });
      } else requestAnimationFrame(layout);
    },
    showReading(id) {
      const cluster = [...world.children].find(el => el.dataset.key === 'read:' + id);
      if (!cluster) return;
      layout();
      const heading = cluster.querySelector('.cluster-title');
      if (narrow.matches) {
        heading.scrollIntoView({ block: 'center' });
      } else {
        const header = host.querySelector('.dock').getBoundingClientRect();
        view.s = Math.max(view.s, .92);
        view.x = (viewport.clientWidth - cluster.offsetWidth * view.s) / 2 - cluster.offsetLeft * view.s;
        view.y = header.bottom + 24 - cluster.offsetTop * view.s;
        apply();
        remember();
      }
      heading.focus({ preventScroll: true });
    },
    // The same scrapbook read top to bottom, with full word details.
    renderList(container) {
      const state = getState();
      if (!state) return;
      const clusters = buildScrapbook(state, { readingLabel, media: compose(state, Date.now()) });
      container.replaceChildren(...clusters.map((c) => clusterNode(c, state, true)));
      const archive = document.getElementById('board-archive');
      const archived = state.board?.archivedGroups || [];
      document.getElementById('archive-link').hidden = archive.hidden = !archived.length;
      archive.querySelector('ul').replaceChildren(...archived.map(key => {
        const chat = key.startsWith('chat:');
        const source = (chat ? state.threads : state.reading.documents).find(item => item.id === key.slice(5));
        const row = node('li');
        const label = node('span', source.title);
        if (hanzi.test(source.title)) label.lang = 'zh';
        const restore = control('Restore', async () => {
          if (await submit({ type: 'boardGroup', key, disposition: 'visible' }) && document.activeElement === document.body && container.checkVisibility()) {
            const restored = [...container.children].find(group => group.dataset.key === key);
            (restored?.querySelector('.cluster-title') || document.querySelector('[data-page="saved"] .back')).focus();
          }
        });
        restore.setAttribute('aria-label', 'Restore ' + source.title);
        row.append(label, restore);
        return row;
      }));
    },
    fit,
    pick(onPick, done) {
      stopPicking();
      picking = { onPick, done };
      host.classList.add('picking');
      document.body.classList.add('picking-piece');
      world.querySelector('.scrap')?.focus({ preventScroll: true });
    },
    stopPicking,
    clearAsked,
  };
}
