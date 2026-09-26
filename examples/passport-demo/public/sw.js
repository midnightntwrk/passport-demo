/**
 * Passport's service worker.
 *
 * WHY THIS FILE CARRIES A BUILD ID (2026/08/26)
 * ---------------------------------------------
 * A reviewer's installed Passport served a months-old client for weeks. The
 * app shell was NEVER the problem — navigations have always been network-first
 * (`networkNavigation` below) and Vercel has always answered `/` with
 * `max-age=0, must-revalidate`. The problem was this file's own identity:
 *
 *   1. `CACHE_VERSION` used to be a hand-bumped literal. A browser decides
 *      there is an update by comparing the worker script BYTE FOR BYTE, so
 *      every deploy between two hand-bumps shipped a byte-identical `sw.js`
 *      and no update was detected AT ALL — not installed, not waiting, not
 *      offered. Sixteen days of deploys went by that way between 2026/08/04
 *      and 2026/08/20.
 *   2. When the bytes did change, the new worker installed and then sat in
 *      `waiting` for ever, because `install` did not call `skipWaiting()` and
 *      the waiting worker only activates once EVERY client on the origin has
 *      gone. An installed PWA on a phone is resumed, not closed, so that
 *      moment never arrived. The only escape was a corner button the user had
 *      to notice and press.
 *
 * `BUILD_ID` fixes both at the root. It is stamped by the build (see
 * `stampBuildId` in `vite.config.ts`) with a digest of everything
 * the client build emitted, so these bytes change on every deploy that changes
 * the client and on no other. The worker then activates itself rather than
 * depending on any page code — the page code is exactly what was stale.
 *
 * THE TRADE-OFF `skipWaiting()` BUYS, STATED
 * ------------------------------------------
 * A worker that claims a page mid-session can leave that page's lazily
 * imported chunks 404ing, because `activate` deletes the previous build's
 * caches and the alias no longer serves the previous build's hashes. That is
 * why `src/pwa.tsx` reloads a page that is not already running this build at
 * the first safe moment after this worker claims it — at once when Passport is
 * idle, later when it is in the middle of something — and why a lazy chunk
 * that 404s reloads the page once (`src/lib/appUpdate.ts`). Nothing about any
 * of it is shown or offered: updating is the app's job, not the reader's. The
 * exposure is one flow's dynamic import inside that window, and it is worth
 * it: an installed client that cannot update itself is worse than one that
 * reloads a beat early.
 *
 * `skipWaiting()` IS NOT THE WHOLE OF ACTIVATION (2026/09/25)
 * ----------------------------------------------------------
 * A waiting worker with the skip-waiting flag set still activates only once
 * the ACTIVE worker has no pending events — the Service Worker spec's "Try
 * Activate" asks both. Every fetch this file made used to be unbounded, so one
 * request that never answered kept the running worker "busy" and parked its
 * successor in `waiting` for as long as it hung. Measured on an Android phone
 * on 2026/09/25: the page was already on the new build, the new worker sat
 * `installed` behind the old one, and the "Update Passport" button that parked
 * state produced could only spin. See "NO NETWORK WAIT IN THIS WORKER IS
 * UNBOUNDED" below for the bounds.
 */

/**
 * Replaced at build time with a 16-character digest of the emitted client.
 * Left as the literal placeholder in source so `scripts/check-pwa.mjs` can
 * assert BOTH halves of the contract: the placeholder is here, and it is gone
 * from the build output.
 */
const BUILD_ID = '__BUILD_ID__';

const CACHE_PREFIX = 'midnight-passport-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${BUILD_ID}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${BUILD_ID}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/midnight-symbol.svg',
  // The wordmark IS the onboarding screen's only art, and onboarding is the
  // default first view — so it belongs in the shell rather than in the
  // runtime cache.
  '/midnight-wordmark.svg',
  '/icons/passport-192.png',
  '/icons/passport-512.png',
  '/icons/passport-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

/**
 * The two shell assets an install is NOT allowed to go without.
 *
 * `/index.html` is the app, and `/offline.html` is what `networkNavigation`
 * answers with when there is no network — the one screen whose whole purpose is
 * to exist when nothing else does. Every other entry in `SHELL_ASSETS` is art,
 * an icon, or the manifest: a missing one costs a letterbox where a picture
 * should be, and the runtime rule at the bottom of this file fetches it again
 * the moment a page asks for it.
 */
const REQUIRED_SHELL_ASSETS = ['/index.html', '/offline.html'];

