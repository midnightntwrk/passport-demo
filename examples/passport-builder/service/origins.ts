import type { IncomingMessage } from 'node:http';
import { allowedOrigins, devMode } from './config.js';

const forbidden = (message: string) => Object.assign(new Error(message), { status: 403 });
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Use the actual, explicitly trusted host so each domain has its own auth audience. */
export function publicOrigin(req: IncomingMessage): string {
  const host = req.headers.host;
  if (!host || /[\s\\/@?#]/.test(host)) throw forbidden('Unrecognised builder host.');
  let url: URL;
  try { url = new URL(`${process.env.NODE_ENV === 'production' ? 'https' : 'http'}://${host}`); }
  catch { throw forbidden('Unrecognised builder host.'); }
  if (url.host !== host.toLowerCase() || url.pathname !== '/' || url.username || url.password) throw forbidden('Unrecognised builder host.');
  if (process.env.NODE_ENV !== 'production' && loopbackHosts.has(url.hostname)) return url.origin;
  // Forwarded headers cannot opt a request into a different origin or dev bypass.
  const trusted = allowedOrigins.find(origin => new URL(origin).host === url.host);
  if (!trusted) throw forbidden('Unrecognised builder host.');
  return trusted;
}

export function assertRequestOrigin(req: IncomingMessage): void {
  const expected = publicOrigin(req);
  if (req.headers.origin === expected) return;
  if (!req.headers.origin && devMode && loopbackHosts.has(new URL(expected).hostname)) return;
  throw forbidden('This request must come from the builder on the same origin.');
}
