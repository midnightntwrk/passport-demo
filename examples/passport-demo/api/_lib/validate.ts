/**
 * Input rules for the push endpoints. Everything a request carries is checked
 * here before anything is stored, sent, or asked of the indexer.
 */

const HEX_64 = /^[0-9a-f]{64}$/;

/** A Passport account (contract) address: 64 lower-case hex. */
export function isAccount(value: unknown): value is string {
  return typeof value === 'string' && HEX_64.test(value);
}

/** A ledger transaction hash: 64 lower-case hex. */
export function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && HEX_64.test(value);
}

/** An FCM registration token: opaque, but bounded and free of whitespace. */
export function isPushToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 4096 && !/\s/.test(value);
}

/** The hosts a browser may call these endpoints from. */
const PASSPORT_HOSTS = new Set([
  'midnightpassport.com',
  'staging.midnightpassport.com',
  'midnight-passport-dev.vercel.app',
]);

/**
 * Same-site guard. A request with no Origin header (not a browser, or a
 * same-origin navigation) passes; one with an Origin must be a Passport host
 * over https, or localhost on any port.
 */
export function originAllowed(origin: string | undefined | null): boolean {
  if (origin === undefined || origin === null || origin === '') return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }
  return url.protocol === 'https:' && PASSPORT_HOSTS.has(url.hostname);
}
