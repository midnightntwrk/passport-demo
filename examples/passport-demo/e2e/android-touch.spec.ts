/**
 * TOUCH TARGETS AND THE THEME CONTROL, AS A PHONE MEETS THEM (2026/09/25).
 *
 * The report was "the light/dark/system selector feels broken" on a budget
 * Android handset. Measured on the `chromium-pixel` profile, the control was
 * not slow — a switch applied in ~4 ms and painted in ~10–35 ms at a 6× CPU
 * throttle, with no layout shift — but each of its three segments was a
 * 28 × 26 button (30 × 32 on Home), three targets ~30 px apart where Android
 * asks for 48 dp and Apple for 44 pt. A thumb aimed at one lands on its
 * neighbour or between them, and that reads as "broken".
 *
 * So this file holds three things on every project, and is written for
 * `chromium-pixel` — touch input, an Android user agent, a device pixel ratio:
 *
 *   1. every segment of the theme control is at least 44 × 44 CSS px, on
 *      every screen that shows one;
 *   2. a tap on each segment applies exactly that theme — the attribute on
 *      <html>, the stored preference, and the pressed state — every time;
 *   3. a switch moves nothing on the page (no layout shift);
 *
 * and, across the main screens, that nothing a person can press renders
 * smaller than 44 × 44. A target may meet that with an invisible hit area — an
 * absolutely positioned `::after`, as the 34 px icon buttons do — so the check
 * measures the area a tap can land on, not the drawing.
 *
 * The Send sheet is not swept here: it is being reworked on its own branch
 * (PR #98), and its two small in-field buttons belong to that change.
 */

import { expect, test, type Page } from '@playwright/test';

import { CUSTODY_WALK, custodyPassportOnHome, homeGreeting } from './custodyWalk.js';

const OPTIONS = [
  { label: 'Light', stored: 'light', attribute: 'light' },
  { label: 'Dark', stored: 'dark', attribute: 'dark' },
  /* 'system' REMOVES the attribute, so the stylesheet's media query decides. */
  { label: 'Match system', stored: 'system', attribute: null },
] as const;

const MIN = 44;

/** The splash covers the landing for its first half second; nothing under it can be tapped. */
async function splashGone(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getElementById('mn-splash') === null, undefined, {
    timeout: 30_000,
  });
}

/** Taps with a finger where the project has one, and clicks where it does not. */
async function tap(page: Page, label: string): Promise<void> {
  const option = page.getByRole('button', { name: label, exact: true }).first();
  if (test.info().project.use.hasTouch) await option.tap();
  else await option.click();
}

/**
 * Everything on screen a person can press, with the area a tap can land on —
 * the element's own box, grown by an absolutely positioned `::after` where it
 * has one — for each one smaller than 44 × 44.
 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const selector =
      'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="link"], input:not([type="hidden"]), select, textarea, summary';
    const small: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden') continue;
      /* The LAYOUT size, not the painted one: a card still easing in under a
         `scale()` would otherwise measure a 44 px button at 43. */
      let width = element.offsetWidth;
      let height = element.offsetHeight;
      const slop = getComputedStyle(element, '::after');
      if (slop.content !== 'none' && slop.position === 'absolute') {
        width -= (parseFloat(slop.left) || 0) + (parseFloat(slop.right) || 0);
        height -= (parseFloat(slop.top) || 0) + (parseFloat(slop.bottom) || 0);
      }
      /* Sub-pixel layout can put a 44 px box at 43.99. */
      if (width + 0.5 >= min && height + 0.5 >= min) continue;
      const name = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ');
      small.push(`${element.tagName.toLowerCase()}.${element.className.toString().split(' ')[0]} "${name.slice(0, 40)}" ${Math.round(width)}×${Math.round(height)}`);
    }
    return small;
  }, MIN);
}

/** Every theme segment on screen is a 44 × 44 target. */
async function expectThemeTargets(page: Page, screen: string): Promise<void> {
  const boxes = await page.locator('.mnthemetoggle-option').evaluateAll((options) =>
    options
      .map((option) => option.getBoundingClientRect())
      .filter((box) => box.width > 0)
      .map((box) => ({ width: box.width, height: box.height })),
  );
  expect(boxes.length, `${screen}: a theme control is on screen`).toBeGreaterThanOrEqual(3);
  for (const box of boxes) {
    expect(box.width, `${screen}: segment width`).toBeGreaterThanOrEqual(MIN);
    expect(box.height, `${screen}: segment height`).toBeGreaterThanOrEqual(MIN);
  }
}

