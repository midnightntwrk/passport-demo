/**
 * TIER 1 — can an installed Passport pick up a deployment?
 *
 * THE INCIDENT THIS SPEC IS THE REGRESSION TEST FOR (2026/08/26)
 * -------------------------------------------------------------
 * A reviewer's installed PWA served a client build weeks out of date: a sync
 * ring that had been deleted, a claim flow from before sponsorship. He asked
 * the right question — "shouldn't it update on its own when I open the PWA?"
 * — and the answer was no, for two compounding reasons, both of which live in
 * `public/sw.js` and both of which this file drills:
 *
 *   1. The worker's bytes did not change between deploys. `CACHE_VERSION` was
 *      a hand-bumped literal, and a browser decides a worker has been updated
 *      by comparing the script BYTE FOR BYTE. Deploys between two bumps were
 *      invisible: nothing installed, nothing waited, nothing was offered.
 *   2. When the bytes did change, the new worker installed and parked in
 *      `waiting`, because `install` never called `skipWaiting()` and a waiting
 *      worker only activates once EVERY client on the origin has gone. An
 *      installed PWA on a phone is resumed, not closed. That moment never came.
 *
 * WHY IT SERVES ITS OWN FIXTURE DEPLOYMENT
 * ----------------------------------------
 * The subject here is `public/sw.js` — the real, shipped file, read off disk
 * and stamped exactly as `stampBuildId()` in `vite.config.ts`
 * stamps it — against TWO successive deployments of a client. Producing two
 * real Passport builds inside one spec would take minutes and prove nothing
 * extra: what has to be true is that a worker sees a new deployment, takes
 * charge of an already-open client, and serves the new bundle. The fixture
 * makes "a new deployment" a one-line change of a variable, and everything
 * under test — precache, skipWaiting, claim, the per-build cache names, the
 * network-first shell, the `/verify/` bypass — is the shipped worker's own
 * code running in a real Chromium.
 *
 * The PAGE side of the fix — reload into a new build at a safe moment, never
 * reload a page already running it, and show nothing either way — is
 * deliberately NOT copied into this fixture, because a fixture asserting
 * against its own copy of a rule asserts nothing. Its decisions live in
 * `src/lib/appUpdate.ts` and are drilled at 100% by `src/lib/appUpdate.test.ts`;
 * the shipped build runs them end to end in `e2e/silent-update.spec.ts`. The
 * one exception is stated where it is made, in the deadline test below.
 *
 * Every assertion below FAILS against the worker as it stood at 90381f0.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');

/** The shipped worker, read from disk on every run. */
const WORKER_SOURCE = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');

/**
 * The build's stamping rule, reproduced: a digest of what the deployment
 * emitted, written over the placeholder. `vite.config.ts` digests the emitted
 * asset filenames and both HTML shells; a fixture deployment has one asset, so
 * that is what is digested here.
 */
function stamp(entryName: string): string {
  const buildId = createHash('sha256').update(entryName).digest('hex').slice(0, 16);
  return WORKER_SOURCE.replaceAll('__BUILD_ID__', buildId);
}

function buildIdFor(entryName: string): string {
  return createHash('sha256').update(entryName).digest('hex').slice(0, 16);
}

/** One fixture deployment: a shell, one content-hashed entry, and the worker. */
interface Deployment {
  /** Stands in for `main-<hash>.js`, and changes when the client changes. */
  entryName: string;
}

/**
 * Serves a deployment the way Vercel serves this app, including the two
 * cache-control rules `vercel.json` declares — `/assets/**` immutable, every
 * stable url revalidated. Flipping `current` IS a deploy.
 */