/**
 * NO NETWORK WAIT IN THIS WORKER IS UNBOUNDED (2026/09/25)
 * --------------------------------------------------------
 * A `respondWith` or `waitUntil` promise that never settles is a pending event,
 * and a worker with a pending event cannot be replaced: the next build's
 * worker installs, calls `skipWaiting()`, and still waits (see the header).
 * On a phone — a connection dropped mid-request, a page frozen or parked in
 * the back/forward cache — a `fetch()` with no deadline can hang for minutes.
 * So every fetch below carries one, sized to what it fetches:
 *
 *   NAVIGATION_TIMEOUT_MS         the app shell. After it, the precached shell
 *                                 is served (or the offline page when there is
 *                                 none), so a slow network still opens the app.
 *   REFRESH_TIMEOUT_MS            the background refresh of a stable-url asset,
 *                                 its first fetch, and each shell precache —
 *                                 all small files, bounded headers and body.
 *   RESPONSE_HEADERS_TIMEOUT_MS   `/assets/**`, `/zk/**`, and `/zk-params/**`.
 *                                 ONLY the wait for response headers is bounded.
 *                                 A prover key is tens of megabytes and a phone
 *                                 on a slow link can take minutes to receive it
 *                                 honestly; cutting that off mid-transfer would
 *                                 turn slow into broken. What is not allowed is
 *                                 a request that never starts answering.
 */
const NAVIGATION_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 15_000;
const RESPONSE_HEADERS_TIMEOUT_MS = 30_000;

/**
 * A signal that aborts after `ms`. `AbortSignal.timeout` is Safari 16 and
 * Chrome 103 onwards, so an older engine gets the same thing from a controller
 * and a timer rather than no deadline at all.
 */
function deadlineSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * `request`, carrying `deadline` as well as its own signal.
 *
 * A request the page cancels — a navigation away, a reload — aborts
 * `request.signal`, and a plain `fetch(request)` follows it. Replacing the
 * signal outright would drop that, so the two are combined where
 * `AbortSignal.any` exists (Chrome 116, Safari 17.4) and the deadline alone is
 * used where it does not. Should an engine refuse to copy the request at all,
 * the fetch goes ahead unbounded, as it always did, rather than failing: a
 * `TypeError` here would reach `networkNavigation` as "offline" and show the
 * offline page to somebody who is online.
 */
function withDeadline(request, deadline) {
  const signal =
    typeof AbortSignal.any === 'function' && request.signal
      ? AbortSignal.any([request.signal, deadline])
      : deadline;
  try {
    return new Request(request, { signal });
  } catch {
    return request;
  }
}

/** `fetch`, with the whole exchange — headers and body — bounded by `ms`. */
function fetchWithin(request, ms) {
  return fetch(withDeadline(request, deadlineSignal(ms)));
}

/**
 * `fetch`, with only the wait for response headers bounded by `ms`. The timer
 * is disarmed the moment headers arrive, so the body streams for as long as it
 * takes. See {@link RESPONSE_HEADERS_TIMEOUT_MS}.
 */
async function fetchHeadersWithin(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(withDeadline(request, controller.signal));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Precaches the shell ONE ASSET AT A TIME, and why that is not fussiness.
 *
 * This used to be a single `cache.addAll(SHELL_ASSETS)`. `addAll` is all or
 * nothing: one asset answering 404 — a renamed icon, a CDN hiccup on the
 * wordmark, a request that lost the network mid-install — rejects the WHOLE
 * batch, nothing at all is written, `install` fails, and the browser DISCARDS
 * the worker. Nothing reaches the screen when that happens: the page carries on
 * being served by whichever worker is already in charge, which is the old build
 * — the exact silent-staleness this file's header is about, arriving by a
 * second route. And a discarded install is not retried on a timer; the browser
 * waits for the next update check to hand it the same bytes it has already
 * rejected.
 *
 * So each asset is fetched and put on its own, the install fails ONLY when one
 * of {@link REQUIRED_SHELL_ASSETS} could not be stored, and anything else that
 * did not make it is named in one warning a reviewer can read off a console
 * rather than inferred from a worker that quietly never appeared.
 */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const outcomes = await Promise.allSettled(
    SHELL_ASSETS.map(async (asset) => {
      // `cache: 'reload'` and not a plain URL: precaching the shell through
      // the HTTP cache is how a worker installs a copy of the deploy it is
      // replacing. Every one of these is fetched from the network, within a
      // deadline, so an install cannot hang on one asset either.
      const response = await fetchWithin(new Request(asset, { cache: 'reload' }), REFRESH_TIMEOUT_MS);
      // A 404 resolves rather than throwing, and caching it would put the
      // "not found" page under the shell's own address.
      if (!response.ok) throw new Error(`${asset} answered ${response.status}`);
      await cache.put(asset, response);
    }),
  );
  const missed = SHELL_ASSETS.filter((_, index) => outcomes[index].status === 'rejected');
  if (missed.length > 0) console.warn(`[sw] these shell assets were not cached: ${missed.join(', ')}`);
  const required = missed.filter((asset) => REQUIRED_SHELL_ASSETS.includes(asset));
  if (required.length > 0) throw new Error(`the app shell is incomplete: ${required.join(', ')}`);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheShell()
      // Activate as soon as the shell is in place instead of waiting for every
      // client on the origin to close. See the header: on an installed PWA
      // that moment never comes.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== STATIC_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      // Control the pages that are already open, so `controllerchange` fires
      // in them and `src/pwa.tsx` can act on it.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  // "Which build are you?", answerable from a running install. This incident
  // cost days because there was no way to ask that of a reviewer's phone.
  if (event.data?.type === 'BUILD_ID') event.ports?.[0]?.postMessage(BUILD_ID);
});

