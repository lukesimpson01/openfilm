/** OpenAI-compatible model responses can carry either a string or a structured error. */
export function modelError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

/** Preserve complete SSE lines across network chunks and surface provider failures. */
export async function readModelStream(body: ReadableStream<Uint8Array>, onDelta: (text: string) => void) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', output = '', finished = false;
  function line(raw: string) {
    if (!raw.startsWith('data:')) return;
    const data = raw.slice(5).trim();
    if (data === '[DONE]') { finished = true; return; }
    if (!data) return;
    let event;
    try { event = JSON.parse(data); } catch { throw new Error('The model sent an unreadable response. Please retry.'); }
    if (event.error) throw new Error(modelError(event, 'The model stopped before completing its response.'));
    const choice = event.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('The model reached its response limit. Completed edits are saved; ask it to continue.');
    const content = choice?.delta?.content;
    if (typeof content === 'string' && content) { output += content; onDelta(output); }
  }
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const raw of lines) { line(raw); if (finished) break; }
      if (done) { if (!finished && buffer.trim()) line(buffer); break; }
    }
    return output;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
