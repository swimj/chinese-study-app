import type { VocabularyIntakeStreamEvent } from '../domain/vocabulary-intake';

/** Decode temporary progress and completed replies from an authenticated event stream. */
export async function readVocabularyIntakeStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: VocabularyIntakeStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let completed = false;

  function consume(chunk: string, final = false): boolean {
    buffer += chunk;
    let start = 0;
    const lineEnding = final ? /\r\n|\n|\r/g : /\r\n|\n|\r(?!$)/g;
    for (const match of buffer.matchAll(lineEnding)) {
      const line = buffer.slice(start, match.index);
      start = match.index + match[0].length;
      if (line === '' && data.length) {
        const event = JSON.parse(data.join('\n')) as VocabularyIntakeStreamEvent;
        data = [];
        if (event.type !== 'progress' && event.type !== 'completion' && event.type !== 'done' && event.type !== 'error') {
          throw new Error('Unexpected chat response.');
        }
        if (event.type === 'completion') {
          if (completed || typeof event.assistantText !== 'string' || !Array.isArray(event.cards)) throw new Error('Invalid chat completion.');
          completed = true;
        } else if (event.type === 'progress') {
          if (completed || !['checking','looking_up','preparing_reply'].includes(event.stage)) throw new Error('Invalid chat progress.');
        } else if (event.type === 'done' && !completed) {
          throw new Error('The reply ended without a completion.');
        }
        onEvent(event);
        if (event.type === 'done' || event.type === 'error') return true;
      } else if (line === 'data' || line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    buffer = buffer.slice(start);
    return false;
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (consume(decoder.decode(value, { stream: !done }), done)) return;
      if (done) throw new Error('The reply was interrupted. Try again.');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