// The click side of the notifications `src/lib/notifications.ts` shows through
// this worker. Android Chrome forbids the page-side Notification constructor
// wherever a service worker is registered, so on the one platform this demo
// notifies from, every notification is shown here and every tap arrives here
// too — without this handler they would be inert.
//
// This is NOT push. There is no `push` handler, deliberately: a notification
// only ever exists because a running Passport tab observed something on its
// own wallet stream. See the scope note in `src/lib/notifications.ts`.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        return 'focus' in client ? client.focus() : undefined;
      }
      return self.clients.openWindow('/');
    }),
  );
});

async function networkNavigation(request) {
  try {
    const response = await fetchWithin(request, NAVIGATION_TIMEOUT_MS);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch (error) {
    /* A navigation that ran out of time HAS a network, just not a quick one,
       so this build's precached shell is served and the app opens and says
       for itself what it cannot reach. A navigation that failed outright has
       no network, and the offline page is the honest answer — as it is when
       there is no shell to serve. */
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const cache = await caches.open(SHELL_CACHE).catch(() => null);
      const shell = await cache?.match('/index.html');
      if (shell) return shell;
    }
    return (await caches.match('/offline.html')) || Response.error();
  }
}

/**
 * `/assets/**`, `/zk/**`, and `/zk-params/**`: served from the cache with no
 * revalidation at all, and fetched exactly once per build.
 *
 * `/assets/**` earns that by being content-hashed — a given URL's bytes can
 * never change. The ZK keys do NOT carry a hash in their URL, so they earn it
 * a different way: the cache these land in is named for `BUILD_ID`, and
 * `activate` above deletes every cache that is not the current build's. A
 * contract recompile ships a new build, which is a new id, which is a new
 * cache — the old keys are dropped rather than pinned. Immutability holds
 * WITHIN a build, which is exactly the lifetime of the cache holding them.
 *
 * TWO THINGS MAKE THAT TRUE RATHER THAN NEARLY TRUE (2026/09/14)
 * --------------------------------------------------------------
 * The lookup is `caches.open(STATIC_CACHE)` and then `.match`, NOT the
 * `caches.match(request)` this used to be. The bare form searches EVERY cache
 * on the origin in creation order, so the previous build's entries could answer
 * for this build in the window before `activate` has finished deleting them —
 * and a worker that has just called `skipWaiting()` starts handling fetches
 * inside exactly that window. Confined to this build's cache, an older build's
 * copy cannot be reached whether it has been deleted yet or not.
 *
 * And the app now asks for `/zk/**` with `?b=<build id>` on it (see
 * `src/lib/buildId.ts`, and the incident that put it there). `Cache.match` and
 * `Cache.put` key on the FULL url including the query unless `ignoreSearch` is
 * passed, and it is not passed anywhere here — so each build's artefacts are
 * stored and found under their own addresses, which is what makes the same
 * guarantee hold one layer up in the browser's HTTP cache too.
 */
