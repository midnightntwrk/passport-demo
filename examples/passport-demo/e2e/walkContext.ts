/**
 * The device a walk is driven on, and why it is not the one written in the
 * spec any more.
 *
 * Every spec in this directory opens its OWN browser context — the walks are
 * stateful, a Passport lives across a whole file, and the `page` fixture gives
 * a fresh page per test. That is right, but it had one consequence nobody
 * noticed until the suite grew past a single project on 2026/09/05: a context
 * made by `browser.newContext()` inherits NOTHING from the project's `use`.
 * The device emulation a project declares — `devices['iPhone 14']`,
 * `devices['Pixel 7']` — reaches the `page` fixture and stops there. So a
 * `webkit-iphone` project would have run every walk in WebKit at the 420×900
 * desktop-ish viewport each spec hard-codes, with a Mac user agent, no touch,
 * and a device pixel ratio of 1: the engine would have been WebKit and nothing
 * else about it would have been an iPhone.
 *
 * This puts the project's device back on top. A spec still passes whatever
 * else its walk needs — `serviceWorkers: 'block'`, a permission, a locale —
 * and those are untouched; only the emulation keys are taken from the project,
 * and only where the project actually declares them.
 *
 * The `chromium` project declares the same 420×900 the specs hard-coded, so
 * the reference run is byte-for-byte the run it always was.
 */

import { test, type BrowserContextOptions } from '@playwright/test';

/**
 * THE BUTTON EVERY WALK STARTS BY PRESSING, matched under either of its names.
 *
 * It said "Continue with Passport" until 2026/09/16, "Continue with Passkey"
 * until 2026/09/22, and is "Sign up" now: the landing has two buttons, "Log in"
 * (the platform's passkey picker) and "Sign up" (discover, then enrol only if
 * nothing answers), and "Sign up" is the one that behaves as the old single
 * button did. Walks that mean the picker press "Log in" by its exact name.
 *
 * The rename is harmless for the mocked tiers, which serve the page they then
 * press — but the live walk presses a button on a DEPLOYED build, and the
 * deployed build is whatever staging or production is serving. A walk pinned
 * to the new label alone fails against production until the promotion, and
 * again the moment a rollback puts the old build back.
 *
 * So the locator accepts the retired labels too, anchored at both ends so it
 * can never match "Log in", the recovery link, or anything else on the new
 * landing. ONE constant does it everywhere — a name spelled out in nineteen
 * files is a name that gets half-renamed. The landing walk in
 * `onboarding.spec.ts` separately asserts that no "Continue with …" button is
 * on the new build, so the tolerance costs the mocked tiers no precision.
 */
export const SIGN_IN_BUTTON = /^(?:Sign up|Continue with Pass(?:port|key))$/i;

/** The context options that describe a DEVICE rather than a behaviour. */
const EMULATION = [
  'viewport',
  'userAgent',
  'deviceScaleFactor',
  'isMobile',
  'hasTouch',
  'locale',
  'timezoneId',
  'colorScheme',
] as const;

/**
 * The spec's own context options with this project's device emulation applied
 * over the top.
 *
 * Call it at the point of `browser.newContext()`, inside a fixture or a hook —
 * it reads `test.info()`, which only exists while a test or hook is running.
 */
export function walkContextOptions(own: BrowserContextOptions = {}): BrowserContextOptions {
  const use = test.info().project.use as BrowserContextOptions;
  const device: BrowserContextOptions = {};
  for (const key of EMULATION) {
    const value = use[key];
    if (value !== undefined) (device as Record<string, unknown>)[key] = value;
  }
  return { ...own, ...device };
}
