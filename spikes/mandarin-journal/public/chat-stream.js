// A completed journal snapshot acknowledges the turn. Deltas are only a preview.
export async function readChatStream(response, append) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('The reply was interrupted. Retry to recover this turn.');
      buffer += value;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const event = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (event.type === 'done' && event.state?.threads) return event.state;
        if (event.type === 'error') {
          const error = new Error(event.error);
          error.status = event.status;
          throw error;
        }
        if (event.type !== 'delta' || typeof event.text !== 'string') throw new Error('Unexpected conversation update.');
        append(event.text);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