async function serveDeployment(initial: Deployment): Promise<{
  base: string;
  deploy: (next: Deployment) => void;
  /** Requests for `pathname` are accepted and never answered: a dropped connection. */
  neverAnswer: (pathname: string) => void;
  close: () => Promise<void>;
}> {
  let current = initial;
  const silent = new Set<string>();
  const parked: http.ServerResponse[] = [];

  const shell = () =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Passport fixture</title>` +
    `<link rel="manifest" href="/manifest.webmanifest"></head>` +
    `<body><div id="build">booting</div>` +
    `<script type="module" src="/assets/${current.entryName}.js"></script></body></html>`;

  const entry = (name: string) =>
    `document.getElementById('build').textContent = ${JSON.stringify(name)};\n` +
    `window.__build = ${JSON.stringify(name)};\n` +
    `navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });\n`;

  const verifyShell =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Step verifier</title>` +
    `</head><body><div id="verifier">the verifier, not the app</div></body></html>`;

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture');
    if (silent.has(url.pathname)) {
      parked.push(response);
      return;
    }
    const send = (body: string | Buffer, type: string, cacheControl: string) => {
      response.writeHead(200, { 'content-type': type, 'cache-control': cacheControl });
      response.end(body);
    };

    if (url.pathname === '/verify' || url.pathname === '/verify/') {
      return send(verifyShell, 'text/html; charset=utf-8', 'no-cache');
    }
    if (url.pathname.startsWith('/assets/')) {
      const name = url.pathname.slice('/assets/'.length).replace(/\.js$/, '');
      // A deployment that has rolled forward no longer serves the previous
      // build's hashes, exactly as an alias on Vercel does not.
      if (name !== current.entryName) {
        response.writeHead(404);
        return response.end('gone');
      }
      return send(entry(name), 'application/javascript', 'public, max-age=31536000, immutable');
    }
    if (url.pathname === '/sw.js') {
      return send(stamp(current.entryName), 'application/javascript', 'no-cache');
    }
    if (url.pathname === '/offline.html' || url.pathname === '/manifest.webmanifest') {
      const file = fs.readFileSync(path.join(publicDir, url.pathname.slice(1)));
      return send(file, url.pathname.endsWith('.html') ? 'text/html' : 'application/json', 'no-cache');
    }
    if (url.pathname.startsWith('/icons/') || url.pathname.endsWith('.svg')) {
      try {
        return send(fs.readFileSync(path.join(publicDir, url.pathname.slice(1))), 'image/png', 'no-cache');
      } catch {
        response.writeHead(404);
        return response.end('404');
      }
    }
    // The SPA rewrite: anything else is the shell.
    return send(shell(), 'text/html; charset=utf-8', 'no-cache');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    // `localhost` rather than the loopback literal: a service worker needs a
    // secure context, and only `localhost` is treated as one over plain HTTP.
    base: `http://localhost:${port}`,
    deploy: (next) => {
      current = next;
    },
    neverAnswer: (pathname) => {
      silent.add(pathname);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const response of parked) response.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Asks the worker in charge of this page which build it is. */
function controllingBuildId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return null;
    return new Promise<string | null>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 3_000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data as string);
      };
      worker.postMessage({ type: 'BUILD_ID' }, [channel.port2]);
    });
  });
}

function registrationState(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return {
      installing: Boolean(registration?.installing),
      waiting: Boolean(registration?.waiting),
      active: Boolean(registration?.active),
    };
  });
}

