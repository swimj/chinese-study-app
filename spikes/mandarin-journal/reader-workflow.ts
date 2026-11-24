import { z } from 'zod';
import { activityOutcome, type ActivityStore } from './activity.ts';
import { lookupRequest, resolveLookupRange } from './reader-lookup-input.ts';
import { compareAnswers, type readerLedger } from './reader-ledger.ts';
import type { createLookupService } from './reader-lookup-service.ts';

export class ReaderRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const recheckRequest = z.strictObject({ previousDecisionId: z.uuid() });
const requestSchema = z.union([recheckRequest, lookupRequest]);

export function readerWorkflow(ledger: ReturnType<typeof readerLedger>, service: ReturnType<typeof createLookupService>,
  paragraphs: (documentId: string) => readonly { id: string; text: string }[] | undefined,
  enqueue: (id: string) => void, activity?: ActivityStore) {
  return {
    async lookup(payload: unknown) {
      const parsed = requestSchema.parse(payload);
      let parent = null;
      let request;
      if ('previousDecisionId' in parsed) {
        parent = ledger.get(parsed.previousDecisionId);
        if (!parent) throw new ReaderRequestError(404, 'Lookup decision not found.');
        if (!parent.result.answer || parent.result.route === 'context') {
          throw new ReaderRequestError(409, 'Only a quick answer can be checked in context.');
        }
        request = { documentId: parent.documentId, blockId: parent.blockId, endBlockId: parent.endBlockId,
          kind: parent.input.kind, start: parent.input.start, end: parent.sourceEnd };
      } else {
        request = parsed;
      }
      const { documentId, blockId, endBlockId = blockId } = request;
      const range = resolveLookupRange(request, paragraphs(documentId));
      if (range.error !== undefined) throw new ReaderRequestError(range.status, range.error);
      if (parent && (range.input.text !== parent.input.text || range.input.end !== parent.input.end)) {
        throw new ReaderRequestError(409, 'This passage has changed. Look up the text again.');
      }
      const startedAt = new Date().toISOString();
      const result = await service.lookup(range.input, { documentId, blockId }, parent ? {
        checkInContext: true, suggestedSpan: { start: parent.result.start, end: parent.result.end },
      } : {});
      const id = ledger.record({
        documentId, blockId, endBlockId, sourceEnd: request.end, input: range.input, result, startedAt,
        trigger: parent ? 'check_in_context' : 'gesture',
        ...(parent && { previousDecisionId: parent.id }),
        ...(parent && result.answer && { revision: compareAnswers(parent.result, result) }),
      }, id => activity?.link('Dictionary growth', id));
      activityOutcome(result.route);
      enqueue(id);
      if (parent && !result.answer) throw new ReaderRequestError(503, 'Contextual lookup unavailable. Please retry.');
      return { id, start: result.start, end: result.end - range.lastBlockStart, answer: result.answer, route: result.route,
        canCheckContext: Boolean(result.answer && result.route !== 'context' && service.contextEnabled) };
    },
    flag(id: string) {
      const row = ledger.get(id);
      if (!row) throw new ReaderRequestError(404, 'Lookup decision not found.');
      if (row.result.route !== 'context' || !row.result.answer) throw new ReaderRequestError(409, 'Only a contextual answer can be marked wrong.');
      // A flag may arrive while the original growth pass is running. Its
      // withdrawal has its own cause and must survive a worker restart.
      if (!row.feedback) activity?.link('Dictionary feedback', id);
      ledger.flag(id);
      activityOutcome(row.feedback ? 'Already flagged' : 'Flagged');
      enqueue(id);
      return { id, flagged: true };
    },
  };
}
