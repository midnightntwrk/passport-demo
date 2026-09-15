/**
 * A one-second memory for the two read-only routes.
 *
 * WHAT THIS IS FOR. `GET /status` and `GET /wallet-status` are the only
 * unauthenticated routes this service serves, and both of them do real work per
 * request: `currentState`, `progress`, three balance reads, a pending count.
 * They are also the most-polled routes here by a wide margin — the client asks
 * before every send, the droplet watchdog asks every minute, the health monitor
 * asks on its own tick, and anybody at all may ask as often as they like,
 * because guarding either one would break the things that watch this service
 * while costing an abuser nothing.
 *
 * So the answer is not a rate limit but a memory: within one second, every
 * caller gets the same reading. That bounds the wallet work these routes can
 * cause at one pass per route per second however hard they are polled, and it
 * costs a watcher nothing they would notice — a second-old balance is a second
 * old whether it was cached or read, given the six-second blocks underneath it.
 *
 * CONCURRENT CALLERS SHARE THE PROMISE, not just the settled value. Ten probes
 * arriving in the same tick were ten wallet passes before this existed, and a
 * cache that only remembers finished answers would still let all ten through.
 * The entry is stored the moment the work starts and its age is measured from
 * the moment it FINISHES, so a slow read is never counted as stale before it
 * has been served once.
 *
 * A FAILED READ IS NOT REMEMBERED. Both producers here catch their own failures
 * and answer with a degraded body rather than throwing, but if one ever does
 * throw, caching the rejection would hand the same failure to every caller for
 * the rest of the second. The entry is dropped instead and the next caller
 * tries again.
 */

interface Entry<T> {
  /** Stored before the work finishes, so callers in the same tick share it. */
  readonly value: Promise<T>;
  /** When it finished — `null` while it is still running. */
  settledAt: number | null;
}

export interface ReadCache {
  /**
   * The route's answer, produced afresh only when the last one is older than
   * the cache's window.
   */
  through<T>(route: string, produce: () => Promise<T>): Promise<T>;
  /** How many calls were served from a remembered answer. For `/status`. */
  hits(): number;
  /** How many calls ran the producer. */
  misses(): number;
}

export interface ReadCacheOptions {
  /** The window an answer stays good for. */
  ttlMs: number;
  /** Injectable for the test; `Date.now` in the service. */
  now?: () => number;
}

export function createReadCache(options: ReadCacheOptions): ReadCache {
  const now = options.now ?? Date.now;
  const ttlMs = Math.max(0, options.ttlMs);
  const entries = new Map<string, Entry<unknown>>();
  let hits = 0;
  let misses = 0;

  return {
    through<T>(route: string, produce: () => Promise<T>): Promise<T> {
      const held = entries.get(route);
      /* Still running, or finished inside the window: this caller waits on the
         answer already in hand rather than starting a second one. */
      if (held && (held.settledAt === null || now() - held.settledAt < ttlMs)) {
        hits += 1;
        return held.value as Promise<T>;
      }
      misses += 1;
      const entry: Entry<T> = { value: produce(), settledAt: null };
      entries.set(route, entry);
      return entry.value.then(
        (answer) => {
          entry.settledAt = now();
          return answer;
        },
        (cause: unknown) => {
          /* Not remembered — see the note above. `delete` is conditional so a
             newer entry started by a later caller is not thrown away. */
          if (entries.get(route) === (entry as Entry<unknown>)) entries.delete(route);
          throw cause;
        },
      );
    },
    hits: () => hits,
    misses: () => misses,
  };
}
