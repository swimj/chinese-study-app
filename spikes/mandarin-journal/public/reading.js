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

export function isReadingFinished(document, paragraphId) {
  return paragraphId !== undefined && document.paragraphs.at(-1)?.id === paragraphId;
}

export function referenceForSource(state, source) {
  if (!source) return '';
  if (lookup(state, source)) return source;
  return state?.reading?.documents.find((entry) => source.includes(entry.title))?.id || '';
}

export function importedDocument(document) {
  return Boolean(document.sourceUrl) || document.importMethod === 'pdf';
}

function sourceFor(document, paragraph) {
  const paragraphs = paragraph ? [paragraph] : document.paragraphs;
  return [document.title, ...paragraphs.map((entry) => entry.text)].join('\n');
}

export function createReading({
  host, importPanel, submit, canSubmit, getPending, retryPending, discussInChinese, openImported, openAnnotation, refreshAnnotations,
}) {
  let state;
  let documentView;
  let rows = new Map();
  let active = false;
  let busy = true;
  const pendingPositions = new Map();
  let positionTimer;
  let scrollIntent = 0;
  let currentParagraphId;
  let importRevision = 0;
  let preview;
  let pasteUrl;
  let extractingPdf = false;

  const back = node('a', undefined, 'reader-home');
  const backLabel = node('span', 'Home');
  const arrow = node('span', '←');
  arrow.setAttribute('aria-hidden', 'true');
  back.append(arrow, backLabel);
  back.href = '#home';
  const title = node('h1');
  title.lang = 'zh';
  title.tabIndex = -1;
  const kind = node('p', '', 'small folio');
  const pdfFile = node('input');
  pdfFile.type = 'file';
  pdfFile.accept = 'application/pdf,.pdf';
  pdfFile.hidden = true;
  const uploadPdf = button('Upload PDF', () => pdfFile.click(), 'text-button');
  const pdfStatus = node('p', '', 'notice');
  pdfStatus.setAttribute('role', 'status');
  pdfStatus.hidden = true;
  const pdfPages = node('progress');
  pdfPages.setAttribute('aria-label', 'PDF pages read');
  pdfPages.hidden = true;
  function pdfMessage(message) {
    pdfStatus.textContent = message;
    pdfStatus.hidden = !message;
    pdfPages.hidden = true;
  }
  pdfFile.onchange = async () => {
    const file = pdfFile.files[0];
    pdfFile.value = '';
    if (!file || !canSubmit()) return;
    resetImportFeedback();
    const revision = importRevision;
    extractingPdf = true;
    update();
    pdfMessage('Reading PDF…');
    try {
      const { readPdf } = await import('./pdf-import.js');
      const document = await readPdf(file, (count, total) => {
        if (revision !== importRevision) return;
        pdfPages.max = total;
        pdfPages.value = count;
        pdfPages.hidden = false;
      });
      if (revision !== importRevision) return;
      if (!canSubmit()) {
        pdfMessage('Finish the current action, then choose the PDF again.');
        return;
      }
      pdfMessage('');
      extractingPdf = false;
      await submit({ type: 'importPdf', ...document });
    } catch (err) {
      if (revision === importRevision) pdfMessage(err.message || 'Could not read this PDF.');
    } finally {
      if (revision === importRevision) {
        extractingPdf = false;
        update();
      }
    }
  };
  const importForm = node('form', undefined, 'reader-import');
  importForm.id = 'reader-import-form';
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
  const pasteToggle = button('Paste article text', () => openPaste(url.value.trim()), 'secondary');
  pasteToggle.hidden = true;
  const pasteBox = node('div', undefined, 'reader-import-paste');
  pasteBox.hidden = true;
  const pasteLabel = node('label', 'Article text');
  const pastedText = node('textarea');
  pastedText.id = 'reader-pasted-text';
  pasteLabel.htmlFor = pastedText.id;
  pastedText.rows = 8;
  const pasteSave = node('button', 'Import pasted text', 'primary');
  pasteSave.type = 'submit';
  pasteSave.dataset.mutation = '';
  pasteBox.append(pasteLabel, pastedText, pasteSave);
  function openPaste(source) {
    if (pasteUrl !== source) pastedText.value = '';
    pasteUrl = source;
    url.value = source;
    pasteBox.hidden = false;
    importButton.hidden = true;
    pasteToggle.hidden = true;
    previewBox.hidden = true;
    pastedText.required = true;
    pastedText.focus();
  }
  function resetImportFeedback() {
    importRevision++;
    extractingPdf = false;
    pdfMessage('');
    preview = undefined;
    pasteUrl = undefined;
    pasteBox.hidden = true;
    pasteToggle.hidden = true;
    pastedText.value = '';
    pastedText.required = false;
    pastedText.setCustomValidity('');
    importButton.hidden = false;
    previewBox.hidden = true;
    importError.hidden = true;
    update();
  }
  importLine.append(url, importButton);
  importForm.append(urlLabel, importLine, importError, pasteToggle, previewBox, pasteBox);
  importForm.onsubmit = event => {
    event.preventDefault();
    if (!canSubmit()) return;
    if (!pasteBox.hidden && pasteUrl === url.value.trim()) {
      const text = pastedText.value.trim();
      if (!text || text.length > 120000) {
        pastedText.setCustomValidity(text ? 'Choose up to 120,000 characters to import.' : 'Paste the article text first.');
        pastedText.reportValidity();
        return;
      }
      submit({ type: 'importReading', url: pasteUrl, pastedText: text });
      return;
    }
    resetImportFeedback();
    submit({ type: 'importReading', url: url.value.trim() });
  };
  pastedText.oninput = () => {
    pastedText.setCustomValidity('');
    importRevision++;
  };
  url.oninput = resetImportFeedback;
  const pdfTools = node('div', undefined, 'home-import-pdf');
  pdfTools.append(uploadPdf, pdfFile, pdfStatus, pdfPages);
  const importProgress = node('div', undefined, 'reader-import-progress');
  const importStatus = node('span');
  importStatus.setAttribute('role', 'status');
  const retryImport = button('Retry', () => retryPending(), 'text-button');
  retryImport.dataset.turnRetry = '';
  importProgress.append(importStatus, retryImport);
  importProgress.hidden = true;
  importPanel.append(importForm, pdfTools, importProgress);

  const save = button('Save reading', () => {
    if (!documentView) return;
    submit({
      type: 'saveReading',
      title: documentView.title,
      detail: importedDocument(documentView) ? documentView.title : documentView.paragraphs.map((entry) => entry.text).join('\n'),
      source: documentView.id,
    });
  });
  const discuss = button('Discuss in Chinese', () => {
    if (!documentView) return;
    discussInChinese({
      title: documentView.title,
      source: importedDocument(documentView) ? documentView.id : sourceFor(documentView),
    });
  });
  const resume = button('Go to saved place', () => {
    focusPassage(state.reading.positions[documentView.id]);
  }, 'reader-resume');
  resume.hidden = true;
  const tools = node('div', undefined, 'tools reader-tools');
  tools.append(discuss, save, resume);
  const passage = node('div', undefined, 'passage reader-passage');
  const importWarning = node('p', '', 'notice');
  importWarning.hidden = true;
  const pasteHistorical = node('a', 'Paste article text', 'secondary');
  pasteHistorical.hidden = true;
  const progress = node('progress', undefined, 'reader-progress');
  progress.max = 1;
  progress.value = 0;
  progress.setAttribute('aria-label', 'Reading position');
  const scroller = node('div', undefined, 'reader-scroll');
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', 'Reading passage');
  const sheet = node('article', undefined, 'reader-sheet');
  sheet.append(kind, title, importWarning, pasteHistorical, passage, tools);
  scroller.append(sheet);
  const returnControl = node('div', undefined, 'reader-return');
  returnControl.append(back, progress);
  host.replaceChildren(returnControl, scroller);
  function updateProgress() {
    if (!active) return;
    const distance = scroller.scrollHeight - scroller.clientHeight;
    progress.value = distance > 0 ? Math.max(0, Math.min(1, scroller.scrollTop / distance)) : 1;
  }
  const resize = new ResizeObserver(updateProgress);
  resize.observe(scroller);
  resize.observe(sheet);

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
    rows.set(paragraph.id, prose);

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
    pasteHistorical.hidden = !nextDocument.canPaste;
    if (nextDocument.canPaste) pasteHistorical.href = '#home/import/' + encodeURIComponent(nextDocument.id);
    passage.replaceChildren(...nextDocument.paragraphs.map((paragraph) => buildParagraph(nextDocument.id, paragraph)));
  }

  function update() {
    if (!state?.reading) return;
    const { action, busy: sending, error } = getPending();
    const importing = action?.type === 'importPdf' || action?.type === 'importReading';
    importProgress.hidden = !importing;
    retryImport.hidden = !importing || sending;
    let status = '';
    if (importing) {
      if (!sending) status = error || 'Import interrupted.';
      else if (action.type === 'importPdf') status = 'Saving “' + action.title + '”…';
      else if (action.pastedText !== undefined || action.acceptPreview) status = 'Saving reading…';
      else status = 'Opening reading…';
      if (action.type === 'importReading' && action.url !== url.value.trim()) status += ' ' + action.url;
    }
    if (importStatus.textContent !== status) importStatus.textContent = status;
    const blocked = busy || Boolean(action) || extractingPdf;
    importButton.disabled = blocked;
    uploadPdf.disabled = blocked;
    accept.disabled = blocked;
    pasteToggle.disabled = blocked;
    pasteSave.disabled = blocked;

    if (!documentView) return;
    const position = state.reading.positions[documentView.id];
    resume.hidden = !position || position === documentView.paragraphs[0].id || isReadingFinished(documentView, position);
    const saved = state.saved.some(item => item.kind === 'Reading' && (
      item.source === documentView.id || (!importedDocument(documentView) && item.title === documentView.title && !lookup(state, item.source))
    ));
    save.textContent = saved ? 'Reading saved' : 'Save reading';
    save.disabled = busy || saved;
    discuss.disabled = busy;
  }

  function focusPassage(paragraphId) {
    const prose = rows.get(paragraphId);
    if (!prose) return;
    currentParagraphId = paragraphId;
    scrollIntent = 0;
    prose.focus({ preventScroll: true });
    prose.scrollIntoView({ block: 'start' });
  }

  function enter(reference, fromLibrary) {
    active = true;
    scrollIntent = 0;
    backLabel.textContent = fromLibrary ? 'Library' : 'Home';
    back.href = fromLibrary ? '#library' : '#home';
    const source = lookup(state, reference);
    scroller.hidden = progress.hidden = !source;
    if (!source) {
      documentView = undefined;
      passage.replaceChildren();
      flushPosition();
      return false;
    }
    mount(source.document);
    update();
    refreshAnnotations();
    const bookmark = pendingPositions.get(documentView.id) || state.reading.positions[documentView.id];
    const firstParagraphId = documentView.paragraphs[0].id;
    const position = rows.has(bookmark) ? bookmark : firstParagraphId;
    const paragraphId = source.paragraph?.id || position;
    currentParagraphId = paragraphId;
    scroller.scrollTop = 0;
    if (source.paragraph || paragraphId !== firstParagraphId) focusPassage(paragraphId);
    else title.focus({ preventScroll: true });
    updateProgress();
    if (source.annotation) openAnnotation(source.annotation.id);
    queuePosition(position, 0);
    return true;
  }

  function flushPosition() {
    if (!canSubmit()) return;
    for (const [documentId, paragraphId] of pendingPositions) {
      // Opening a one-paragraph piece already places the reader at its end.
      // Keep that bookmark pending until they leave the piece.
      if (active && documentView?.id === documentId && documentView.paragraphs.length === 1) continue;
      pendingPositions.delete(documentId);
      if (state.reading.positions[documentId] === paragraphId) continue;
      submit({ type: 'readingPosition', documentId, paragraphId });
      break;
    }
  }

  function queuePosition(paragraphId, delay) {
    window.clearTimeout(positionTimer);
    pendingPositions.delete(documentView.id);
    pendingPositions.set(documentView.id, paragraphId);
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

  scroller.addEventListener('wheel', trackPosition, { passive: true });
  scroller.addEventListener('touchmove', trackPosition, { passive: true });
  scroller.addEventListener('keydown', (event) => {
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(event.key)) trackPosition(event);
  });
  scroller.addEventListener('pointerdown', event => {
    if (event.target === scroller) trackPosition(event);
  });
  scroller.addEventListener('scroll', () => {
    updateProgress();
    if (!active || performance.now() > scrollIntent || !documentView) return;
    const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
    let current = documentView.paragraphs[0].id;
    for (const [id, prose] of rows) {
      if (prose.getBoundingClientRect().top > line) break;
      current = id;
    }
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
      update();
    },
    openImport(prefill, repairId, startImport = false) {
      if (!importPanel.open) importPanel.showModal();
      const repair = repairId && lookup(state, repairId)?.document;
      if (repair?.canPaste) openPaste(repair.sourceUrl);
      else {
        const { action } = getPending();
        if (prefill && prefill !== url.value) {
          resetImportFeedback();
          url.value = prefill;
        } else if (action?.type === 'importReading' && !url.value) {
          url.value = action.url;
          if (action.pastedText !== undefined) {
            openPaste(action.url);
            pastedText.value = action.pastedText;
          }
        }
        (preview ? previewTitle : pasteBox.hidden ? url : pastedText).focus();
        if (startImport && pasteBox.hidden && !preview && importError.hidden) importForm.requestSubmit();
      }
    },
    closeImport() {
      if (importPanel.open) importPanel.close();
      if (extractingPdf) {
        importRevision++;
        extractingPdf = false;
        pdfMessage('');
        update();
      }
    },
    pdfMessage,
    trackImport(action) {
      const revision = importRevision;
      return () => importPanel.open && revision === importRevision &&
        (action.type === 'importPdf' || (url.value.trim() === action.url &&
          (action.pastedText === undefined || pastedText.value.trim() === action.pastedText)));
    },
    importError(submittedUrl, message, candidate, canPaste, submittedText) {
      if (submittedText !== undefined) {
        openPaste(submittedUrl);
        pastedText.value = submittedText;
        importError.textContent = message;
        importError.hidden = false;
        return;
      }
      resetImportFeedback();
      pasteToggle.hidden = !canPaste;
      url.value = submittedUrl;
      importError.textContent = message;
      importError.hidden = false;
      if (candidate) {
        preview = { url: submittedUrl, token: candidate.token };
        previewTitle.textContent = candidate.title;
        previewExcerpt.textContent = candidate.excerpt;
        previewBox.hidden = false;
        previewTitle.focus();
      }
    },
    imported(documentId) {
      resetImportFeedback();
      url.value = '';
      openImported(documentId);
    },
    documentId: () => documentView?.id,
    title: () => documentView?.title || 'Reading',
    currentReference: () => documentView ? documentView.id + '/' + currentParagraphId : '',
    source: () => {
      const current = documentView && lookup(state, documentView.id + '/' + currentParagraphId);
      return current ? sourceFor(current.document, current.paragraph).slice(0, 12000) : 'Reading';
    },
    enter,
    leave() {
      active = false;
      scrollIntent = 0;
      window.clearTimeout(positionTimer);
      positionTimer = undefined;
      flushPosition();
    },
    setBusy(value) {
      busy = value;
      update();
      if (!busy && positionTimer === undefined) flushPosition();
    },
  };
}
