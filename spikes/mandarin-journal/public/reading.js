function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, listener, className) {
  const control = node('button', text, className);
  control.type = 'button';
  control.onclick = listener;
  return control;
}

function lookup(state, ref) {
  if (typeof ref !== 'string') return null;
  const [documentId, paragraphId, annotationId, ...rest] = ref.split('/');
  const document = state?.reading?.documents.find((entry) => entry.id === documentId);
  if (!document || rest.length) return null;
  const paragraph = document.paragraphs.find((entry) => entry.id === paragraphId);
  if (paragraphId !== undefined && !paragraph) return null;
  const annotation = annotationId === undefined
    ? undefined
    : state.reading.annotations.find(
        (entry) => entry.documentId === documentId && entry.paragraphId === paragraphId && entry.id === annotationId,
      );
  if (annotationId !== undefined && !annotation) return null;
  return { document, paragraph, annotation };
}

export function readingLabel(state, referenceId) {
  return lookup(state, referenceId)?.document.title || '';
}

export function referenceForSource(state, source) {
  if (!source) return '';
  if (lookup(state, source)) return source;
  return state?.reading?.documents.find((entry) => source.includes(entry.title))?.id || '';
}

function sourceFor({ document, paragraph, annotation }, selection = '') {
  const lines = [document.title, ...(paragraph ? [paragraph.text] : document.paragraphs.map((entry) => entry.text))];
  const quote = selection || annotation?.quote;
  if (quote) lines.push('Selected text: ' + quote);
  if (annotation) lines.push('Learner’s note: ' + annotation.text);
  return lines.join('\n');
}

