import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { checkReadingSize, ImportError } from './import-validation.ts';
import { readingSourceUrl } from './import-reading.ts';
import type { ReadingState, WebReading } from './reading.ts';

// The import endpoint is the only consumer of this single-learner credential.
export function extensionAuthorized(origin?: string, authorization?: string) {
  const token = process.env.JOURNAL_EXTENSION_TOKEN;
  if (!token || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin ?? '') || !authorization) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization), digest('Bearer ' + token));
}

export const extensionImport = z.strictObject({
  sourceUrl: z.string().trim().min(1).max(4096),
  title: z.string().trim().min(1).max(120),
  paragraphs: z.array(z.strictObject({ text: z.string(), kind: z.literal('heading').optional() })),
});
export type ExtensionImport = z.infer<typeof extensionImport>;

export function importRenderedReading(imports: ReadingState['imports'], input: ExtensionImport) {
  const sourceUrl = readingSourceUrl(input.sourceUrl).href;
  const paragraphs = input.paragraphs
    .map(p => ({ ...p, text: p.text.replace(/\s+/gu, ' ').trim() }))
    .filter(p => p.text);
  checkReadingSize(paragraphs.map(p => p.text));
  if (!paragraphs.some(p => /[\p{L}\p{N}]/u.test(p.text))) {
    throw new ImportError(422, 'No readable text was found on this page.');
  }
  // An earlier import (including a URL or manual paste) may already own annotations.
  // The page title is display metadata. Paragraph boundaries and headings are content.
  const existing = imports.find(doc => doc.sourceUrl === sourceUrl &&
    doc.paragraphs.length === paragraphs.length &&
    doc.paragraphs.every((p, i) => p.text === paragraphs[i].text && p.kind === paragraphs[i].kind));
  if (existing) return { documentId: existing.id, created: false };

  const document: WebReading = {
    id: randomUUID(), sourceUrl, title: input.title, kind: 'Imported reading', importMethod: 'extension',
    paragraphs: paragraphs.map((p, i) => ({ id: 'p' + (i + 1), ...p })),
  };
  imports.push(document);
  return { documentId: document.id, created: true };
}
