/**
 * The one-second memory in front of the two unguarded routes.
 *
 * WHAT IT IS FOR. `GET /status` and `GET /wallet-status` are deliberately not
 * rate limited — the client polls `/wallet-status` before every send, the
 * droplet watchdog and the health monitor poll `/status` around the clock, and
 * a limit on either would break the things that watch this service while
 * costing an abuser nothing. But "costs nothing" was not true of the service's
 * own side: each request did a full pass over the wallet — `currentState`,
 * `progress`, three balances, a pending count — so the cheapest request anyone
 * could make was also unbounded in how often they could make it.
 *
 * The answer is a memory rather than a limit. Within one second every caller
 * gets the same reading, which bounds the work at one pass per route per second
 * however hard either is polled, and which no watcher can distinguish from a
 * fresh read given the six-second blocks the figures come from.
 *
 * The clock is injected here, so none of this waits on real time.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createReadCache } from '../src/readCache.js';

/** A clock the test moves by hand. */
const clock = (start = 1_000) => {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
};

describe('the memory in front of `/status` and `/wallet-status`', () => {
  it('runs the producer once inside the window and hands back the same reading', async () => {
    const time = clock();
    const cache = createReadCache({ ttlMs: 1_000, now: time.now });
    let passes = 0;
    const read = () => cache.through('/status', () => Promise.resolve({ pass: ++passes }));

    assert.deepEqual(await read(), { pass: 1 });
    time.advance(400);
    assert.deepEqual(await read(), { pass: 1 });
    time.advance(599);
    assert.deepEqual(await read(), { pass: 1 });
    assert.equal(passes, 1, 'one wallet pass for three requests in the same second');
    assert.equal(cache.hits(), 2);
    assert.equal(cache.misses(), 1);
  });

  it('reads again once the window has passed', async () => {
    const time = clock();
    const cache = createReadCache({ ttlMs: 1_000, now: time.now });
    let passes = 0;
    const read = () => cache.through('/status', () => Promise.resolve({ pass: ++passes }));

    assert.deepEqual(await read(), { pass: 1 });
    time.advance(1_000);
    assert.deepEqual(await read(), { pass: 2 });
    time.advance(1_000);
    assert.deepEqual(await read(), { pass: 3 });
    assert.equal(passes, 3);
  });

  it('keeps the two routes apart', async () => {
    const time = clock();
    const cache = createReadCache({ ttlMs: 1_000, now: time.now });
    const calls: string[] = [];
    const read = (route: string) =>
      cache.through(route, () => {
        calls.push(route);
        return Promise.resolve(route);
      });

    assert.equal(await read('/status'), '/status');
    assert.equal(await read('/wallet-status'), '/wallet-status');
    assert.equal(await read('/status'), '/status');
    assert.equal(await read('/wallet-status'), '/wallet-status');
    assert.deepEqual(calls, ['/status', '/wallet-status'], 'one pass each, not one each per call');
  });

  it('gives concurrent callers the SAME pass rather than one each', async () => {
    /* THE HALF A VALUE CACHE WOULD MISS. Ten probes arriving in the same tick
       find no FINISHED answer, so a cache that only remembers settled values
       lets all ten through — which is the shape of the traffic these routes
       actually get. The entry is stored the moment the work starts. */
    const time = clock();
    const cache = createReadCache({ ttlMs: 1_000, now: time.now });
    let passes = 0;
    let release: ((value: number) => void) | null = null;
    const slow = () =>
      new Promise<number>((settle) => {
        passes += 1;
        release = settle;
      });

    const waiting = Array.from({ length: 10 }, () => cache.through('/wallet-status', slow));
    assert.equal(passes, 1, 'ten callers, one wallet pass');
    (release as unknown as (value: number) => void)(7);
    assert.deepEqual(await Promise.all(waiting), Array.from({ length: 10 }, () => 7));
  });

  it('measures the age of a slow read from when it FINISHED, not when it began', async () => {
    /* A read that takes longer than the window must still be served once from
       the memory, or a slow wallet would make the cache useless exactly when it
       is wanted most. */
    const time = clock();
    const cache = createReadCache({ ttlMs: 1_000, now: time.now });
    let passes = 0;
    const read = () =>
      cache.through('/status', () => {
        time.advance(5_000);
        return Promise.resolve(++passes);
      });

    assert.equal(await read(), 1);
    assert.equal(await read(), 1, 'served from the memory although the read outlasted the window');
    assert.equal(passes, 1);
    time.advance(1_000);
    assert.equal(await read(), 2);
  });

  it('does not remember a failure', async () => {
    /* Caching a rejection would hand the same failure to every caller for the
       rest of the second. Both producers catch their own failures today; this
       is the guard for the day one of them stops. */
    const time = clock();
    const cache = createReadCache({ ttlMs: 1_000, now: time.now });
    let attempts = 0;
    const read = () =>
      cache.through('/status', () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('the wallet could not answer'));
        return Promise.resolve('ready');
      });

    await assert.rejects(read(), /the wallet could not answer/);
    assert.equal(await read(), 'ready', 'the next caller tries again inside the same second');
    assert.equal(attempts, 2);
  });

  it('a window of zero remembers nothing, so the memory can be turned off', async () => {
    const time = clock();
    const cache = createReadCache({ ttlMs: 0, now: time.now });
    let passes = 0;
    const read = () => cache.through('/status', () => Promise.resolve(++passes));
    assert.equal(await read(), 1);
    assert.equal(await read(), 2);
  });
});
