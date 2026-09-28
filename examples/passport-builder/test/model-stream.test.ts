import test from 'node:test';
import assert from 'node:assert/strict';
import { modelTextStream, readModelSse, ModelServiceError } from '../service/model-stream.js';

const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const stopped = event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\r\n\r\n';
function body(text: string, width = 3) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width)); controller.close(); } });
}
async function collect(stream: AsyncIterable<string>) { let out = ''; for await (const delta of stream) out += delta; return out; }
test('streaming survives split UTF-8 and CRLF, role chunks, comments, and usage metadata', async () => {
  const stream = ': heartbeat\r\n\r\n' + event({ choices: [{ delta: { role: 'assistant' } }] }) + event({ choices: [{ delta: { content: 'a🌙' } }] }) + event({ choices: [], usage: { completion_tokens: 8 } }) + stopped;
  assert.equal(await collect(readModelSse(body(stream, 1))), 'a🌙');
});
test('an interrupted or refused stream cannot be mistaken for a complete application', async () => {
  for (const stream of [event({ choices: [{ delta: { content: '{"files":{}}' } }] }), event({ error: { message: 'provider failed' } }), event({ choices: [{ finish_reason: 'length' }] }) + stopped, 'data: broken\n\n']) {
    await assert.rejects(collect(readModelSse(body(stream))), ModelServiceError);
  }
});
test('provider failures make one request and never enter a transport retry loop', async () => {
  let attempts = 0;
  await assert.rejects(collect(modelTextStream({ model: 'openai/gpt-6-luna-pro:nitro', instructions: 'JSON', prompt: 'Build.' }, (async () => { attempts++; return new Response('', { status: 429 }); }) as typeof fetch)), /HTTP 429/);
  assert.equal(attempts, 1);
});