export function createReading({ host, submit, canSubmit, askTutor, discussInChinese, navigate }) {
  let state;
  let documentView;
  let rows = new Map();
  let active = false;
  let entered = false;
  let reference = '';
  let busy = true;
  let selected;
  let pendingPosition;
  let positionTimer;
  let scrollIntent = 0;
  let currentParagraphId;
  let noteIds;

  const back = node('a', '← Journal', 'back');
  back.href = '#home';
  const title = node('h1');
  title.lang = 'zh';
  const kind = node('p', '', 'small folio');
  const picker = node('select');
  picker.id = 'reader-document';
  picker.onchange = () => navigate('read', picker.value);
  const pickerLabel = node('label', 'Reading');
  pickerLabel.htmlFor = picker.id;
  const pickerGroup = node('div', undefined, 'reader-picker');
  pickerGroup.append(pickerLabel, picker);
  const notes = node('details', undefined, 'reader-notes');
  notes.hidden = true;
  const notesSummary = node('summary', 'Notes');
  const notesList = node('ul');
  notes.append(notesSummary, notesList);
  const save = button('Save reading', () => {
    if (!documentView) return;
    submit({
      type: 'saveReading',
      title: documentView.title,
      detail: documentView.paragraphs.map((entry) => entry.text).join('\n'),
      source: documentView.id,
    });
  });
  const discuss = button(
    'Discuss in Chinese',
    () => {
      if (!documentView) return;
      discussInChinese({
        title: documentView.title,
        source: sourceFor({ document: documentView }),
        referenceId: documentView.id,
        opener: documentView.opener,
      });
    },
    'primary',
  );
  const resume = button('Go to saved place', () => {
    scrollTo(state?.reading?.positions[documentView.id]);
  });
  resume.hidden = true;
  const tools = node('div', undefined, 'tools reader-tools');
  tools.append(discuss, save, resume);
  const passage = node('div', undefined, 'passage reader-passage');
  const status = node('p', '', 'sr');
  status.setAttribute('role', 'status');
  host.replaceChildren(back, pickerGroup, kind, title, tools, notes, passage, status);

  function ask(paragraph, annotation, selection = '', explanation = false) {
    const referenceId = [documentView.id, paragraph.id, annotation?.id].filter(Boolean).join('/');
    return askTutor({
      message: explanation ? 'What does “' + selection + '” mean here?' : undefined,
      source: sourceFor({ document: documentView, paragraph, annotation }, selection),
      referenceId,
    });
  }

  function clearSelection() {
    if (!selected) return;
    rows.get(selected.paragraphId).selectionActions.hidden = true;
    selected = undefined;
  }

  function buildParagraph(paragraph, index) {
    const { id, text, phrases = [] } = paragraph;
    const section = node('section', undefined, 'reader-paragraph');
    const prose = node('p', undefined, 'reader-prose');
    prose.lang = 'zh';
    prose.tabIndex = -1;
    let after = 0;
    const phraseButtons = [];
    for (const phrase of phrases) {
      const at = text.indexOf(phrase, after);
      prose.append(text.slice(after, at));
      const phraseButton = button(phrase, () => ask(paragraph, undefined, phrase, true), 'phrase');
      phraseButton.dataset.phrase = phrase;
      prose.append(phraseButton);
      phraseButtons.push(phraseButton);
      after = at + phrase.length;
    }
    prose.append(text.slice(after));

    const details = node('details', undefined, 'reader-margin');
    const summary = node('summary');
    const summaryLabel = node('span', 'Passage tools');
    const paragraphLabel = node('span', ' for paragraph ' + (index + 1), 'sr');
    const place = node('span', 'Saved place', 'reader-place');
    place.hidden = true;
    summary.append(summaryLabel, paragraphLabel, place);

    const form = node('form', undefined, 'reader-note-form');
    form.hidden = true;
    const quotePreview = node('blockquote');
    quotePreview.lang = 'zh';
    const label = node('label', 'Your note');
    const field = node('textarea');
    field.required = true;
    field.rows = 3;
    field.maxLength = 1600;
    const saveNote = node('button', 'Save note', 'primary');
    saveNote.type = 'submit';
    const close = button('Close', () => {
      form.hidden = true;
      note.focus();
    });
    const formTools = node('div', undefined, 'reader-controls');
    formTools.append(saveNote, close);
    label.append(field);
    form.append(quotePreview, label, formTools);

    let quote = '';
    function openEditor(nextQuote = '') {
      clearSelection();
      if (form.hidden && (!field.value.trim() || nextQuote)) quote = nextQuote;
      quotePreview.textContent = quote;
      quotePreview.hidden = !quote;
      details.open = true;
      form.hidden = false;
      field.focus();
    }

    const noteList = node('div', undefined, 'reader-passage-notes');
    const note = button('Add note', () => openEditor());
    const askPassage = button('Ask tutor about passage', () => ask(paragraph));
    const savePlace = button('Save my place', () => {
      queuePosition(id, 0);
    });
    const controls = node('div', undefined, 'reader-controls');
    controls.append(note, askPassage, savePlace);
    // The summary is kept first so details retain their native keyboard behavior.
    details.append(summary, controls, form, noteList);
    const askSelection = button('Ask about selection', () => {
      const phrase = selected?.quote;
      clearSelection();
      if (phrase) ask(paragraph, undefined, phrase, true);
    });
    const noteSelection = button('Note selection', () => openEditor(selected?.quote));
    const selectionActions = node('div', undefined, 'reader-controls reader-selection');
    selectionActions.hidden = true;
    selectionActions.append(askSelection, noteSelection);
    section.append(prose, selectionActions, details);

    const row = {
      prose, summaryLabel, details, place, form, field, noteList, savePlace, selectionActions,
      controls: [...phraseButtons, askPassage, askSelection, saveNote, savePlace],
      renderedNotes: new Map(),
      pendingNote: null,
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      const text = field.value.trim();
      if (!text || busy || !state) return;
      row.pendingNote = { text, quote, previous: new Set(row.renderedNotes.keys()) };
      submit({ type: 'annotate', documentId: documentView.id, paragraphId: id, quote, text });
    };
    rows.set(id, row);
    return section;
  }

  function mount(nextDocument) {
    if (documentView?.id === nextDocument.id) return;
    clearSelection();
    documentView = nextDocument;
    currentParagraphId = nextDocument.paragraphs[0].id;
    rows = new Map();
    noteIds = undefined;
    notes.open = false;
    title.textContent = nextDocument.title;
    kind.textContent = nextDocument.kind;
    picker.value = nextDocument.id;
    passage.replaceChildren(...nextDocument.paragraphs.map(buildParagraph));
  }

  function noteLink(annotation) {
    const ref = [annotation.documentId, annotation.paragraphId, annotation.id].join('/');
    const text = annotation.text.length > 95 ? annotation.text.slice(0, 94) + '…' : annotation.text;
    const link = node('a', text);
    link.href = '#read/source/' + encodeURIComponent(ref);
    link.onclick = (event) => {
      if (location.hash !== link.hash) return;
      event.preventDefault();
      scrollTo(annotation.paragraphId, annotation.id);
    };
    return link;
  }

  function renderNotes(annotations) {
    const nextIds = annotations.map((entry) => entry.id).join(',');
    if (nextIds === noteIds) return;
    noteIds = nextIds;
    notes.hidden = !annotations.length;
    notesSummary.textContent = 'Notes (' + annotations.length + ')';
    notesList.replaceChildren(...annotations.map((entry) => {
      const item = node('li');
      item.append(noteLink(entry));
      return item;
    }));
    for (const annotation of annotations) {
      const { id, paragraphId, quote, text } = annotation;
      const row = rows.get(paragraphId);
      if (!row || row.renderedNotes.has(id)) continue;
      const paragraph = documentView.paragraphs.find((entry) => entry.id === paragraphId);
      const card = node('article', undefined, 'reader-note');
      card.tabIndex = -1;
      card.setAttribute('aria-label', 'Reading note');
      if (quote) {
        const quoted = node('blockquote', quote);
        quoted.lang = 'zh';
        card.append(quoted);
      }
      const askNote = button('Ask tutor about note', () => ask(paragraph, annotation));
      row.controls.push(askNote);
      card.append(node('p', text), askNote);
      row.noteList.append(card);
      row.renderedNotes.set(id, card);
      row.summaryLabel.textContent =
        row.renderedNotes.size === 1 ? '1 note · Passage tools' : row.renderedNotes.size + ' notes · Passage tools';

      const pending = row.pendingNote;
      if (pending && !pending.previous.has(id) && pending.text === text && pending.quote === quote) {
        row.pendingNote = null;
        status.textContent = 'Note saved.';
        if (row.field.value.trim() === text) {
          const focused = row.form.contains(document.activeElement);
          row.field.value = '';
          row.form.hidden = true;
          if (focused) card.focus({ preventScroll: true });
        }
      }
    }
  }

  function update() {
    if (!state?.reading || !documentView) return;
    const position = state.reading.positions[documentView.id];
    resume.hidden = !position || position === documentView.paragraphs[0].id;
    const saved = state.saved.some((item) => item.kind === 'Reading' && item.title === documentView.title);
    save.textContent = saved ? 'Reading saved' : 'Save reading';
    save.disabled = busy || saved;
    picker.disabled = state.reading.documents.length < 2;
    for (const [id, row] of rows) {
      row.place.hidden = id !== position;
      row.savePlace.textContent = id === position ? 'Place saved' : 'Save my place';
      row.prose.parentElement.classList.toggle('reader-at-place', id === position);
    }
    renderNotes(state.reading.annotations.filter((entry) => entry.documentId === documentView.id));
    for (const [id, row] of rows) {
      for (const control of row.controls) control.disabled = busy || (control === row.savePlace && id === position);
    }
  }

  function scrollTo(paragraphId, annotationId) {
    const row = rows.get(paragraphId);
    if (!row) return;
    currentParagraphId = paragraphId;
    let target = row.prose;
    if (annotationId) {
      row.details.open = true;
      target = row.renderedNotes.get(annotationId) || target;
    }
    scrollIntent = 0;
    target.focus({ preventScroll: true });
    const passageAndNoteHeight =
      target.getBoundingClientRect().bottom - row.prose.getBoundingClientRect().top;
    const anchor = passageAndNoteHeight < window.innerHeight * 0.85 ? row.prose : target;
    anchor.scrollIntoView({ block: 'start' });
  }

  function applyEntry() {
    if (!state?.reading || !active || entered) return;
    entered = true;
    const reading = state.reading;
    const source = lookup(state, reference) || lookup(state, reading.documentId);
    if (!source) return;
    mount(source.document);
    update();
    const position = reading.positions[documentView.id];
    const paragraphId = source.paragraph?.id || position;
    currentParagraphId = paragraphId || documentView.paragraphs[0].id;
    if (paragraphId && (source.paragraph || paragraphId !== documentView.paragraphs[0].id)) {
      requestAnimationFrame(() => {
        if (active && documentView.id === source.document.id) scrollTo(paragraphId, source.annotation?.id);
      });
    }
    if (documentView.id !== reading.documentId) queuePosition(position || documentView.paragraphs[0].id, 0);
  }

  function flushPosition() {
    if (!active || !pendingPosition || !canSubmit()) return;
    const { documentId, paragraphId } = pendingPosition;
    pendingPosition = undefined;
    if (documentId !== documentView.id) return;
    if (state.reading.documentId === documentId && state.reading.positions[documentId] === paragraphId) return;
    submit({ type: 'readingPosition', documentId, paragraphId });
  }

  function queuePosition(paragraphId, delay) {
    currentParagraphId = paragraphId;
    window.clearTimeout(positionTimer);
    pendingPosition = { documentId: documentView.id, paragraphId };
    positionTimer = window.setTimeout(() => {
      positionTimer = undefined;
      flushPosition();
    }, delay);
  }

  function trackPosition(event) {
    if (!active || !(event.target instanceof Element)) return;
    if (event.target.closest('#tutor, input, textarea, select')) return;
    if (event.type === 'keydown' && event.target.closest('button, summary, a')) return;
    scrollIntent = performance.now() + 1500;
  }

  window.addEventListener('wheel', trackPosition, { passive: true });
  window.addEventListener('touchmove', trackPosition, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(event.key)) trackPosition(event);
  });
  window.addEventListener('scroll', () => {
    if (!active || performance.now() > scrollIntent || !documentView) return;
    const line = window.innerHeight * 0.33;
    let current = documentView.paragraphs[0].id;
    for (const [id, row] of rows) {
      if (row.prose.getBoundingClientRect().top > line) break;
      current = id;
    }
    queuePosition(current, 550);
  }, { passive: true });

  document.addEventListener('selectionchange', () => {
    if (!active) return;
    const selection = window.getSelection();
    const quote = selection?.toString().trim();
    if (!quote) return;
    clearSelection();
    for (const [id, row] of rows) {
      if (
        row.prose.contains(selection.anchorNode) &&
        row.prose.contains(selection.focusNode) &&
        row.prose.textContent.includes(quote)
      ) {
        selected = { paragraphId: id, quote };
        row.selectionActions.hidden = false;
        break;
      }
    }
  });

  return {
    render(nextState) {
      state = nextState;
      if (!state.reading) return;
      if (!picker.options.length) {
        for (const entry of state.reading.documents) {
          const option = node('option', entry.title);
          option.value = entry.id;
          option.lang = 'zh';
          picker.append(option);
        }
      }
      if (!documentView) mount(lookup(state, state.reading.documentId).document);
      applyEntry();
      update();
    },
    title: () => documentView?.title || 'Reading',
    currentReference: () => documentView ? documentView.id + '/' + currentParagraphId : '',
    source: () => {
      const current = documentView && lookup(state, documentView.id + '/' + currentParagraphId);
      return current ? sourceFor(current) : 'Reading';
    },
    openReference(ref) {
      const available = !state || Boolean(lookup(state, ref));
      reference = available ? ref : '';
      entered = false;
      return available;
    },
    enter() {
      active = true;
      applyEntry();
    },
    leave() {
      active = false;
      entered = false;
      reference = '';
      clearSelection();
      window.clearTimeout(positionTimer);
      positionTimer = undefined;
      pendingPosition = undefined;
    },
    setBusy(value) {
      busy = value;
      update();
      if (!busy && positionTimer === undefined) flushPosition();
    },
  };
}
