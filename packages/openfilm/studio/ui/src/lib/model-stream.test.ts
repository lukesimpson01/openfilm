import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelError, readModelStream } from './model-stream.ts';

const body = (...parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const part of parts) c.enqueue(new TextEncoder().encode(part)); c.close(); } });
test('structured provider errors show their message, never [object Object]', () => {
  assert.equal(modelError({ error: { code: 'PROVIDER_CREDITS_EXHAUSTED', message: 'The configured model provider has no remaining credits.' } }, 'Fallback'), 'The configured model provider has no remaining credits.');
  assert.equal(modelError({ error: 'Unavailable' }, 'Fallback'), 'Unavailable');
  assert.equal(modelError({ error: { code: 500 } }, 'Fallback'), 'Fallback');
});
test('model streaming joins split lines and accepts an unterminated final line', async () => {
  const deltas: string[] = [];
  assert.equal(await readModelStream(body('data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\r\n\r\ndata:{"choices":[{"delta":{"content":" world"}}]}'), text => deltas.push(text)), 'Hello world');
  assert.deepEqual(deltas, ['Hello', 'Hello world']);
});
test('SSE errors and response limits fail instead of reporting partial output as success', async () => {
  await assert.rejects(readModelStream(body('data: {"error":{"message":"Quota reached"}}\n\n'), () => {}), /Quota reached/);
  await assert.rejects(readModelStream(body('data: {"choices":[{"finish_reason":"length"}]}\n'), () => {}), /response limit/);
  await assert.rejects(readModelStream(body('data: {invalid}\n'), () => {}), /unreadable response/);
});
test('DONE releases the stream and ignores subsequent events', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: [DONE]\n\ndata: {"error":"late"}\n')); }, cancel() { cancelled = true; } });
  assert.equal(await readModelStream(stream, () => {}), '');
  assert.equal(cancelled, true);
});
