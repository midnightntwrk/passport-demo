import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { generationEvent, streamGeneration } from '../service/generation-stream.js';
import type { GenerationProgress, GenerationStreamEvent } from '../shared/generation.js';

const progress = (sequence: number, text: string, status: GenerationProgress['status'] = 'streaming'): GenerationProgress => ({
  runId: 'generation-one', attempt: 1, sequence, status, files: { 'src/App.tsx': text }, completedFiles: status === 'complete' ? ['src/App.tsx'] : [], activeFile: 'src/App.tsx', updatedAt: new Date().toISOString(),
});

test('coalesced updates append only new source and preserve exact unicode and escaped text', () => {
  const before = progress(3, 'const moon = "🌙";\n');
  const after = progress(10, before.files['src/App.tsx'] + 'export default () => <p>hello</p>;\n');
  const event = generationEvent(before, after);
  assert.equal(event.type, 'update');
  if (event.type !== 'update') return;
  assert.equal(event.baseSequence, 3); assert.equal(event.progress.sequence, 10);
  assert.deepEqual(event.patches, [{ path: 'src/App.tsx', offset: before.files['src/App.tsx'].length, text: 'export default () => <p>hello</p>;\n' }]);
  const received = JSON.parse(JSON.stringify(event)) as typeof event;
  assert.equal(before.files['src/App.tsx'].slice(0, received.patches[0].offset) + received.patches[0].text, after.files['src/App.tsx']);
  const replaced = generationEvent(after, progress(11, 'fixed'));
  assert.equal(replaced.type === 'update' && replaced.patches[0].offset, 0);
  assert.equal(generationEvent(after, { ...after, runId: 'repair-two' }).type, 'snapshot');
  assert.equal(generationEvent(after, { ...after, files: {} }).type, 'snapshot');
});

function lines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(); const decoder = new TextDecoder(); let pending = '';
  return {
    async next(): Promise<GenerationStreamEvent | undefined> {
      while (!pending.includes('\n')) {
        const part = await reader.read();
        if (part.done) return undefined;
        pending += decoder.decode(part.value, { stream: true });
      }
      const index = pending.indexOf('\n'); const raw = pending.slice(0, index); pending = pending.slice(index + 1);
      return JSON.parse(raw);
    },
    cancel: () => reader.cancel(),
  };
}

test('HTTP streams reconnect with current source, reject revoked sessions before sending more code, and detach cleanly', { timeout: 5000 }, async () => {
  let current = progress(0, 'export'); let active = true; let authorised = true; let closed = 0;
  const server = createServer((_req, res) => streamGeneration(res, {
    current: () => current, active: () => active,
    authorise: () => { if (!authorised) throw Object.assign(new Error('Sign in again.'), { status: 401 }); },
    onClose: () => { closed++; }, intervalMs: 5, heartbeatMs: 20,
  }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(url);
    assert.match(response.headers.get('content-type')!, /application\/x-ndjson/);
    assert.match(response.headers.get('cache-control')!, /no-transform/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const first = lines(response.body!);
    assert.deepEqual(await first.next(), { type: 'snapshot', progress: current });
    current = progress(4, 'export default function App() {}');
    let next = await first.next(); while (next?.type === 'heartbeat') next = await first.next();
    assert.equal(next?.type, 'update');
    await first.cancel();
    assert.equal(active, true, 'closing a viewer must not cancel a build');
    const reconnect = lines((await fetch(url)).body!);
    assert.deepEqual(await reconnect.next(), { type: 'snapshot', progress: current });
    authorised = false; current = progress(5, 'private text after logout');
    next = await reconnect.next(); while (next?.type === 'heartbeat') next = await reconnect.next();
    assert.deepEqual(next, { type: 'error', status: 401, message: 'Sign in again.' });
    assert.equal(await reconnect.next(), undefined);
    authorised = true; active = false; current = progress(6, 'validated final source', 'complete');
    const terminal = lines((await fetch(url)).body!);
    assert.deepEqual(await terminal.next(), { type: 'snapshot', progress: current });
    assert.deepEqual(await terminal.next(), { type: 'end' });
    assert.equal(await terminal.next(), undefined);
    assert.equal(closed, 3);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('slow readers receive a bounded latest delta after drain rather than a queued copy of every chunk', async () => {
  class Response extends EventEmitter {
    destroyed = false; writableEnded = false; writable = false; events: GenerationStreamEvent[] = [];
    writeHead() {} flushHeaders() {}
    write(value: string) { this.events.push(JSON.parse(value)); return this.writable; }
    end() { this.writableEnded = true; }
  }
  const response = new Response(); let current = progress(0, 'start');
  const close = streamGeneration(response as unknown as ServerResponse, { current: () => current, active: () => true, authorise: () => {}, intervalMs: 2 });
  try {
    for (let sequence = 1; sequence <= 8; sequence++) { current = progress(sequence, 'start' + 'x'.repeat(sequence)); await new Promise(resolve => setTimeout(resolve, 3)); }
    assert.equal(response.events.length, 1);
    response.writable = true; response.emit('drain');
    assert.equal(response.events.length, 2);
    const event = response.events[1]; assert.equal(event.type, 'update');
    if (event.type === 'update') { assert.equal(event.baseSequence, 0); assert.equal(event.progress.sequence, 8); assert.deepEqual(event.patches, [{ path: 'src/App.tsx', offset: 5, text: 'xxxxxxxx' }]); }
  } finally { close(); }
  assert.equal(response.listenerCount('drain'), 0);
});
