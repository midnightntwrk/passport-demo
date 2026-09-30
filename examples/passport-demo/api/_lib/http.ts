/**
 * Adapts a handler from `handlers.ts` to Vercel's Node signature. The body is
 * read here, capped at 8 KB, and parsed; nothing else is.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PushDeps, PushRequest, PushResponse } from './handlers.js';

export const MAX_BODY_BYTES = 8 * 1024;

class TooLarge extends Error {}

async function readBody(request: IncomingMessage): Promise<string> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) throw new TooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new TooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parse(text: string): unknown {
  try {
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function reply(response: ServerResponse, result: PushResponse): void {
  response.statusCode = result.status;
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(result.body));
}

function defaultDeps(): PushDeps {
  return {
    env: process.env,
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) }),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function nodeHandler(
  handle: (request: PushRequest, deps: PushDeps) => Promise<PushResponse>,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    try {
      const method = request.method ?? 'GET';
      const body = method === 'POST' ? parse(await readBody(request)) : undefined;
      const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
      reply(response, await handle({ method, origin, body }, defaultDeps()));
    } catch (cause) {
      if (cause instanceof TooLarge) {
        reply(response, { status: 413, body: { error: 'body-too-large' } });
        return;
      }
      console.error('[push]', cause);
      reply(response, { status: 500, body: { error: 'push-failed' } });
    }
  };
}
