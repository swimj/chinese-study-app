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

function sourceFor(document, paragraph) {
  const paragraphs = paragraph ? [paragraph] : document.paragraphs;
  return [document.title, ...paragraphs.map((entry) => entry.text)].join('\n');
}

export function createReading({
  host, submit, canSubmit, discussInChinese, navigate, quoteBlock, openAnnotation, refreshAnnotations,
}) {
  let state;
  let documentView;
  let rows = new Map();
  let active = false;
  let entered = false;
  let reference = '';
  let busy = true;
  let pendingPosition;
  let positionTimer;
  let scrollIntent = 0;
  let currentParagraphId;
  let focusImportedId;
  let importRevision = 0;
  let preview;

  const back = node('a', '← Journal', 'back');
  back.href = '#home';
  const title = node('h1');
  title.lang = 'zh';
  title.tabIndex = -1;
  const kind = node('p', '', 'small folio');
  const picker = node('select');
  picker.id = 'reader-document';
  picker.onchange = () => navigate('read', picker.value);
  const pickerLabel = node('label', 'Reading');
  pickerLabel.htmlFor = picker.id;
  const pickerGroup = node('div', undefined, 'reader-picker');
  const importForm = node('form', undefined, 'reader-import');
  importForm.id = 'reader-import-form';
  importForm.hidden = true;
  const importToggle = button('Import URL', () => setImportOpen(importForm.hidden), 'text-button');
  importToggle.setAttribute('aria-expanded', 'false');
  importToggle.setAttribute('aria-controls', importForm.id);
  function setImportOpen(open) {
    importForm.hidden = !open;
    importToggle.setAttribute('aria-expanded', String(open));
    if (open) url.focus();
    else resetImportFeedback();
  }
  const url = node('input');
  url.id = 'reader-url';
  url.type = 'url';
  url.required = true;
  url.maxLength = 2048;
  url.placeholder = 'https://…';
  url.autocomplete = 'url';
  const urlLabel = node('label', 'Reading URL');
  urlLabel.htmlFor = url.id;
  const importLine = node('div', undefined, 'intake-line');
  const importButton = node('button', 'Import reading', 'primary');
  importButton.dataset.mutation = '';
  const importError = node('p', '', 'notice');
  importError.hidden = true;
  importError.setAttribute('role', 'alert');
  importError.id = 'reader-url-error';
  url.setAttribute('aria-describedby', importError.id);
  const previewBox = node('div', undefined, 'reader-import-preview');
  previewBox.hidden = true;
  const previewTitle = node('strong');
  previewTitle.tabIndex = -1;
  const previewExcerpt = node('p');
  previewTitle.lang = previewExcerpt.lang = 'zh';
  const accept = button('Import this text', () => {
    if (canSubmit() && preview && url.value.trim() === preview.url) {
      submit({ type: 'importReading', url: preview.url, acceptPreview: preview.token });
    }
  }, 'primary');
  accept.dataset.mutation = '';
  previewBox.append(previewTitle, previewExcerpt, accept);
  function resetImportFeedback() {
    importRevision++;
    preview = undefined;
    previewBox.hidden = true;
    importError.hidden = true;
  }
  importLine.append(url, importButton);
  importForm.append(urlLabel, importLine, importError, previewBox);
  importForm.onsubmit = event => {
    event.preventDefault();
    if (!canSubmit()) return;
    resetImportFeedback();
    submit({ type: 'importReading', url: url.value.trim() });
  };
  url.oninput = resetImportFeedback;
  pickerGroup.append(pickerLabel, picker, importToggle);
  const header = node('div', undefined, 'reader-header');
  header.append(back, pickerGroup);

  const save = button('Save reading', () => {
    if (!documentView) return;
    submit({
      type: 'saveReading',
      title: documentView.title,
      detail: documentView.sourceUrl ? documentView.title : documentView.paragraphs.map((entry) => entry.text).join('\n'),
      source: documentView.id,
    });
  });
  const discuss = button('Discuss in Chinese', () => {
    if (!documentView) return;
    discussInChinese({
      title: documentView.title,
      source: documentView.sourceUrl ? documentView.id : sourceFor(documentView),
    });
  });
  const resume = button('Go to saved place', () => {
    focusPassage(state.reading.positions[documentView.id]);
  }, 'reader-resume');
  resume.hidden = true;
  const tools = node('div', undefined, 'tools reader-tools');
  tools.append(discuss, save);
  const passage = node('div', undefined, 'passage reader-passage');
  const importWarning = node('p', '', 'notice');
  importWarning.hidden = true;
  host.replaceChildren(header, importForm, kind, title, importWarning, resume, passage, tools);

  function buildParagraph(documentId, paragraph) {
    const section = node('div', undefined, 'reader-paragraph');
    const prose = node(paragraph.kind === 'heading' ? 'h2' : 'p', undefined, 'reader-prose');
    prose.lang = 'zh';
    prose.tabIndex = -1;
    const source = node('span', paragraph.text, 'reader-text');
    source.dataset.annotationSurface = 'read';
    source.dataset.annotationOwner = documentId;
    source.dataset.annotationBlock = paragraph.id;
    prose.append(source);
    section.append(prose);
    rows.set(paragraph.id, { section, prose });

    for (const phrase of paragraph.phrases ?? []) {
      const shortcut = button('Ask about ', () => {
        quoteBlock('read', documentId, paragraph.id, phrase);
      }, 'reader-phrase');
      const phraseText = node('span', phrase);
      phraseText.lang = 'zh';
      shortcut.append(phraseText);
      section.append(shortcut);
    }
    return section;
  }

  function mount(nextDocument) {
    if (documentView?.id === nextDocument.id) return;
    documentView = nextDocument;
    currentParagraphId = nextDocument.paragraphs[0].id;
    rows = new Map();
    title.textContent = nextDocument.title;
    kind.textContent = nextDocument.kind;
    importWarning.textContent = nextDocument.importWarning || '';
    importWarning.hidden = !nextDocument.importWarning;
    picker.value = nextDocument.id;
    passage.replaceChildren(...nextDocument.paragraphs.map((paragraph) => buildParagraph(nextDocument.id, paragraph)));
  }

  function update() {
    if (!state?.reading || !documentView) return;
    const position = state.reading.positions[documentView.id];
    resume.hidden = !position || position === documentView.paragraphs[0].id;
    const saved = state.saved.some(item => item.kind === 'Reading' && (
      item.source === documentView.id || (!documentView.sourceUrl && item.title === documentView.title && !lookup(state, item.source))
    ));
    save.textContent = saved ? 'Reading saved' : 'Save reading';
    save.disabled = busy || saved;
    discuss.disabled = busy;
    importButton.disabled = busy;
    accept.disabled = busy;
    picker.disabled = state.reading.documents.length < 2;
    for (const [id, row] of rows) {
      row.section.classList.toggle('reader-at-place', id === position);
    }
  }

  function focusPassage(paragraphId) {
    const row = rows.get(paragraphId);
    if (!row) return;
    currentParagraphId = paragraphId;
    scrollIntent = 0;
    row.prose.focus({ preventScroll: true });
    const { top } = row.prose.getBoundingClientRect();
    if (top < 0 || top >= window.innerHeight) row.prose.scrollIntoView({ block: 'start' });
  }

  function applyEntry() {
    if (!state?.reading || !active || entered) return;
    entered = true;
    const reading = state.reading;
    const source = lookup(state, reference) || lookup(state, reading.documentId);
    if (!source) return;
    mount(source.document);
    update();
    refreshAnnotations();
    const position = reading.positions[documentView.id];
    const firstParagraphId = documentView.paragraphs[0].id;
    const paragraphId = source.paragraph?.id || position || firstParagraphId;
    currentParagraphId = paragraphId;
    if (source.paragraph || paragraphId !== firstParagraphId) focusPassage(paragraphId);
    if (focusImportedId === documentView.id) {
      focusImportedId = undefined;
      title.focus();
    }
    if (source.annotation) openAnnotation(source.annotation.id);
    if (documentView.id !== reading.documentId) queuePosition(position || firstParagraphId, 0);
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
    window.clearTimeout(positionTimer);
    pendingPosition = { documentId: documentView.id, paragraphId };
    positionTimer = window.setTimeout(() => {
      positionTimer = undefined;
      flushPosition();
    }, delay);
  }

  function trackPosition(event) {
    if (!active || !(event.target instanceof Element)) return;
    if (event.target.closest('#tutor, input, textarea, select, [contenteditable]')) return;
    if (event.type === 'keydown' && event.key === ' ' && event.target.closest('button, a')) return;
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
    const scroller = document.scrollingElement;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) {
      current = documentView.paragraphs.at(-1).id;
    }
    currentParagraphId = current;
    queuePosition(current, 550);
  }, { passive: true });

  return {
    render(nextState) {
      state = nextState;
      if (!state.reading) return;
      if (picker.options.length !== state.reading.documents.length) {
        picker.replaceChildren();
        for (const entry of state.reading.documents) {
          const option = node('option', entry.title);
          option.value = entry.id;
          option.lang = 'zh';
          picker.append(option);
        }
        if (documentView) picker.value = documentView.id;
      }
      if (!documentView) mount(lookup(state, state.reading.documentId).document);
      applyEntry();
      update();
    },
    openImport() {
      setImportOpen(true);
    },
    resetImportFeedback,
    trackImport(submittedUrl) {
      const revision = importRevision;
      return () => revision === importRevision && (!url.value || url.value.trim() === submittedUrl);
    },
    importError(submittedUrl, message, candidate) {
      resetImportFeedback();
      url.value = submittedUrl;
      importError.textContent = message;
      importError.hidden = false;
      setImportOpen(true);
      if (candidate) {
        preview = { url: submittedUrl, token: candidate.token };
        previewTitle.textContent = candidate.title;
        previewExcerpt.textContent = candidate.excerpt;
        previewBox.hidden = false;
        previewTitle.focus();
      }
    },
    imported(submittedUrl, follow) {
      if (url.value.trim() === submittedUrl) url.value = '';
      resetImportFeedback();
      if (follow) {
        setImportOpen(false);
        window.clearTimeout(positionTimer);
        positionTimer = undefined;
        pendingPosition = undefined;
        focusImportedId = state.reading.documentId;
        if (documentView.id === focusImportedId) {
          focusImportedId = undefined;
          title.focus();
        }
        navigate('read', state.reading.documentId);
      }
    },
    title: () => documentView?.title || 'Reading',
    currentReference: () => documentView ? documentView.id + '/' + currentParagraphId : '',
    source: () => {
      const current = documentView && lookup(state, documentView.id + '/' + currentParagraphId);
      return current ? sourceFor(current.document, current.paragraph).slice(0, 12000) : 'Reading';
    },
    openReference(ref) {
      const available = !state || Boolean(lookup(state, ref));
      reference = available ? ref : '';
      entered = false;
      scrollIntent = 0;
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
      scrollIntent = 0;
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
