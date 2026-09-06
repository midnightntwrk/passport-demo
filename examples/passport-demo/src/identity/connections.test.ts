import { beforeEach, describe, expect, it } from 'vitest';

import {
  loadConnections,
  profileShareScope,
  recordConnection,
  revokeConnection,
  subscribeConnections,
} from './connections.js';

/**
 * The connections store is the local stand-in for the C10 grant, and these
 * drills hold the parts a wrong merge would quietly break: one record per
 * origin however many approvals, scopes that accumulate without duplicating,
 * a revoke that leaves a stranger rather than a ghost, and isolation between
 * credentials — a second passkey must never read the first one's tenants.
 */

const CRED = 'credential-one';
const AUTH = { operation: 'authenticate', object: 'sees your name', bound: 'asks every time' };
const PAY = { operation: 'pay', object: 'from the pocket', bound: 'asks every time' };

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { localStorage: fakeStorage() };
});

describe('recordConnection', () => {
  it('one origin is one record, however many approvals', () => {
    recordConnection(CRED, { origin: 'https://nightfi.example', scopes: [AUTH] });
    recordConnection(CRED, { origin: 'https://nightfi.example', scopes: [AUTH] });
    const records = loadConnections(CRED);
    expect(records).toHaveLength(1);
    expect(records[0]?.uses).toBe(2);
    expect(records[0]?.scopes).toEqual([AUTH]);
    expect(records[0]?.name).toBe('nightfi.example');
  });

  it('scopes accumulate and never duplicate', () => {
    recordConnection(CRED, { origin: 'https://nightfi.example', scopes: [AUTH] });
    recordConnection(CRED, { origin: 'https://nightfi.example', scopes: [PAY, AUTH] });
    expect(loadConnections(CRED)[0]?.scopes).toEqual([AUTH, PAY]);
  });

  it('keeps the first connectedAt and moves lastUsedAt', () => {
    recordConnection(CRED, { origin: 'https://a.example', scopes: [AUTH] });
    const first = loadConnections(CRED)[0]!;
    recordConnection(CRED, { origin: 'https://a.example', scopes: [PAY] });
    const second = loadConnections(CRED)[0]!;
    expect(second.connectedAt).toBe(first.connectedAt);
    expect(second.lastUsedAt >= first.lastUsedAt).toBe(true);
  });

  it('an origin that is not a URL still gets a readable name', () => {
    recordConnection(CRED, { origin: 'not-a-url', scopes: [AUTH] });
    expect(loadConnections(CRED)[0]?.name).toBe('not-a-url');
  });

  it('credentials are isolated: a second passkey reads no tenants', () => {
    recordConnection(CRED, { origin: 'https://a.example', scopes: [AUTH] });
    expect(loadConnections('credential-two')).toEqual([]);
  });
});

describe('revokeConnection', () => {
  it('removes the record, and only that record', () => {
    recordConnection(CRED, { origin: 'https://a.example', scopes: [AUTH] });
    recordConnection(CRED, { origin: 'https://b.example', scopes: [AUTH] });
    revokeConnection(CRED, 'https://a.example');
    const records = loadConnections(CRED);
    expect(records).toHaveLength(1);
    expect(records[0]?.origin).toBe('https://b.example');
  });

  it('a revoked origin returning is a NEW connection — no ghost lifecycle', () => {
    recordConnection(CRED, { origin: 'https://a.example', scopes: [AUTH, PAY] });
    revokeConnection(CRED, 'https://a.example');
    recordConnection(CRED, { origin: 'https://a.example', scopes: [AUTH] });
    const record = loadConnections(CRED)[0]!;
    expect(record.uses).toBe(1);
    expect(record.scopes).toEqual([AUTH]);
  });
});

describe('subscribeConnections', () => {
  it('notifies its own credential and nobody else', () => {
    const seen: string[] = [];
    const stop = subscribeConnections(CRED, (records) => {
      seen.push(records.map((record) => record.origin).join(','));
    });
    const stopOther = subscribeConnections('credential-two', () => {
      throw new Error('the other credential must not hear this write');
    });
    recordConnection(CRED, { origin: 'https://a.example', scopes: [AUTH] });
    revokeConnection(CRED, 'https://a.example');
    stop();
    stopOther();
    expect(seen).toEqual(['https://a.example', '']);
  });
});

describe('profileShareScope', () => {
  it('names the fields that really left, in the user\'s words', () => {
    expect(profileShareScope(['displayName', 'passportContract'])).toEqual({
      operation: 'authenticate',
      object: 'sees your name, your account',
      bound: 'asks every time',
    });
  });

  it('an empty share says so rather than inventing a field', () => {
    expect(profileShareScope([]).object).toBe('sees nothing');
  });
});
