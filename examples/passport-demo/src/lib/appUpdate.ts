/**
 * Keeping an open Passport on the deployed build, without asking anybody to
 * press anything.
 *
 * WHY THERE IS NO UPDATE BUTTON ANY MORE (2026/09/25)
 * ---------------------------------------------------
 * `src/pwa.tsx` used to offer an "Update Passport" button whenever a new
 * service worker finished installing, and a "A new version of Passport is
 * ready" bar whenever it had deferred a reload. On an Android phone on
 * 2026/09/25 the button sat full-width across the bottom of the screen of a
 * page that was ALREADY running the new build — it had been reloaded two
 * minutes earlier, and navigations are network-first — because the new worker
 * was parked in `waiting` behind an old one that was still busy with a fetch.
 * The button offered nothing, and pressing it posted `SKIP_WAITING` to a
 * worker that could not act on it until the old one went idle, so it spun on
 * "Updating". Updating is the app's job, so the button, the bar, and the
 * question are gone, and this module decides everything they used to ask.
 *
 * WHAT IT DECIDES
 * ---------------
 *   1. A waiting worker is told to skip waiting — only on a page some worker
 *      already controls, and AGAIN every {@link WAITING_NUDGE_INTERVAL_MS} for
 *      as long as it waits. A page with no controller is a first install, whose
 *      worker activates on its own and must not be hurried into claiming a
 *      page mid-load. The repeat is not nagging: a worker's `skipWaiting()`
 *      is what makes the browser ask again whether the running worker is idle
 *      yet, and Chromium does not always ask by itself. Measured on 2026/09/25
 *      in Chromium 151, against a fixture shaped like
 *      `e2e/serviceWorkerUpdate.spec.ts`'s: once the running worker's last
 *      request had ended, the next one still stayed parked in three of four
 *      runs left to take their course, until Chromium's own fallback five
 *      minutes later — they activated at 300, 301, and 302 seconds. One more
 *      `SKIP_WAITING` activated it within three seconds.
 *   2. When a new worker takes over, the page asks it which build it serves.
 *      If that is the build this page is running, there is nothing to do: the
 *      waiting worker only needed activating, and the page is never reloaded.
 *      Otherwise the page reloads into the new build at the first SAFE moment.
 *   3. A lazy chunk that 404s after a deploy (`vite:preloadError`) reloads the
 *      page once. A session flag holds the build that reloaded, so a build that
 *      still cannot load its chunks after the reload never reloads again.
 *
 * WHAT A SAFE MOMENT IS
 * ---------------------
 * Never while critical work is in flight — a passkey ceremony, setup, a send,
 * the recovery add — which is `criticalWorkInFlight()` in `appBusy.ts`, held
 * by the screens themselves. Never while the person has something open that a
 * reload would take away: a text field in focus or an open sheet. Beyond that:
 *
 *   - when the new worker takes over: at once, if the page is hidden or the
 *     person has not touched it for {@link INTERACTION_QUIET_MS};
 *   - otherwise, once the critical work has ended, the next time the page is
 *     hidden, or the next time it becomes visible, before the person has had
 *     the chance to start anything;
 *   - for a failed chunk: at once. The person has just asked for a screen the
 *     page can no longer load, and the reload is the only thing that brings it.
 *
 * It holds no DOM, no React, and no timers of its own beyond the one reply
 * deadline in {@link askWorkerBuildId}: the page, the clock, the reload, and
 * the question to the worker are all injected, so every branch is drilled in
 * `src/lib/appUpdate.test.ts`. The wiring is `src/pwa.tsx`.
 */

import { criticalWorkInFlight, subscribeCriticalWork } from './appBusy.js';

/** How long after the last touch or key press the person counts as idle. */
export const INTERACTION_QUIET_MS = 10_000;

/** How often a worker still parked in `waiting` is told to skip waiting again. */
export const WAITING_NUDGE_INTERVAL_MS = 5_000;

/** How long a worker is given to say which build it serves. */
export const BUILD_ID_REPLY_TIMEOUT_MS = 3_000;

/**
 * The session flag the chunk reload writes, holding the build id of the page
 * that reloaded. See {@link SilentUpdater.chunkLoadFailed}.
 */
export const CHUNK_RELOAD_KEY = 'mn-passport:chunk-reload';

/** The events that mean the person is doing something on the page. */
export const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'input'] as const;

/** An open sheet or dialog: something a reload would close under the person. */
export const OPEN_SHEET_SELECTOR = '[aria-modal="true"], dialog[open]';

/** The part of a `ServiceWorker` this module talks to. */
export interface UpdateWorker {
  postMessage(message: unknown, transfer: Transferable[]): void;
}

/**
 * Asks `worker` which build it serves, through the `BUILD_ID` message
 * `public/sw.js` answers. `null` when it does not answer in time, answers with
 * something that is not a build id, or cannot be written to at all — every one
 * of which the caller treats as "not this page's build".
 */
