/**
 * TIER 1 — the shipped Passport picks up a deployment without asking anybody.
 *
 * THE DEFECT THIS SPEC IS THE REGRESSION TEST FOR (2026/09/25)
 * ------------------------------------------------------------
 * On an Android phone, a page reloaded two minutes earlier — so already running
 * the new build, because navigations are network-first — showed an "Update
 * Passport" button full-width across the bottom of the screen. The new worker
 * was parked in `waiting` behind the old one, which still had a request in
 * flight: a waiting worker that has called `skipWaiting()` activates only once
 * the RUNNING worker has no pending events. The button offered the page its
 * own build, and pressing it spun on "Updating" for as long as the old worker
 * stayed busy. The fix removed the button and the "new version" bar, bounded
 * every fetch the worker makes, and moved every decision the button put to the
 * reader into `src/lib/appUpdate.ts`.
 *
 * WHY THE REAL BUILD, AND A DEPLOYMENT IN FRONT OF IT
 * ---------------------------------------------------
 * `e2e/serviceWorkerUpdate.spec.ts` drills the WORKER against a fixture page,
 * deliberately without the page's side of the rule. This drills the PAGE: the
 * production build `vite preview` serves, with its own `src/pwa.tsx`, its own
 * `appUpdate.ts`, and its own stamped `sw.js`, reached through a small proxy
 * that plays the part of Vercel between two deployments. A "deployment" here
 * is `sw.js` stamped with a different build id — the only thing a browser
 * compares to decide there is an update — and a `<meta>` in every HTML
 * response naming which deployment served it, so a reload is something a test
 * can see rather than infer.
 *
 * Every document the browser opens is watched for an update button or bar, for
 * the whole of every test, across reloads.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

import { INTERACTION_QUIET_MS } from '../src/lib/appUpdate.js';
import { installNetworkBoundary } from './mocks.js';
import { SIGN_IN_BUTTON } from './walkContext.js';

test.skip(
  process.env.RUN_LIVE === '1',
  'A deployment is simulated in front of the local preview build; the live tier has none to put it in front of.',
);

/** Two build ids that are not the page's own. */
const FORMER_BUILD = 'f0f0f0f0f0f0f0f0';
const NEXT_BUILD = 'b2b2b2b2b2b2b2b2';

/** Response headers a proxy must not copy: the body it sends is its own. */
const HOP_BY_HOP = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
]);

interface DeploymentState {
  /** What `sw.js` is stamped with; the real build id when `null`. */
  workerBuildId: string | null;
  /** Written into every HTML response, so a reload shows which one served it. */
  label: string;
}

interface Deployment {
  base: string;
  /** The build id the preview build was stamped with — the page's own. */
  realBuildId: string;
  deploy(next: DeploymentState): void;
  /** Requests for `pathname` are accepted and never answered. */
  neverAnswer(pathname: string): void;
  close(): Promise<void>;
}

/**
 * Serves the preview build through a proxy on an origin of its own, stamping
 * `sw.js` and labelling HTML as the current {@link DeploymentState} says.
 * Flipping the state IS a deploy.
 */
