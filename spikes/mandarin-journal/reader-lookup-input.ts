import { z } from 'zod';
import type { LookupInput } from './reader-dictionary.ts';

export const lookupRequest = z.strictObject({
  documentId: z.string().min(1).max(256), blockId: z.string().min(1).max(256), endBlockId: z.string().min(1).max(256).optional(),
  kind: z.enum(['tap','selection']), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
});

export function validFocus(input: LookupInput) {
  const focus = input.text.slice(input.start,input.end);
  return input.start < input.end && input.end <= input.text.length && !!focus.trim() &&
    !/[\uD800-\uDFFF]/u.test(focus) && (input.kind === 'selection' || [...focus].length === 1);
}

export function resolveLookupRange(request: z.infer<typeof lookupRequest>, paragraphs?: readonly { id:string; text:string }[]) {
  const { blockId, endBlockId = blockId, kind, start, end } = request;
  const first = paragraphs?.findIndex(p => p.id === blockId) ?? -1;
  const last = paragraphs?.findIndex(p => p.id === endBlockId) ?? -1;
  if (!paragraphs || first < 0 || last < 0) {
    return { status:404, error:'Reading passage not found.' } as const;
  }
  if (last < first || (first !== last && kind === 'tap') ||
      start > paragraphs[first].text.length || end > paragraphs[last].text.length) {
    return { status:400, error:'Invalid lookup range.' } as const;
  }
  const text = paragraphs.slice(first, last + 1).map(p => p.text).join('\n');
  const lastBlockStart = text.length - paragraphs[last].text.length;
  const input = { kind, start, text, end:lastBlockStart + end };
  if (!validFocus(input)) return { status:400, error:'Invalid lookup range.' } as const;
  return { input, lastBlockStart };
}