async function immutableAsset(request) {
  const cache = await caches.open(STATIC_CACHE).catch(() => null);
  const cached = await cache?.match(request);
  if (cached) return cached;
  /* Headers within RESPONSE_HEADERS_TIMEOUT_MS, the body for as long as it
     takes — see that constant for why a prover key is never cut off. */
  const response = await fetchHeadersWithin(request, RESPONSE_HEADERS_TIMEOUT_MS).catch(() => null);
  if (response?.ok && response.type === 'basic') {
    /* THE CACHE WRITE MAY NOT DECIDE WHETHER THE DOWNLOAD SUCCEEDED
       (2026/09/05). `dist/zk` and `dist/zk-params` are 144 MB across a build
       and a first shielded withdrawal pulls roughly 54 MB of it, so on a phone
       `cache.put` is one of the likelier places to meet a QuotaExceededError.
       Unguarded, that rejection escaped this handler, `respondWith` turned it
       into a NETWORK ERROR, and the caller reported a file that had in fact
       just arrived as missing — under `wasmProver.ts`'s "run
       scripts/fetch-zk-params.mjs to stage …", which is advice for a developer
       about a machine that is not the reader's.

       So the write is best effort, exactly as the sibling `staticAsset` below
       already treats it: an over-quota device pays the download again next
       session and proves fine this one. The `caches.open` that guard applies
       to is now at the top of this function — the same handle serves the
       lookup and the write — and it is still allowed to fail to `null`. */
    await cache?.put(request, response.clone()).catch(() => undefined);
  }
  return response || Response.error();
}

/**
 * Everything else static — `/icons/**`, the wordmark, the manifest. These keep
 * a STABLE url across deploys, so a cached copy may be out of date and the
 * cached answer is always chased with a network refresh.
 */
async function staticAsset(request, event) {
  /* `caches.open(STATIC_CACHE)` and then `.match`, NOT the
     `caches.match(request)` this used to be — the correction `immutableAsset`
     got on 2026/09/14, for the same reason, applied to the sibling that was
     left behind. The bare form searches EVERY cache on the origin in creation
     order, so the PREVIOUS build's copy of a stable url — an icon, the
     wordmark, the manifest — can answer for this build in the window between
     `skipWaiting()` and `activate` finishing its deletions, which is precisely
     the window a worker that has just claimed a page is serving fetches in.
     Confined to this build's own cache, it cannot be reached at all.

     The window is short and the cost of losing that race is not: `pwa.tsx`
     reloads an idle page the instant this worker claims it, and the manifest
     the reloaded page reads decides which icons an installed Passport shows. */
  const cache = await caches.open(STATIC_CACHE).catch(() => null);
  const cached = await cache?.match(request);
  /* Bounded, headers and body: this promise is what `event.waitUntil` below
     holds the worker open on, and an unbounded one is exactly the pending
     event that parked the next build in `waiting` (see the header). */
  const network = fetchWithin(request, REFRESH_TIMEOUT_MS)
    .then(async (response) => {
      if (response.ok && response.type === 'basic') {
        /* Best effort, for the reason spelled out in `immutableAsset`: a
           rejected write must never turn a download that in fact succeeded
           into a network error at the caller. */
        await cache?.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network.then(() => undefined));
    return cached;
  }
  return (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // `/verify/**` is the step verifier — a read-only operator page that is not
  // part of the app and is deliberately unreachable from its UI. It is skipped
  // here for two reasons, and the first is a correctness one:
  // `networkNavigation` below caches EVERY successful navigation response as
  // `/index.html`, so a reviewer opening /verify/ in an installed Passport
  // would poison the app shell with the verifier's HTML. The second is that a
  // page whose whole job is to show what the chain says right now must never
  // be served from a cache.
  if (url.pathname === '/verify' || url.pathname.startsWith('/verify/')) return;

  // The app shell, and the one request that decides which build runs: always
  // from the network, so a new deploy's asset hashes are seen. The cached copy
  // is served only when the network is too slow to answer within
  // NAVIGATION_TIMEOUT_MS, and is never preferred to a live answer.
  if (request.mode === 'navigate') {
    event.respondWith(networkNavigation(request));
    return;
  }

  // The proving and verifier keys are the largest thing this origin serves and
  // were, until this branch existed, cached by nothing at all: `wasmProver.ts`
  // fetches them with `destination === ''` and their filenames (`.prover`,
  // `.verifier`, `.bzkir`) match no extension in the runtime rule below, so
  // both tests failed and every one fell through uncached. `dist/zk` is 99 MB
  // and `dist/zk-params` is 45 MB; a first shielded withdrawal pulls roughly
  // 54 MB of it, and the prover's in-memory Map dies with the tab — so that
  // download was paid again on every reload. They are immutable for a build
  // (see `immutableAsset`), so they take the same path `/assets/**` takes.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/zk/') ||
    url.pathname.startsWith('/zk-params/')
  ) {
    event.respondWith(immutableAsset(request));
    return;
  }

  const cacheableDestination = ['font', 'image', 'script', 'style', 'worker'].includes(
    request.destination,
  );
  const cacheableExtension = /\.(?:css|js|png|svg|wasm|woff2?)$/i.test(url.pathname);
  if (cacheableDestination || cacheableExtension) {
    event.respondWith(staticAsset(request, event));
  }
});