export function askWorkerBuildId(
  worker: UpdateWorker,
  timeoutMs: number = BUILD_ID_REPLY_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (buildId: string | null) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(buildId);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      finish(typeof event.data === 'string' ? event.data : null);
    };
    try {
      worker.postMessage({ type: 'BUILD_ID' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

/** The element with focus, as far as {@link isTextEntry} needs to see it. */
export interface FocusedElement {
  readonly tagName: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

/** Input types that hold no typing: pressing one is not a draft in progress. */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * True when `element` is somewhere the person types — a text input, a text
 * area, a select, or anything content-editable. With focus there, a reload
 * would throw away whatever they were in the middle of entering.
 */
export function isTextEntry(element: FocusedElement | null | undefined): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUT_TYPES.has((element.type ?? 'text').toLowerCase());
}

/** The small part of `sessionStorage` the chunk reload needs. */
export type SessionFlags = Pick<Storage, 'getItem' | 'setItem'>;

/** Everything the updater reads from, and does to, the page. */
export interface SilentUpdateHost {
  /** The build this document is running: `BUILD_ID` from `buildId.ts`. */
  readonly pageBuildId: string;
  /** Whether a service worker controlled this document when it loaded. */
  readonly controlled: boolean;
  /** `document.visibilityState === 'hidden'`. */
  isHidden(): boolean;
  /** A text field in focus, or an open sheet. See the module header. */
  isEngaged(): boolean;
  now(): number;
  reload(): void;
  askBuildId(worker: UpdateWorker): Promise<string | null>;
  /** `sessionStorage`, or `null` where the browser will not give one. */
  readonly session: SessionFlags | null;
}

/** The page's events, handed in by `src/pwa.tsx`. */
export interface SilentUpdater {
  /**
   * A worker is installed and waiting. Called again every
   * {@link WAITING_NUDGE_INTERVAL_MS} while it still is, and it is told to
   * skip waiting every time. See the module header.
   */
  waitingWorker(worker: UpdateWorker): void;
  /** `controllerchange`, with the controller it changed to. */
  controllerChanged(controller: UpdateWorker | null): void;
  /** `visibilitychange`, or a page restored from the back/forward cache. */
  visibilityChanged(): void;
  /** One of {@link INTERACTION_EVENTS}. */
  interacted(): void;
  /**
   * `vite:preloadError`. True when a reload is on its way, now or at the next
   * safe moment; false when this page has already reloaded once for its build,
   * or has no session storage to remember that in — without the flag nothing
   * could stop a build that is missing a chunk from reloading for ever.
   */
  chunkLoadFailed(): boolean;
  dispose(): void;
}

type Moment = 'takeover' | 'chunk' | 'released' | 'hidden' | 'visible';

export function createSilentUpdater(host: SilentUpdateHost): SilentUpdater {
  let controlled = host.controlled;
  let disposed = false;
  let reloaded = false;
  let updateOwed = false;
  let chunkOwed = false;
  let lastInteractionAt = Number.NEGATIVE_INFINITY;
  /** Which `controllerchange` a build-id answer belongs to. */
  let takeover = 0;

  const reloadWhenSafe = (moment: Moment) => {
    if (disposed || reloaded || !(updateOwed || chunkOwed)) return;
    if (criticalWorkInFlight() || host.isEngaged()) return;
    const hidden = host.isHidden();
    // Mid-use: wait for the page to be put away, or brought back.
    if (moment === 'takeover' && !hidden && host.now() - lastInteractionAt < INTERACTION_QUIET_MS) {
      return;
    }
    // The work has just finished on screen, so its result is on screen too.
    // Leave it there until the page is put away or brought back.
    if (moment === 'released' && !hidden) return;
    reloaded = true;
    host.reload();
  };

  const unsubscribe = subscribeCriticalWork((inFlight) => {
    if (!inFlight) reloadWhenSafe('released');
  });

  return {
    waitingWorker(worker) {
      if (disposed || !controlled) return;
      try {
        worker.postMessage({ type: 'SKIP_WAITING' }, []);
      } catch {
        // A worker that went redundant in between has nothing left to activate.
      }
    },

    controllerChanged(controller) {
      if (disposed) return;
      /* A page with no controller is a FIRST install, and the
         `clients.claim()` that follows it is not an update. `controlled` is
         kept here rather than read once at load: frozen there, it would still
         say "never controlled" at the next takeover — the real one — and
         swallow it, which is what two successive local builds showed on
         2026/08/26. */
      if (!controlled) {
        controlled = true;
        return;
      }
      if (!controller) return;
      takeover += 1;
      const asked = takeover;
      void host
        .askBuildId(controller)
        .catch(() => null)
        .then((workerBuildId) => {
          if (disposed || asked !== takeover) return;
          /* THE PHONE'S CASE. This page is already the build the new worker
             serves, so activating the worker was all that was owed. */
          if (workerBuildId !== null && workerBuildId === host.pageBuildId) {
            updateOwed = false;
            return;
          }
          updateOwed = true;
          reloadWhenSafe('takeover');
        });
    },

    visibilityChanged() {
      reloadWhenSafe(host.isHidden() ? 'hidden' : 'visible');
    },

    interacted() {
      lastInteractionAt = host.now();
    },

    chunkLoadFailed() {
      if (disposed || !host.session) return false;
      try {
        if (host.session.getItem(CHUNK_RELOAD_KEY) === host.pageBuildId) return false;
        host.session.setItem(CHUNK_RELOAD_KEY, host.pageBuildId);
      } catch {
        return false;
      }
      chunkOwed = true;
      reloadWhenSafe('chunk');
      return true;
    },

    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}
