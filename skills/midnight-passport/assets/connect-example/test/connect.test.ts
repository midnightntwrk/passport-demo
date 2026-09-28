/**
 * The sign-in, driven against a scripted Passport.
 *
 * `createPassport` accepts a `PassportTransport` object in place of 'auto', and
 * that seam is how you test an integration without a browser, a passkey, or the
 * network: the transport hands the client a channel, and the test answers the
 * request the client posts with the reply a real Passport would send.
 */
import { describe, expect, it } from 'vitest';
import {
  PassportTransportError,
  createPassport,
  createPassportProfileResponse,
  readPassportProfileRequest,
  type PassportProfile,
  type PassportProfileRequest,
  type PassportTransport,
} from '@midnight-passport/connect';

import { displayNightName, signIn } from '../src/connect';

const ORIGIN = 'https://midnightpassport.com';
const ACCOUNT = { address: 'a'.repeat(64), network: 'stagenet' };

type Script =
  | { reply: 'approve'; profile: PassportProfile }
  | { reply: 'deny' }
  | { reply: 'never' }
  | { reply: 'close' }
  | { fail: PassportTransportError['code'] };

/** A Passport that answers one request the way the script says. */
function scriptedPassport(script: Script, timeoutMs = 200) {
  const handlers = new Set<(data: unknown) => void>();
  const posted: PassportProfileRequest[] = [];
  let closed = false;
  const transport: PassportTransport = {
    mode: 'popup',
    listen(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async open() {
      if ('fail' in script) throw new PassportTransportError(script.fail, script.fail);
      return {
        pair: { requestId: 'req-1', nonce: 'nonce-1' },
        post(message) {
          const parsed = readPassportProfileRequest(message);
          if (parsed.kind !== 'ok') throw new Error(`the client posted something unreadable: ${parsed.kind}`);
          const request = parsed.value;
          posted.push(request);
          queueMicrotask(() => {
            if (script.reply === 'approve') {
              const reply = createPassportProfileResponse(request, { approved: true, profile: script.profile });
              handlers.forEach((handler) => handler(reply));
            } else if (script.reply === 'deny') {
              const reply = createPassportProfileResponse(request, { approved: false, error: 'denied' });
              handlers.forEach((handler) => handler(reply));
            } else if (script.reply === 'close') {
              closed = true;
            }
          });
        },
        closed: () => closed,
        release() {},
      };
    },
    async presence() {
      return { present: 'unknown', reason: 'popup-mode', message: 'pop-up mode' };
    },
    destroy() {},
  };
  const passport = createPassport({
    origin: ORIGIN,
    transport,
    timeoutMs,
    closedPollMs: 5,
    window: globalThis as unknown as Window,
  });
  return { passport, posted };
}

describe('Continue with Passport', () => {
  it('asks for exactly the name and the account, and shows both when shared', async () => {
    const { passport, posted } = scriptedPassport({
      reply: 'approve',
      profile: { displayName: 'alice', passportContract: ACCOUNT },
    });
    const view = await signIn(passport);
    expect(posted[0]?.fields).toEqual(['displayName', 'passportContract']);
    expect(view).toMatchObject({ kind: 'signed-in', name: 'alice.night', account: ACCOUNT, withheld: [] });
  });

  it('treats partial consent as a sign-in, and names what was not shared', async () => {
    const { passport } = scriptedPassport({ reply: 'approve', profile: { displayName: 'alice.night' } });
    const view = await signIn(passport);
    expect(view).toMatchObject({ kind: 'signed-in', name: 'alice.night', account: null, withheld: ['passportContract'] });
  });

  it('shows the package sentence when the user declines', async () => {
    const { passport } = scriptedPassport({ reply: 'deny' });
    const view = await signIn(passport);
    expect(view).toEqual({
      kind: 'refused',
      code: 'denied',
      message: 'You declined the request in Passport. Nothing was shared with this app.',
    });
  });

  it('says the pop-up was blocked, and that nothing was shared', async () => {
    const { passport } = scriptedPassport({ fail: 'popup-blocked' });
    const view = await signIn(passport);
    expect(view).toMatchObject({ kind: 'not-sent', code: 'popup-blocked', checkPassport: false });
    expect(view.message).toMatch(/Allow pop-ups/);
  });

  it('says the window was closed, not that the user declined', async () => {
    const { passport } = scriptedPassport({ reply: 'close' });
    const view = await signIn(passport);
    expect(view).toMatchObject({ kind: 'not-sent', code: 'passport-closed', checkPassport: false });
  });

  it('treats a timeout as unknown, never as a decision', async () => {
    const { passport } = scriptedPassport({ reply: 'never' }, 30);
    const view = await signIn(passport);
    expect(view).toMatchObject({ kind: 'not-sent', code: 'timed-out', checkPassport: true });
  });
});

describe('the pop-up launch', () => {
  it('opens the exact Passport origin with a fresh request pair, and reports a blocked window', async () => {
    const opened: string[] = [];
    const host = {
      parent: undefined as unknown,
      open: (url: string) => {
        opened.push(url);
        return null; // what a blocker returns
      },
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };
    host.parent = host; // not framed, so 'auto' picks the pop-up
    const passport = createPassport({ origin: `${ORIGIN}/`, window: host as unknown as Window });
    expect(passport.mode).toBe('popup');
    const result = await passport.requestProfile(['displayName']);
    expect(result).toMatchObject({ approved: false, source: 'local', error: 'popup-blocked' });
    const url = new URL(opened[0]!);
    expect(url.origin).toBe(ORIGIN);
    expect(url.searchParams.get('passportRequestId')).toBeTruthy();
    expect(url.searchParams.get('passportNonce')).toBeTruthy();
  });
});

describe('displayNightName', () => {
  it('adds the suffix once and never invents a name', () => {
    expect(displayNightName('alice')).toBe('alice.night');
    expect(displayNightName('alice.night')).toBe('alice.night');
    expect(displayNightName(undefined)).toBeNull();
    expect(displayNightName('  ')).toBeNull();
  });
});