async function deployInFrontOf(upstream: string, first: DeploymentState): Promise<Deployment> {
  const worker = await fetch(new URL('/sw.js', upstream)).then((response) => response.text());
  const stamped = /const BUILD_ID = '([0-9a-f]{16})';/.exec(worker);
  if (!stamped) throw new Error(`The preview build's sw.js carries no stamped build id: ${upstream}`);
  const realBuildId = stamped[1];

  let current = first;
  const silent = new Set<string>();
  const parked: http.ServerResponse[] = [];

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://proxy');
      if (silent.has(url.pathname)) {
        parked.push(response);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const headers: Record<string, string> = {};
      for (const key of ['accept', 'accept-language', 'content-type', 'service-worker']) {
        const value = request.headers[key];
        if (typeof value === 'string') headers[key] = value;
      }
      try {
        const answer = await fetch(new URL(`${url.pathname}${url.search}`, upstream), {
          method: request.method,
          headers,
          body: ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : Buffer.concat(chunks),
          redirect: 'manual',
        });
        let body = Buffer.from(await answer.arrayBuffer());
        const outgoing: Record<string, string> = {};
        answer.headers.forEach((value, key) => {
          if (!HOP_BY_HOP.has(key)) outgoing[key] = value;
        });
        if (url.pathname === '/sw.js') {
          body = Buffer.from(
            body.toString('utf8').replaceAll(realBuildId, current.workerBuildId ?? realBuildId),
          );
        } else if ((outgoing['content-type'] ?? '').includes('text/html')) {
          body = Buffer.from(
            body
              .toString('utf8')
              .replace('<head>', `<head><meta name="passport-deployment" content="${current.label}">`),
          );
        }
        outgoing['content-length'] = String(body.length);
        response.writeHead(answer.status, outgoing);
        response.end(body);
      } catch {
        response.writeHead(502);
        response.end();
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    // `localhost`, not the loopback literal: a service worker needs a secure
    // context, and only `localhost` is one over plain HTTP.
    base: `http://localhost:${port}`,
    realBuildId,
    deploy: (next) => {
      current = next;
    },
    neverAnswer: (pathname) => {
      silent.add(pathname);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const response of parked) response.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Watches every document this page opens for an update button or bar, and
 * gives each document a token of its own so a reload can be told apart from
 * the same document still running. What was seen is kept in `sessionStorage`,
 * so it survives the reloads the tests cause.
 */
async function watchForUpdateOffers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __passportDocument: string }).__passportDocument = `${Date.now()}-${Math.random()}`;
    const offers = /Update Passport|new version of Passport/i;
    const check = () => {
      const control = document.querySelector('.pwa-action, .pwa-update-bar, .pwa-actions button');
      const text = document.body?.textContent ?? '';
      if (!control && !offers.test(text)) return;
      try {
        sessionStorage.setItem(
          'e2e:update-offered',
          control?.outerHTML.slice(0, 200) ?? (offers.exec(text)?.[0] ?? 'offered'),
        );
      } catch {
        // Without storage the watch cannot outlive a reload; the check below
        // still reads the current document.
      }
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

async function updateOffered(page: Page): Promise<string | null> {
  return page.evaluate(() => sessionStorage.getItem('e2e:update-offered'));
}

/** This document's token. `null` while a reload is between documents. */
async function documentToken(page: Page): Promise<string | null> {
  return page
    .evaluate(() => (window as unknown as { __passportDocument?: string }).__passportDocument ?? null)
    .catch(() => null);
}

/** Which deployment served the document on screen. */
async function deploymentLabel(page: Page): Promise<string | null> {
  return page
    .evaluate(
      () => document.querySelector('meta[name="passport-deployment"]')?.getAttribute('content') ?? null,
    )
    .catch(() => null);
}

/** Asks the worker in charge of this page which build it is. */
async function controllingBuildId(page: Page): Promise<string | null> {
  return page
    .evaluate(async () => {
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
    })
    .catch(() => null);
}

async function waitingWorker(page: Page): Promise<boolean | null> {
  return page
    .evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.waiting))
    .catch(() => null);
}

/** What `src/pwa.tsx` does when the app is opened: ask whether `sw.js` changed. */
async function askForUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await registration?.update();
  });
}

async function openPassport(page: Page, site: Deployment): Promise<void> {
  await page.goto(`${site.base}/`);
  await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  });
}

