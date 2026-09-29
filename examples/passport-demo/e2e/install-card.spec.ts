/**
 * "Install Passport", where a phone cannot miss it (2026/09/28).
 *
 * The review of that day: the install control was a 34 px glyph in Home's top
 * bar, and the reviewer could not tell how to install Passport — "make it
 * prominent, like Coinbase". A phone that has not installed Passport now gets
 * a card on Home, with the Companion, one line, and one button; the landing
 * offers the same as a secondary action; and a "not now" lasts a week.
 *
 * WHAT IS DRILLED WHERE. Every rule — installed or not, phone or desktop, the
 * week's snooze and its expiry — is `src/lib/installPrompt.ts`'s, drilled on
 * real user-agent strings in `installPrompt.test.ts`. What only a browser can
 * answer is here: that the card is on Home, that its button replays the
 * browser's own prompt, that it goes the moment Passport is installed, and
 * that an iPhone is shown the two taps rather than a button that cannot work.
 *
 * A PHONE ON EVERY PROJECT. The card is for a phone, and the reference
 * `chromium` project is a desktop at a phone's width — the one CI runs. So the
 * walks here are a phone whatever the project, by the device the walk asks
 * for. Headless Chromium fires no `beforeinstallprompt` of its own, so the
 * offer is synthesised the way `home-bar.spec.ts` synthesises it.
 */

import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';

import { custodyPassportOnHome } from './custodyWalk.js';
import { SIGN_IN_BUTTON } from './walkContext.js';

/** A Pixel 7, as Playwright describes one, without the browser choice. */
const ANDROID: BrowserContextOptions = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  viewport: { width: 412, height: 839 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
};

/** An iPhone's Safari, on whatever engine the project runs. */
const IPHONE: BrowserContextOptions = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

const SNOOZE_KEY = 'mn-passport:install-snoozed-until';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const card = (page: Page) => page.getByTestId('install-card');

/** The browser offering an install, and a record of whether it was asked to show it. */
async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted'): Promise<void> {
  await page.evaluate((answer) => {
    const win = window as unknown as { __installPrompted?: number };
    win.__installPrompted = 0;
    const event = new Event('beforeinstallprompt') as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<{ outcome: string; platform: string }>;
    };
    event.prompt = () => {
      win.__installPrompted = (win.__installPrompted ?? 0) + 1;
      return Promise.resolve();
    };
    event.userChoice = Promise.resolve({ outcome: answer, platform: 'web' });
    window.dispatchEvent(event);
  }, outcome);
}

const prompted = (page: Page) =>
  page.evaluate(() => (window as unknown as { __installPrompted?: number }).__installPrompted ?? 0);

