import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassportAuth } from '../service/auth.js';
import { aliceKey, bobKey, cookieHeader, signedCallback, subjectFor } from './auth-fixture.js';

const origin = 'https://builder.example';
const options = { passportOrigin: 'https://midnightpassport.com', devMode: false, secureCookies: true };

test('verified sessions survive restart, use key ownership, and revoke persistently', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'passport-auth-'));
  const filename = join(folder, 'auth.sqlite');
  let auth = new PassportAuth(filename, options);
  try {
    const launch = auth.start(undefined, origin);
    assert.equal(new URL(launch.url).origin, options.passportOrigin);
    assert.equal(new URL(launch.url).searchParams.get('passportCallback'), `${origin}/auth/callback`);
    const login = auth.finish(cookieHeader(launch.cookies), origin, signedCallback(launch.url));
    assert.equal(login.session.authenticated, true);
    assert.equal('subject' in login.session, false);
    assert.ok(login.cookies.every(cookie => /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie) && /Secure/.test(cookie)));
    const cookies = cookieHeader(login.cookies);
    assert.equal(auth.session(cookies)!.subject, subjectFor(aliceKey));
    auth.close(); auth = new PassportAuth(filename, options);
    assert.equal(auth.info(cookies).authenticated, true);
    const bobLaunch = auth.start(undefined, origin);
    const bob = auth.finish(cookieHeader(bobLaunch.cookies), origin, signedCallback(bobLaunch.url, { key: bobKey }));
    assert.equal(auth.session(cookieHeader(bob.cookies))!.subject, subjectFor(bobKey));
    assert.notEqual(auth.session(cookies)!.subject, auth.session(cookieHeader(bob.cookies))!.subject, 'same claimed profile must not merge signing identities');
    assert.equal(auth.logout(cookies).session.authenticated, false);
    auth.close(); auth = new PassportAuth(filename, options);
    assert.equal(auth.info(cookies).authenticated, false);
    assert.equal(auth.info(cookieHeader(bob.cookies)).authenticated, true);
  } finally { auth.close(); await rm(folder, { recursive: true, force: true }); }
});

test('sign-in refuses forged, unsigned, stale, cross-origin, and cross-browser responses', () => {
  const auth = new PassportAuth(':memory:', options);
  try {
    const launch = auth.start(undefined, origin); const cookies = cookieHeader(launch.cookies);
    const valid = signedCallback(launch.url);
    assert.throws(() => auth.finish(undefined, origin, valid), /another browser/);
    const stranger = auth.start(undefined, origin);
    assert.throws(() => auth.finish(cookieHeader(stranger.cookies), origin, valid), /state/);
    assert.throws(() => auth.finish(cookies, 'https://other.example', valid), /expired/);
    for (const payload of [
      { state: 'invented-state' }, { audience: 'https://other.example' },
      { issuedAt: Date.now() - 301_000 }, { issuedAt: Date.now() + 120_000 },
    ]) assert.throws(() => auth.finish(cookies, origin, signedCallback(launch.url, { payload })), /could not be verified/);
    assert.throws(() => auth.finish(cookies, origin, signedCallback(launch.url, { envelope: { scheme: 'none' } })), /unsigned/);
    assert.throws(() => auth.finish(cookies, origin, signedCallback(launch.url, { envelope: { signature: `schnorr:${'00'.repeat(64)}` } })), /signature/);
    assert.throws(() => auth.finish(cookies, origin, signedCallback(launch.url, { envelope: { publicKey: `ecdsa:${'00'.repeat(32)}` } })), /Invalid/);
    assert.throws(() => auth.finish(cookies, origin, 'x'.repeat(16_385)), /Invalid/);
    assert.equal(auth.finish(cookies, origin, valid).session.authenticated, true);
    assert.throws(() => auth.finish(cookies, origin, valid), /already used/);
  } finally { auth.close(); }
});

test('challenge consumption and nonces prevent replay, while challenge and session expiry are enforced', () => {
  let now = Date.now();
  const auth = new PassportAuth(':memory:', { ...options, now: () => now });
  try {
    const launch = auth.start(undefined, origin);
    const nonce = 'same-nonce';
    const reply = signedCallback(launch.url, { payload: { nonce, issuedAt: now } });
    const session = auth.finish(cookieHeader(launch.cookies), origin, reply);
    const fresh = auth.start(undefined, origin);
    assert.throws(() => auth.finish(cookieHeader(fresh.cookies), origin, signedCallback(fresh.url, { payload: { nonce, issuedAt: now } })), /already been used/);
    const pending = auth.start(undefined, origin);
    now += 5 * 60_000;
    assert.throws(() => auth.finish(cookieHeader(pending.cookies), origin, signedCallback(pending.url, { payload: { issuedAt: now } })), /expired/);
    assert.equal(auth.info(cookieHeader(session.cookies)).authenticated, true);
    now += 7 * 24 * 60 * 60_000;
    assert.equal(auth.info(cookieHeader(session.cookies)).authenticated, false);
  } finally { auth.close(); }
});