/** The reader switches to another app: the page is hidden. */
async function putAway(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('a deployed Passport reaches an open page without asking', () => {
  test('a page already on the new build is left alone while that build’s worker takes over — the phone, 2026/09/25', async ({
    page,
    baseURL,
  }) => {
    const site = await deployInFrontOf(baseURL!, { workerBuildId: FORMER_BUILD, label: 'first' });
    try {
      await installNetworkBoundary(page);
      await watchForUpdateOffers(page);
      /* The previous deployment's worker is the one in charge; the page itself
         is already the build the next worker will serve. */
      await openPassport(page, site);
      await expect.poll(() => controllingBuildId(page)).toBe(FORMER_BUILD);
      const firstDocument = await documentToken(page);

      /* THE PHONE'S STATE, EXACTLY. The running worker has a request in
         flight that never answers — a connection dropped mid-request — so the
         next worker installs and then waits behind it. */
      site.neverAnswer('/never-answers.svg');
      await page.evaluate(() => {
        void fetch('/never-answers.svg').catch(() => undefined);
      });
      site.deploy({ workerBuildId: site.realBuildId, label: 'second' });
      await askForUpdate(page);
      await expect.poll(() => waitingWorker(page), { timeout: 10_000 }).toBe(true);
      expect(await controllingBuildId(page)).toBe(FORMER_BUILD);

      /* The worker's own deadline ends the request, the next worker takes
         over, and nothing is shown or reloaded on the way: the page was
         already that build. */
      await expect
        .poll(() => controllingBuildId(page), { timeout: 45_000 })
        .toBe(site.realBuildId);
      await page.waitForTimeout(4_000);
      expect(await documentToken(page)).toBe(firstDocument);
      expect(await deploymentLabel(page)).toBe('first');
      expect(await waitingWorker(page)).toBe(false);
      expect(await updateOffered(page)).toBeNull();
    } finally {
      await site.close();
    }
  });

  test('an idle page not on the new build is reloaded into it, with nothing shown', async ({
    page,
    baseURL,
  }) => {
    const site = await deployInFrontOf(baseURL!, { workerBuildId: null, label: 'first' });
    try {
      await installNetworkBoundary(page);
      await watchForUpdateOffers(page);
      await openPassport(page, site);
      await expect.poll(() => controllingBuildId(page)).toBe(site.realBuildId);
      const firstDocument = await documentToken(page);

      site.deploy({ workerBuildId: NEXT_BUILD, label: 'second' });
      await askForUpdate(page);

      await expect.poll(() => deploymentLabel(page), { timeout: 45_000 }).toBe('second');
      const reloaded = await documentToken(page);
      expect(reloaded).not.toBeNull();
      expect(reloaded).not.toBe(firstDocument);
      await expect.poll(() => controllingBuildId(page)).toBe(NEXT_BUILD);

      /* One reload and no more: the reloaded page is controlled by the new
         worker from the start, so nothing asks for another. */
      await page.waitForTimeout(4_000);
      expect(await documentToken(page)).toBe(reloaded);
      expect(await updateOffered(page)).toBeNull();
    } finally {
      await site.close();
    }
  });

  test('a passkey prompt holds the reload until it ends, and the reload waits for the page to be put away', async ({
    page,
    baseURL,
  }) => {
    const site = await deployInFrontOf(baseURL!, { workerBuildId: null, label: 'first' });
    try {
      await installNetworkBoundary(page);
      await watchForUpdateOffers(page);
      /* A passkey prompt the reader has not answered yet: every WebAuthn call
         waits until the test dismisses it, as a person closing the sheet
         would. The app holds critical work for the whole ceremony. */
      await page.addInitScript(() => {
        const pending = () =>
          new Promise<never>((_, reject) => {
            const state = window as unknown as { __ceremonyOpen: boolean; __dismissCeremony: () => void };
            state.__ceremonyOpen = true;
            state.__dismissCeremony = () =>
              reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
          });
        Object.defineProperty(navigator.credentials, 'create', { configurable: true, value: pending });
        Object.defineProperty(navigator.credentials, 'get', { configurable: true, value: pending });
      });
      await openPassport(page, site);
      await expect.poll(() => controllingBuildId(page)).toBe(site.realBuildId);
      const firstDocument = await documentToken(page);

      await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
      await page.waitForFunction(() => (window as unknown as { __ceremonyOpen?: boolean }).__ceremonyOpen === true);
      /* Past the quiet period, so the tap that opened the prompt is not what
         holds the reload back: only the ceremony is. */
      await page.waitForTimeout(INTERACTION_QUIET_MS + 1_000);

      site.deploy({ workerBuildId: NEXT_BUILD, label: 'second' });
      await askForUpdate(page);
      await expect.poll(() => controllingBuildId(page), { timeout: 45_000 }).toBe(NEXT_BUILD);
      await page.waitForTimeout(4_000);
      expect(await documentToken(page)).toBe(firstDocument);
      expect(await deploymentLabel(page)).toBe('first');

      /* The reader closes the prompt. The screen that follows is theirs to
         read, so the reload still waits… */
      await page.evaluate(() => (window as unknown as { __dismissCeremony: () => void }).__dismissCeremony());
      await page.waitForTimeout(3_000);
      expect(await documentToken(page)).toBe(firstDocument);

      /* …until they put the page away. */
      await putAway(page);
      await expect.poll(() => deploymentLabel(page), { timeout: 15_000 }).toBe('second');
      expect(await documentToken(page)).not.toBe(firstDocument);
      expect(await updateOffered(page)).toBeNull();
    } finally {
      await site.close();
    }
  });
});
