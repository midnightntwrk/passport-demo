import type { ServerResponse } from 'node:http';
import type { GenerationProgress, GenerationStreamEvent } from '../shared/generation.js';

type Options = {
  authorise: () => unknown;
  current: () => GenerationProgress | undefined;
  active: () => boolean;
  onClose?: () => void;
  intervalMs?: number;
  heartbeatMs?: number;
};

export function generationEvent(previous: GenerationProgress | undefined, current: GenerationProgress | undefined): GenerationStreamEvent {
  if (!current || !previous || current.runId !== previous.runId) return { type: 'snapshot', progress: current ?? null };
  const { files, ...progress } = current;
  const patches = Object.entries(files).flatMap(([path, text]) => {
    const before = previous.files[path];
    if (text === before) return [];
    const offset = before !== undefined && text.startsWith(before) ? before.length : 0;
    return [{ path, offset, text: text.slice(offset) }];
  });
  // A replacement snapshot also removes any file absent from the latest state.
  if (Object.keys(previous.files).some(path => !(path in files))) return { type: 'snapshot', progress: current };
  return { type: 'update', baseSequence: previous.sequence, progress, patches };
}

/** A disconnect stops observation, never the durable build. Slow readers get coalesced updates. */
export function streamGeneration(res: ServerResponse, options: Options): () => void {
  let previous: GenerationProgress | undefined;
  let initial = true;
  let closed = false;
  let blocked = false;
  let lastWrite = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    res.off('drain', drain);
    res.off('close', cleanup);
    res.off('error', cleanup);
    options.onClose?.();
  };
  const write = (event: GenerationStreamEvent) => {
    blocked = !res.write(`${JSON.stringify(event)}\n`);
    lastWrite = Date.now();
  };
  const finish = () => { write({ type: 'end' }); res.end(); cleanup(); };
  const tick = () => {
    if (closed || blocked || res.destroyed) return;
    try {
      const current = options.current();
      const changed = initial || current?.runId !== previous?.runId || current?.sequence !== previous?.sequence;
      const heartbeat = Date.now() - lastWrite >= (options.heartbeatMs ?? 10_000);
      if (changed || heartbeat || !options.active()) {
        // Recheck before every source update, including after logout/expiry.
        options.authorise();
        if (changed) {
          write(generationEvent(initial ? undefined : previous, current));
          previous = current ? structuredClone(current) : undefined;
          initial = false;
        } else if (heartbeat) write({ type: 'heartbeat' });
        if (!options.active()) finish();
      }
    } catch (error) {
      const status = Number((error as { status?: number })?.status) || 500;
      try {
        write({ type: 'error', status, message: status === 500 ? 'The code stream was interrupted. Reconnect to continue.' : error instanceof Error ? error.message : 'The code stream is unavailable.' });
        res.end();
      } finally { cleanup(); }
    }
  };
  const drain = () => { blocked = false; tick(); };
  res.on('drain', drain);
  res.once('close', cleanup);
  res.once('error', cleanup);
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    'x-content-type-options': 'nosniff',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders();
  tick();
  if (!closed) { timer = setInterval(tick, options.intervalMs ?? 200); timer.unref(); }
  return () => { cleanup(); if (!res.writableEnded) res.end(); };
}
