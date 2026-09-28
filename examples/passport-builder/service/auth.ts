import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import {
  buildPassportLaunchUrl,
  parsePassportCallbackReturn,
  verifyPassportCallbackReply,
} from '@midnight-passport/connect/redirect';
import type { AuthSession } from '../shared/types.js';

const CHALLENGE_COOKIE = 'passport_builder_login';
const SESSION_COOKIE = 'passport_builder_session';
const CHALLENGE_MS = 5 * 60_000;
const SESSION_MS = 7 * 24 * 60 * 60_000;
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const unauthorised = (message: string) => Object.assign(new Error(message), { status: 401 });

export interface AuthIdentity {
  /** Verified signing key identity, private to the service and project ownership. */
  subject: string;
  profile: { displayName?: string };
  expiresAt: string;
}
type Options = { passportOrigin: string; devMode: boolean; secureCookies: boolean; now?: () => number };

function cookieValue(header: string | undefined, name: string): string | undefined {
  const values = (header || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

/** Signed Passport challenges authenticate key possession; profile labels grant no permissions. */
export class PassportAuth {
  private db: DatabaseSync;
  private now: () => number;
  private challengeCookie: string;
  private sessionCookie: string;
  constructor(file: string, private options: Options) {
    this.now = options.now || Date.now;
    this.challengeCookie = `${options.secureCookies ? '__Host-' : ''}${CHALLENGE_COOKIE}`;
    this.sessionCookie = `${options.secureCookies ? '__Host-' : ''}${SESSION_COOKIE}`;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS auth_challenges (
        token_hash TEXT PRIMARY KEY, state TEXT NOT NULL UNIQUE, audience TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_nonces (nonce_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, profile TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE INDEX IF NOT EXISTS session_expiry ON auth_sessions(expires_at);`);
  }
  private cookie(name: string, value: string, age: number): string {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${this.options.secureCookies ? '; Secure' : ''}`;
  }
  private clean(now: number) {
    this.db.prepare('DELETE FROM auth_challenges WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM auth_nonces WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL').run(now);
  }
  session(cookieHeader?: string): AuthIdentity | undefined {
    const token = cookieValue(cookieHeader, this.sessionCookie);
    if (!token) return undefined;
    const row = this.db.prepare('SELECT subject,profile,expires_at FROM auth_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?')
      .get(hashToken(token), this.now());
    if (!row) return undefined;
    return { subject: String(row.subject), profile: JSON.parse(String(row.profile)), expiresAt: new Date(Number(row.expires_at)).toISOString() };
  }
  info(cookieHeader?: string): AuthSession {
    const identity = this.session(cookieHeader);
    return identity
      ? { authenticated: true, profile: identity.profile, expiresAt: identity.expiresAt, devMode: this.options.devMode }
      : { authenticated: false, devMode: this.options.devMode };
  }
  start(cookieHeader: string | undefined, audience: string): { url: string; cookies: string[] } {
    const origin = new URL(audience).origin;
    if (origin !== audience || !/^https?:\/\//.test(origin)) throw new Error('Invalid sign-in audience.');
    const now = this.now(); this.clean(now);
    const previous = cookieValue(cookieHeader, this.challengeCookie);
    if (previous) this.db.prepare('DELETE FROM auth_challenges WHERE token_hash=?').run(hashToken(previous));
    const token = newToken(); const state = newToken();
    this.db.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?)').run(hashToken(token), state, origin, now, now + CHALLENGE_MS);
    return {
      url: buildPassportLaunchUrl({ passportOrigin: this.options.passportOrigin, callbackUrl: `${origin}/auth/callback`, fields: ['displayName', 'passportContract'], state }),
      cookies: [this.cookie(this.challengeCookie, token, CHALLENGE_MS / 1000)],
    };
  }
  finish(cookieHeader: string | undefined, audience: string, fragment: unknown): { session: AuthSession; cookies: string[] } {
    if (typeof fragment !== 'string' || fragment.length < 1 || fragment.length > 16_384) throw unauthorised('Invalid Passport sign-in response.');
    const token = cookieValue(cookieHeader, this.challengeCookie);
    if (!token) throw unauthorised('Sign-in expired or belongs to another browser. Start again.');
    const now = this.now();
    const challenge = this.db.prepare('SELECT state,audience,expires_at FROM auth_challenges WHERE token_hash=?').get(hashToken(token));
    if (!challenge || Number(challenge.expires_at) <= now || challenge.audience !== audience) throw unauthorised('Sign-in expired or was already used. Start again.');
    const parsed = parsePassportCallbackReturn(fragment);
    if (parsed.kind !== 'response') throw unauthorised(parsed.kind === 'error' ? 'Passport sign-in was cancelled.' : 'Invalid Passport sign-in response.');
    const verdict = verifyPassportCallbackReply(parsed.envelope, {
      expectedAudience: audience, expectedState: String(challenge.state), requireSignature: true, maxAgeMs: CHALLENGE_MS, now,
      seenNonce: nonce => Boolean(this.db.prepare('SELECT 1 FROM auth_nonces WHERE nonce_hash=? AND expires_at>?').get(hashToken(nonce), now)),
    });
    if (!verdict.ok || !verdict.signed || !verdict.signerKey) throw unauthorised(`Passport sign-in could not be verified${verdict.ok ? '.' : `: ${verdict.reason}.`}`);
    // Names and contract addresses in a signed profile remain the wallet's
    // claims. Only the cryptographically verified key determines ownership.
    const subject = `passport:${hashToken(verdict.signerKey.toLowerCase())}`;
    const displayName = verdict.payload.profile.displayName?.trim();
    const profile = displayName ? { displayName } : {};
    const sessionToken = newToken(); const expiresAt = now + SESSION_MS;
    const previous = cookieValue(cookieHeader, this.sessionCookie);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const consumed = this.db.prepare('DELETE FROM auth_challenges WHERE token_hash=? AND expires_at>?').run(hashToken(token), now);
      if (consumed.changes !== 1) throw unauthorised('This sign-in response was already used.');
      // Keep nonces through the full verifier freshness window, including clock skew.
      this.db.prepare('INSERT INTO auth_nonces VALUES(?,?)').run(hashToken(verdict.payload.nonce), now + CHALLENGE_MS + 60_000);
      if (previous) this.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=?').run(now, hashToken(previous));
      this.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,NULL)').run(hashToken(sessionToken), subject, JSON.stringify(profile), now, expiresAt);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return {
      session: { authenticated: true, profile, expiresAt: new Date(expiresAt).toISOString(), devMode: this.options.devMode },
      cookies: [this.cookie(this.sessionCookie, sessionToken, SESSION_MS / 1000), this.cookie(this.challengeCookie, '', 0)],
    };
  }
  logout(cookieHeader?: string): { session: AuthSession; cookies: string[] } {
    const token = cookieValue(cookieHeader, this.sessionCookie);
    if (token) this.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=?').run(this.now(), hashToken(token));
    const challenge = cookieValue(cookieHeader, this.challengeCookie);
    if (challenge) this.db.prepare('DELETE FROM auth_challenges WHERE token_hash=?').run(hashToken(challenge));
    return { session: { authenticated: false, devMode: this.options.devMode }, cookies: [this.cookie(this.sessionCookie, '', 0), this.cookie(this.challengeCookie, '', 0)] };
  }
  close() { this.db.close(); }
}
