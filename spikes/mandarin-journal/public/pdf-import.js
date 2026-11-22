const maxChars = 120_000;
const maxParagraphs = 2_000;
const maxPages = 300;
const maxBytes = 20 * 1024 * 1024;
const tooMuchText = 'Choose up to 2,000 paragraphs and 120,000 characters per reading.';
class PdfImportError extends Error {}

const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff01-\uff65]/u;
const endsInCjk = new RegExp(cjk.source + '$', 'u');
const startsInCjk = new RegExp('^' + cjk.source, 'u');
function joinLines(before, after) {
  if (endsInCjk.test(before) || startsInCjk.test(after) || /[-‐‑]$/.test(before)) return '';
  return ' ';
}

export async function extractParagraphs(pdf) {
  if (pdf.numPages > maxPages) throw new PdfImportError('Choose a PDF with 300 pages or fewer.');
  const paragraphs = [];
  let chars = 0, rawChars = 0, itemsRead = 0;
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    let parts = [], first = null, lastLine = null, lines = [], lastText = '';
    function endParagraph() {
      if (lines.length) {
        if (paragraphs.length >= maxParagraphs) throw new PdfImportError(tooMuchText);
        paragraphs.push(lines.join(''));
      }
      lines = [];
      lastLine = null;
      lastText = '';
    }
    function endLine() {
      const text = parts.join('').trim().replace(/\s+/gu, ' ')
        .replace(/(?<=[\p{Script=Han}\u3000-\u303f\uff01-\uff65]) (?=[\p{Script=Han}\u3000-\u303f\uff01-\uff65])/gu, '');
      if (text) {
        if (lastLine) {
          const em = Math.max(first.size, lastLine.size);
          const gap = Math.abs(first.baseline - lastLine.baseline);
          // Extra leading, first-line indentation, and changes in type size mark blocks.
          if (gap > 1.7 * em || first.start - lastLine.start > 1.25 * em ||
              em > 1.25 * Math.min(first.size, lastLine.size)) endParagraph();
        }
        const separator = lines.length ? joinLines(lastText, text) : '';
        chars += separator.length + text.length;
        if (chars > maxChars) throw new PdfImportError(tooMuchText);
        lines.push(separator, text);
        lastLine = first;
        lastText = text;
      } else {
        endParagraph();
      }
      parts = [];
      first = null;
    }
    try {
      for await (const chunk of page.streamTextContent()) {
        for (const item of chunk.items) {
          if (typeof item.str !== 'string') continue;
          rawChars += item.str.length;
          // Bound intermediate work even when a file consists of whitespace or empty runs.
          if (rawChars > 4 * maxChars || ++itemsRead > 4 * maxChars) throw new PdfImportError(tooMuchText);
          if (item.str.trim()) {
            const vertical = item.dir === 'ttb';
            const baseline = item.transform[vertical ? 4 : 5];
            const size = Math.max(1, Math.hypot(item.transform[2], item.transform[3]));
            if (first && Math.abs(first.baseline - baseline) > 0.7 * Math.max(size, first.size)) endLine();
            first ??= { baseline, start: item.transform[vertical ? 5 : 4], size };
          }
          parts.push(item.str);
          if (item.hasEOL) endLine();
        }
      }
      if (parts.length) endLine();
      endParagraph();
    } finally {
      page.cleanup();
    }
  }
  if (!paragraphs.length)
    throw new PdfImportError('No selectable text was found. Choose a searchable PDF or run OCR on a copy and import it.');
  return paragraphs;
}

export async function readPdf(file) {
  if (file.size > maxBytes) throw new PdfImportError('Choose a PDF of 20 MiB or less.');
  if (!file.size) throw new PdfImportError('This file is empty. Choose a PDF with selectable text.');
  let task;
  try {
    const { getDocument, GlobalWorkerOptions } = await import('/pdfjs/pdf.mjs');
    GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
    const data = await file.arrayBuffer();
    // PDF.js transfers the original buffer to its worker.
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const fingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    task = getDocument({
      data,
      cMapUrl: '/pdfjs/cmaps/',
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      useWorkerFetch: true,
      useWasm: false,
      disableWorkerRendering: true,
      stopAtErrors: true,
    });
    const pdf = await task.promise;
    const paragraphs = await extractParagraphs(pdf);
    const title = (file.name.replace(/\.pdf$/i, '').replace(/\s+/gu, ' ').trim() || 'PDF reading')
      .slice(0, 120).replace(/[\uD800-\uDBFF]$/, '');
    return { title, paragraphs, fingerprint };
  } catch (err) {
    if (err instanceof PdfImportError) throw err;
    if (err?.name === 'PasswordException') throw new PdfImportError('This PDF needs a password. Choose an unlocked copy.');
    throw new PdfImportError('This PDF could not be read. Try opening it in a PDF reader and saving a new copy.');
  } finally {
    await task?.destroy();
  }
}
