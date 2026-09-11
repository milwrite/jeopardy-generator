import assert from 'node:assert/strict';
import test from 'node:test';

import { readGeneratedBoardStream } from '../src/generationProgress';

test('retains the model reported by a generated-board response', async () => {
  const content = JSON.stringify({ categories: [] });
  const response = new Response(JSON.stringify({
    model: 'provider/resolved-model',
    choices: [{ message: { content } }],
  }));

  const result = await readGeneratedBoardStream(response, 'openrouter', () => {});

  assert.equal(result.content, content);
  assert.equal(result.model, 'provider/resolved-model');
});

const encode = (text: string) => new TextEncoder().encode(text);
function openStream(text: string) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode(text)); }, cancel() { cancelled = true; } });
  return { response: new Response(body), cancelled: () => cancelled };
}
const event = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`;
const delta = (content: string) => event({ choices: [{ delta: { content } }] });

test('DONE completes and cancels an HTTP stream that never closes', async () => {
  const stream = openStream(delta('{"categories":[]}') + 'data: [DONE]\n\n');
  const result = await readGeneratedBoardStream(stream.response, 'openrouter', () => {}, { idleTimeoutMs: 20 });
  assert.equal(result.content, '{"categories":[]}');
  assert.equal(stream.cancelled(), true);
});

test('stop finishes without waiting for a DONE event', async () => {
  const stream = openStream(event({ choices: [{ delta: { content: 'complete' }, finish_reason: 'stop' }] }));
  assert.equal((await readGeneratedBoardStream(stream.response, 'openrouter', () => {}, { idleTimeoutMs: 20 })).content, 'complete');
});

test('Ollama done terminates a persistent connection', async () => {
  const stream = openStream(JSON.stringify({ message: { content: 'complete' }, done: true }) + '\n');
  assert.equal((await readGeneratedBoardStream(stream.response, 'ollama', () => {}, { idleTimeoutMs: 20 })).content, 'complete');
});

test('length truncation is rejected even with partial content', async () => {
  const stream = openStream(delta('partial') + event({ choices: [{ delta: {}, finish_reason: 'length' }] }));
  await assert.rejects(readGeneratedBoardStream(stream.response, 'openrouter', () => {}), /output limit/);
  assert.equal(stream.cancelled(), true);
});

test('idle response fails and releases the reader', async () => {
  const stream = openStream(': heartbeat\n');
  await assert.rejects(readGeneratedBoardStream(stream.response, 'openrouter', () => {}, { idleTimeoutMs: 10 }), /stopped responding/);
  assert.equal(stream.response.body?.locked, false);
});

test('user cancellation interrupts a pending read', async () => {
  const stream = openStream(delta('partial'));
  const controller = new AbortController();
  const pending = readGeneratedBoardStream(stream.response, 'openrouter', () => {}, { signal: controller.signal });
  controller.abort(new Error('Cancelled by user'));
  await assert.rejects(pending, /Cancelled by user/);
  assert.equal(stream.cancelled(), true);
});

test('split UTF-8 and SSE events preserve content and model', async () => {
  const bytes = encode(event({ model: 'actual-model', choices: [{ delta: { content: 'café 🌍' } }] }) + 'data: [DONE]\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of Array.from(bytes)) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  assert.deepEqual(await readGeneratedBoardStream(new Response(body), 'openrouter', () => {}), { content: 'café 🌍', model: 'actual-model' });
});

test('pretty printed non-stream JSON preserves reported model', async () => {
  const response = new Response(JSON.stringify({ model: 'actual', choices: [{ message: { content: 'board' } }] }, null, 2));
  assert.deepEqual(await readGeneratedBoardStream(response, 'openrouter', () => {}), { content: 'board', model: 'actual' });
});

test('provider error is not swallowed after partial output', async () => {
  const stream = openStream(delta('partial') + event({ error: { message: 'Provider failed' } }));
  await assert.rejects(readGeneratedBoardStream(stream.response, 'openrouter', () => {}), /Provider failed/);
});