/**
 * Taps each segment several times over and checks each tap applied its own
 * theme, with nothing on the page moving while it did.
 */
async function expectThemeTapsApply(page: Page, screen: string): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __shift: number };
    w.__shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number }[]) w.__shift += entry.value;
    }).observe({ type: 'layout-shift', buffered: false });
  });
  const control = page.locator('.mnthemetoggle').first();
  const before = await control.boundingBox();

  for (let round = 0; round < 3; round += 1) {
    for (const option of OPTIONS) {
      await tap(page, option.label);
      await expect
        .poll(
          () =>
            page.evaluate(
              (label) => ({
                attribute: document.documentElement.getAttribute('data-theme'),
                stored: localStorage.getItem('passport-theme'),
                pressed: document.querySelector(
                  `.mnthemetoggle-option[aria-label="${label}"][aria-pressed="true"]`,
                ) !== null,
              }),
              option.label,
            ),
          { message: `${screen}: "${option.label}" applied` },
        )
        .toEqual({ attribute: option.attribute, stored: option.stored, pressed: true });
      /* Every mounted control agrees, so none shows a stale selection. */
      const pressed = await page
        .locator('.mnthemetoggle-option[aria-pressed="true"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));
      expect(new Set(pressed), `${screen}: one selection`).toEqual(new Set([option.label]));
    }
  }

  expect(await page.evaluate(() => (window as unknown as { __shift: number }).__shift), `${screen}: layout shift`).toBe(0);
  expect(await control.boundingBox(), `${screen}: the control did not move`).toEqual(before);
  /* Leave the walk where it started, on the default. */
  await tap(page, 'Dark');
}

/** The on-screen notices, dismissed, so a sweep reads the screen rather than the toast. */
async function dismissNotices(page: Page): Promise<void> {
  for (const notice of await page.getByRole('button', { name: 'Dismiss notification' }).all()) {
    await notice.click().catch(() => {});
  }
}

test('the theme control is three 44 px targets, and each tap applies its theme with nothing moving', async ({
  browser,
}) => {
  const { page, close } = await custodyPassportOnHome(browser, async (walkPage, step) => {
    if (step === 'landing') {
      await splashGone(walkPage);
      await expectThemeTargets(walkPage, step);
      await expectThemeTapsApply(walkPage, step);
    } else {
      await expectThemeTargets(walkPage, step);
    }
  });

  await dismissNotices(page);
  await expectThemeTargets(page, 'home');
  await expectThemeTapsApply(page, 'home');

  for (const tab of [/Assets/i, /Apps/i]) {
    await page.locator('.mnnav .mnnav-tab', { hasText: tab }).click();
    await expectThemeTargets(page, String(tab));
  }
  await close();
});

test('nothing on the main screens is smaller than a 44 px target', async ({ browser }) => {
  const found: Record<string, string[]> = {};
  const { page, close } = await custodyPassportOnHome(browser, async (walkPage, step) => {
    if (step === 'landing') await splashGone(walkPage);
    found[step] = await smallTargets(walkPage);
  });

  await dismissNotices(page);
  found.home = await smallTargets(page);
  for (const [tab, screen] of [
    [/Assets/i, 'assets'],
    [/Apps/i, 'apps'],
  ] as const) {
    await page.locator('.mnnav .mnnav-tab', { hasText: tab }).click();
    found[screen] = await smallTargets(page);
  }
  await page.locator('.mnnav .mnnav-tab', { hasText: /Home/i }).click();
  await expect(homeGreeting(page)).toBeVisible();

  await page.getByRole('button', { name: /^Receive$/ }).first().click();
  await expect(page.getByRole('button', { name: 'Close' }).first()).toBeVisible();
  found.receive = await smallTargets(page);
  await close();

  /* The way-back step, which a Passport that has just been named sees first. */
  const recovery = await custodyPassportOnHome(browser, async () => {}, `${CUSTODY_WALK}&dynamicwalk=out`);
  await expect(recovery.page.getByTestId('add-recovery')).toBeVisible({ timeout: 60_000 });
  await dismissNotices(recovery.page);
  found['add recovery'] = await smallTargets(recovery.page);
  await recovery.close();

  expect(found).toEqual({
    landing: [],
    welcome: [],
    name: [],
    home: [],
    assets: [],
    apps: [],
    receive: [],
    'add recovery': [],
  });
});