async function loadAndTakeControl(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/`);
  // The very first load registers the worker but is not controlled by it until
  // `clients.claim()` lands, which can be after this navigation finished.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  });
}

test.describe('a deployed Passport reaches an installed client', () => {
  test('a new deployment takes charge of an open client with no reload and no gesture', async ({
    page,
  }) => {
    /* THE REVIEWER'S CASE, EXACTLY. The client is never closed and never
       reloaded by anything the test does — an installed PWA on a phone is
       resumed, not restarted. Before the fix this failed twice over: with the
       worker's bytes unchanged between deploys nothing was even detected, and
       once they did change the new worker sat in `waiting` for ever. */
    const site = await serveDeployment({ entryName: 'main-aaaaaaaa' });
    try {
      await loadAndTakeControl(page, site.base);
      expect(await controllingBuildId(page)).toBe(buildIdFor('main-aaaaaaaa'));

      site.deploy({ entryName: 'main-bbbbbbbb' });

      /* The one thing the page does, and it is the same thing `src/pwa.tsx`
         does when the app becomes visible: ask whether `/sw.js` has changed. */
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        await registration?.update();
      });

      await expect
        .poll(() => controllingBuildId(page), { timeout: 20_000 })
        .toBe(buildIdFor('main-bbbbbbbb'));

      /* Nothing parked. A worker in `waiting` is the failure this whole change
         is about: it is a new build the client cannot reach. */
      expect(await registrationState(page)).toMatchObject({ waiting: false, active: true });
    } finally {
      await site.close();
    }
  });

  test('a reload after a deployment runs the new client, served by the new worker', async ({
    page,
  }) => {
    const site = await serveDeployment({ entryName: 'main-11111111' });
    try {
      await loadAndTakeControl(page, site.base);
      await expect(page.locator('#build')).toHaveText('main-11111111');

      site.deploy({ entryName: 'main-22222222' });
      await page.reload();

      // The shell is network-first, so the new deployment's asset hash is seen…
      await expect(page.locator('#build')).toHaveText('main-22222222');
      // …and the worker serving it is the new deployment's worker, not a stale
      // one that happens to be passing HTML through.
      await expect
        .poll(() => controllingBuildId(page), { timeout: 20_000 })
        .toBe(buildIdFor('main-22222222'));
      expect(await registrationState(page)).toMatchObject({ waiting: false });
    } finally {
      await site.close();
    }
  });

  test('the previous build’s caches are deleted, and the current one is cache-first', async ({
    page,
  }) => {
    const site = await serveDeployment({ entryName: 'main-cafe0001' });
    try {
      await loadAndTakeControl(page, site.base);

      const first = buildIdFor('main-cafe0001');
      await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(
        expect.arrayContaining([`midnight-passport-shell-${first}`]),
      );

      /* The FIRST visit fetched the entry before any worker controlled the
         page, so nothing saw that request. The second visit is the one the
         worker serves, and it is what puts the content-hashed entry in the
         runtime cache — from then on it is answered without a network round
         trip, because a `/assets/` url's bytes can never change. */
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await expect
        .poll(() => page.evaluate(() => caches.match('/assets/main-cafe0001.js').then(Boolean)))
        .toBe(true);

      site.deploy({ entryName: 'main-cafe0002' });
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        await registration?.update();
      });

      /* Activating the new worker purges every cache that is not its own, so
         the previous build's shell and runtime caches go with it. The new
         build's runtime cache is created on demand and so need not exist yet;
         what must be true is that NOTHING from the previous build survives to
         be served to somebody. */
      /* Polled on the WHOLE key set and not on a subset of it: the new build's
         shell cache exists from the moment the new worker installs, which is
         before it activates and purges anything. Waiting for the set to settle
         is waiting for the activation to have happened. */
      const second = buildIdFor('main-cafe0002');
      await expect
        .poll(() => page.evaluate(() => caches.keys().then((keys) => keys.sort())), {
          timeout: 20_000,
        })
        .toEqual([`midnight-passport-shell-${second}`]);
      expect(await page.evaluate(() => caches.match('/assets/main-cafe0001.js').then(Boolean))).toBe(
        false,
      );
    } finally {
      await site.close();
    }
  });

  test('a request that never answers holds the next worker no longer than the worker’s own deadline', async ({
    page,
  }) => {
    /* THE ANDROID PHONE, 2026/09/25. A waiting worker that has called
       `skipWaiting()` still activates only once the RUNNING worker has no
       pending events, and every fetch the worker made was unbounded — so one
       request that never answered, a connection dropped on a phone, parked the
       next build in `waiting` for as long as it hung. Against the worker as it
       stood before this test, the new worker never takes over here at all.

       `SKIP_WAITING` is posted to the waiting worker on every poll. That is the
       page's half — `src/lib/appUpdate.ts` does it every few seconds while a
       worker waits, because Chromium does not always re-check a parked worker
       once the running one goes idle — and it stands in for the page here so
       that what is asserted is the worker's deadline and nothing else. It
       cannot end the wait on its own: the first poll below shows it failing
       to for as long as the request is still in flight. */
    const site = await serveDeployment({ entryName: 'main-5ea10001' });
    try {
      await loadAndTakeControl(page, site.base);
      site.neverAnswer('/never-answers.svg');
      await page.evaluate(() => {
        void fetch('/never-answers.svg').catch(() => undefined);
      });

      site.deploy({ entryName: 'main-5ea10002' });
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        await registration?.update();
      });

      const nudgeAndAsk = async () => {
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration('/');
          registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
        });
        return controllingBuildId(page);
      };

      // Parked behind the request that has not answered…
      await expect.poll(() => registrationState(page)).toMatchObject({ waiting: true });
      for (let i = 0; i < 3; i += 1) {
        expect(await nudgeAndAsk()).toBe(buildIdFor('main-5ea10001'));
        await page.waitForTimeout(1_500);
      }

      // …until the worker's own deadline ends it, and the next build takes over.
      await expect
        .poll(nudgeAndAsk, { timeout: 45_000, intervals: [2_000] })
        .toBe(buildIdFor('main-5ea10002'));
      expect(await registrationState(page)).toMatchObject({ waiting: false });
    } finally {
      await site.close();
    }
  });

  test('the step verifier stays outside the caches and cannot poison the app shell', async ({
    page,
  }) => {
    /* `networkNavigation` stores EVERY successful navigation as `/index.html`.
       An operator opening `/verify/` in an installed Passport must not thereby
       replace the app's shell with the verifier's page. */
    const site = await serveDeployment({ entryName: 'main-99999999' });
    try {
      await loadAndTakeControl(page, site.base);

      await page.goto(`${site.base}/verify/`);
      await expect(page.locator('#verifier')).toBeVisible();

      await page.goto(`${site.base}/`);
      const shell = await page.evaluate(() =>
        caches.match('/index.html').then((response) => response?.text() ?? null),
      );
      expect(shell).not.toBeNull();
      expect(shell).toContain('/assets/main-99999999.js');
      expect(shell).not.toContain('the verifier, not the app');

      expect(await page.evaluate(() => caches.match('/verify/').then(Boolean))).toBe(false);
    } finally {
      await site.close();
    }
  });
});