/** Every control inside a box is a 44 px target or larger (#101). */
async function targetsAreLargeEnough(page: Page): Promise<void> {
  const sizes = await card(page)
    .locator('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()).map((r) => [r.width, r.height]));
  expect(sizes.length).toBeGreaterThan(0);
  for (const [width, height] of sizes) {
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
}

test.describe('the install card on Home (2026/09/28)', () => {
  test('a phone is offered Install Passport on Home, with the Companion, and the button raises the browser’s own prompt', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { page, close } = await custodyPassportOnHome(browser, undefined, undefined, ANDROID);
    try {
      /* Nothing to offer until the browser has offered something: a button
         here would be a control that cannot work. */
      await expect(card(page)).toHaveCount(0);
      await offerInstall(page);
      await expect(card(page)).toBeVisible();
      await expect(card(page).getByRole('heading', { name: 'Install Passport' })).toBeVisible();
      await expect(card(page)).toContainText('Open it from your home screen, full screen, one tap away.');
      /* The Companion's face is part of the card, and decoration only. */
      await expect(card(page).locator('.mninstall-card-face')).toHaveAttribute('aria-hidden', 'true');
      await targetsAreLargeEnough(page);
      /* Nothing on it names the machinery. */
      const text = (await card(page).innerText()).toLowerCase();
      for (const word of ['wallet', 'dust', 'contract', 'registry', 'indexer', 'resolver', 'sponsor', 'sdk', 'dynamic']) {
        expect(text).not.toContain(word);
      }

      await card(page).getByRole('button', { name: 'Install', exact: true }).click();
      await expect.poll(() => prompted(page)).toBe(1);
      /* Accepted: the prompt is spent, and there is nothing left to offer. */
      await expect(card(page)).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('the card goes the moment Passport is installed', async ({ browser }) => {
    test.setTimeout(240_000);
    const { page, close } = await custodyPassportOnHome(browser, undefined, undefined, ANDROID);
    try {
      await offerInstall(page, 'dismissed');
      await expect(card(page)).toBeVisible();
      /* Installed from the browser's own menu, not from the card. */
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      await expect(card(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Install Passport' })).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('"Not now" puts it away for a week, not for good', async ({ browser }) => {
    test.setTimeout(240_000);
    const { page, close } = await custodyPassportOnHome(browser, undefined, undefined, ANDROID);
    try {
      await offerInstall(page, 'dismissed');
      await expect(card(page)).toBeVisible();
      const before = Date.now();
      await card(page).getByRole('button', { name: 'Not now' }).click();
      await expect(card(page)).toHaveCount(0);
      /* The top bar's modest control is still there: the way to install is
         never taken away, only the invitation. */
      await expect(page.locator('.mnhome-bar-actions').getByRole('button', { name: 'Install Passport' })).toBeVisible();
      const until = Number(await page.evaluate((key) => window.localStorage.getItem(key), SNOOZE_KEY));
      expect(until).toBeGreaterThanOrEqual(before + WEEK_MS);
      expect(until).toBeLessThanOrEqual(Date.now() + WEEK_MS);

      /* Still away on the next visit inside the week. */
      await page.reload();
      await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)\.$/ })).toBeVisible({
        timeout: 60_000,
      });
      await offerInstall(page, 'dismissed');
      await expect(page.locator('.mnhome-bar-actions').getByRole('button', { name: 'Install Passport' })).toBeVisible();
      await expect(card(page)).toHaveCount(0);

      /* And back once the week is up, because installing is encouraged. */
      await page.evaluate((key) => window.localStorage.setItem(key, String(Date.now() - 1)), SNOOZE_KEY);
      await page.reload();
      await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)\.$/ })).toBeVisible({
        timeout: 60_000,
      });
      await offerInstall(page, 'dismissed');
      await expect(card(page)).toBeVisible();
    } finally {
      await close();
    }
  });

  test('an iPhone is shown the two taps, and told the installed app asks for the passkey once', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { page, close } = await custodyPassportOnHome(browser, undefined, undefined, IPHONE);
    try {
      /* iOS Safari fires no install event and never will: the card is there
         on the strength of being iOS Safari. */
      await expect(card(page)).toBeVisible();
      await targetsAreLargeEnough(page);
      await card(page).getByRole('button', { name: 'Show me how' }).click();
      const steps = page.getByTestId('install-steps');
      await expect(steps).toBeVisible();
      await expect(steps.getByRole('heading', { name: 'Add Passport to your home screen' })).toBeVisible();
      await expect(steps).toContainText('You will sign in once more with your passkey.');
      await expect(steps.locator('li')).toHaveText([/Tap Share in Safari’s toolbar\./, /Choose “Add to Home Screen”\./]);
      await steps.getByRole('button', { name: 'Done' }).click();
      await expect(steps).toHaveCount(0);
      /* Showing the steps is not a dismissal: the card stays. */
      await expect(card(page)).toBeVisible();
    } finally {
      await close();
    }
  });

  test('a desktop gets no card, only the bar’s modest control', async ({ browser }) => {
    test.setTimeout(240_000);
    const desktop: BrowserContextOptions = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      viewport: { width: 420, height: 900 },
      isMobile: false,
      hasTouch: false,
    };
    const { page, close } = await custodyPassportOnHome(browser, undefined, undefined, desktop);
    try {
      await offerInstall(page);
      await expect(page.locator('.mnhome-bar-actions').getByRole('button', { name: 'Install Passport' })).toBeVisible();
      await expect(card(page)).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('the landing offers Install Passport under Sign up and Log in, to a phone with no Passport', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { close } = await custodyPassportOnHome(
      browser,
      async (page, step) => {
        if (step !== 'landing') return;
        await offerInstall(page, 'dismissed');
        const install = page.getByTestId('landing-install');
        await expect(install).toBeVisible();
        await expect(install).toContainText('Install Passport');
        /* BELOW the two doors, not in front of them. */
        const signUp = await page.getByRole('button', { name: SIGN_IN_BUTTON }).boundingBox();
        const own = await install.boundingBox();
        expect(signUp).not.toBeNull();
        expect(own).not.toBeNull();
        expect(own!.y).toBeGreaterThan(signUp!.y);
        expect(own!.height).toBeGreaterThanOrEqual(44);
        await install.click();
        await expect.poll(() => prompted(page)).toBe(1);
      },
      undefined,
      ANDROID,
    );
    await close();
  });

  test('the landing offers Install Passport on a desktop too, with the steps for its browser (2026/09/29)', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const cases = [
      {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        step: 'Cast, save, and share',
      },
      {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
        step: 'Add to Dock',
      },
    ];
    for (const { userAgent, step: expected } of cases) {
      const desktop = { userAgent, viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false };
      const { close } = await custodyPassportOnHome(
        browser,
        async (page, step) => {
          if (step !== 'landing') return;
          /* No prompt held: the case that used to render nothing at all. */
          const install = page.getByTestId('landing-install');
          await expect(install).toBeVisible();
          await expect(install).toContainText('Install Passport');
          await install.click();
          const steps = page.getByTestId('install-steps');
          await expect(steps).toBeVisible();
          await expect(steps).toContainText(expected);
          await steps.getByRole('button', { name: 'Done' }).click();
          await expect(steps).toHaveCount(0);
        },
        undefined,
        desktop,
      );
      await close();
    }
  });
});
