// This file runs in the active tab's isolated world. Its result is plain article text.
(async () => {
  if (!['http:', 'https:'].includes(location.protocol)) return { error: 'Open an article in this tab.' };

  const heading = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
  const ignored = [
    'script', 'style', 'noscript', 'template', 'nav', 'aside', 'footer', 'form', 'button', 'iframe',
    'object', 'embed', 'canvas', 'svg', 'math', 'audio', 'video', 'picture', 'select', 'textarea',
    'dialog', '[hidden]', '[inert]', '[aria-hidden="true"]', '[role="navigation"]',
    '[role="banner"]', '[role="complementary"]', '[role="contentinfo"]', '.mw-editsection', '.ws-noexport', '.ws-pagenum',
  ].join(',');
  const paragraph = [
    'address', 'article', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'header',
    'li', 'main', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul',
  ].join(',');
  const clean = value => value.replace(/\s+/gu, ' ').trim();

  function visible(element) {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility === 'visible' && style.contentVisibility !== 'hidden' && style.opacity !== '0';
  }

  const on99csw = /(?:^|\.)99csw\.com$/i.test(location.hostname);
  async function loadChapter(root) {
    function loadingMarker() {
      const marker = root.parentElement?.querySelector(':scope > #cload');
      return marker && marker.getClientRects().length && visible(marker) ? marker : undefined;
    }
    const left = window.scrollX;
    const top = window.scrollY;
    if (!loadingMarker()) return true;
    const deadline = performance.now() + 10_000;
    try {
      while (performance.now() < deadline) {
        const marker = loadingMarker();
        if (!marker) return true;
        // Use the chapter’s own lazy loading through a regular document scroll.
        marker.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      return !loadingMarker();
    } finally {
      window.scrollTo({ left, top, behavior: 'instant' });
    }
  }

  function articleRoot() {
    const candidates = [
      on99csw && '#content',
      '[itemprop~="articleBody"]',
      'main article, [role="main"] article',
      'article',
      '.article-content, .entry-content, .post-content, #article-content',
      'main, [role="main"], #content',
    ].filter(Boolean);
    for (const selector of candidates) {
      let best;
      let length = 0;
      for (const element of document.querySelectorAll(selector)) {
        if (element.closest(ignored) || !visible(element)) continue;
        const size = element.innerText.trim().length;
        if (size > length) {
          best = element;
          length = size;
        }
      }
      if (best) return best;
    }
    return document.body;
  }

  function findHeading(root) {
    if (!root) return '';
    const primaryHeading = on99csw && root.id === 'content' ? ':scope > h2.h2, h1' : 'h1';
    const candidates = root.matches('h1') ? [root] : root.querySelectorAll(primaryHeading);
    for (const element of candidates) {
      if (element.getClientRects().length && !element.closest(ignored) && visible(element)) {
        const text = clean(element.innerText);
        if (text) return text;
      }
    }
    return '';
  }

  function gather(root, selection) {
    const blocks = [];
    const position = document.createRange();
    let parts = [];
    let first = null;
    let currentHeading = false;

    function flush() {
      const text = clean(parts.join(''));
      if (text) {
        const { node, offset } = first;
        position.setStart(node, offset);
        position.setEnd(node, offset + 1);
        const { top, left } = position.getBoundingClientRect();
        if (position.getClientRects().length) {
          blocks.push({ top, left, value: currentHeading ? { text, kind: 'heading' } : { text } });
        }
      }
      parts = [];
      first = null;
    }

    function visit(node) {
      if (selection && !selection.intersectsNode(node)) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const start = selection?.startContainer === node ? selection.startOffset : 0;
        const end = selection?.endContainer === node ? selection.endOffset : node.length;
        const text = node.nodeValue.slice(start, end);
        const offset = text.search(/\S/u);
        if (!first && offset >= 0) first = { node, offset: start + offset };
        parts.push(text);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return;
      // An explicit selection can include text outside the main article, such as a sidebar.
      if (selection ? node.matches('script,style,noscript,template,[hidden]') : node.matches(ignored)) return;
      const isHeading = node.matches(heading);
      const boundary = isHeading || node.matches(paragraph) || node.matches('br,hr');
      if (boundary) flush();
      const parentHeading = currentHeading;
      if (isHeading) currentHeading = true;
      for (const child of node.childNodes) visit(child);
      if (boundary) flush();
      currentHeading = parentHeading;
    }

    currentHeading = Boolean(root.parentElement?.closest(heading));
    visit(root);
    flush();
    // Some readers set CSS order independently of the DOM. Use rendered positions.
    blocks.sort((a, b) => a.top - b.top || a.left - b.left);
    return blocks.map(block => block.value);
  }

  const selection = getSelection();
  const range = selection?.rangeCount && !selection.isCollapsed && selection.toString().trim()
    ? selection.getRangeAt(0)
    : undefined;
  const start = range?.commonAncestorContainer;
  const root = range ? (start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement) : articleRoot();
  if (!root) return { error: 'The page has not loaded. Try again when the article appears.' };

  const source = new URL(location.href);
  source.hash = '';
  if (!range && on99csw && root.id === 'content') {
    if (!await loadChapter(root)) {
      return { error: 'The full chapter has not loaded. Scroll to the end of the chapter, or select the passage and try again.' };
    }
    if (!root.isConnected) return { error: 'The page changed while loading. Open the extension again.' };
  }
  const pageTitle = document.title.trim() || findHeading(root) || location.hostname;
  const title = pageTitle.slice(0, 120).replace(/[\uD800-\uDBFF]$/, '');
  const paragraphs = gather(root, range);
  if (!range && paragraphs[0]?.kind === 'heading' && paragraphs[0].text === clean(pageTitle)) paragraphs.shift();

  return { reading: { sourceUrl: source.href, title, paragraphs } };
})();
