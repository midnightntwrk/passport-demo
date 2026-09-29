/**
 * Whether to offer to install Passport, and which offer to make.
 *
 * The defect these drills stand against is the one reported on 2026/09/02: a
 * reviewer in an ordinary browser tab with no way to install the app. The two
 * ways of getting the fix wrong are equal and opposite — offering nothing to
 * somebody who could install, and offering a button to somebody it cannot work
 * for — so both are held to here, on real user-agent strings.
 */

import { describe, expect, it } from 'vitest';

import {
  alreadyInstalled,
  INSTALL_CARD_LINE,
  INSTALL_HINT_STEPS,
  INSTALL_LABEL,
  INSTALL_NOT_NOW,
  INSTALL_SHOW_HOW,
  INSTALL_SNOOZE_KEY,
  INSTALL_SNOOZE_MS,
  installAffordance,
  installCardVisible,
  installSnoozed,
  installSnoozeValue,
  isIosDevice,
  isMobileBrowser,
  isSafariBrowser,
  type InstallCardInput,
  type InstallEnvironment,
} from './installPrompt.js';

/* Real strings, taken as they are sent. A synthesised user agent proves
   nothing about the ones this app actually meets. */
const AGENTS = {
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  desktopSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  firefox:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
};

const environment = (over: Partial<InstallEnvironment>): InstallEnvironment => ({
  standaloneDisplay: false,
  promptHeld: false,
  userAgent: AGENTS.desktopChrome,
  maxTouchPoints: 0,
  ...over,
});

describe('isIosDevice', () => {
  it('knows an iPhone', () => {
    expect(isIosDevice(AGENTS.iphoneSafari, 5)).toBe(true);
    expect(isIosDevice(AGENTS.iphoneChrome, 5)).toBe(true);
  });

  it('knows an iPad pretending to be a Mac, by its touchscreen', () => {
    /* Apple made the two user agents identical on purpose. The touch points
       are the only thing left to tell them apart. */
    expect(isIosDevice(AGENTS.ipadSafari, 5)).toBe(true);
    expect(isIosDevice(AGENTS.desktopSafari, 0)).toBe(false);
  });

  it('is not confused by Android or a desktop', () => {
    expect(isIosDevice(AGENTS.androidChrome, 5)).toBe(false);
    expect(isIosDevice(AGENTS.desktopChrome, 0)).toBe(false);
  });
});

describe('isSafariBrowser', () => {
  it('accepts Safari on either platform', () => {
    expect(isSafariBrowser(AGENTS.desktopSafari)).toBe(true);
    expect(isSafariBrowser(AGENTS.iphoneSafari)).toBe(true);
  });

  it('rejects every browser wearing WebKit', () => {
    /* Chrome on iOS is WebKit too, but its toolbar is its own: "tap Share in
       Safari's toolbar" would be directions to a button that is not there. */
    expect(isSafariBrowser(AGENTS.iphoneChrome)).toBe(false);
    expect(isSafariBrowser(AGENTS.desktopChrome)).toBe(false);
    expect(isSafariBrowser(AGENTS.androidChrome)).toBe(false);
    expect(isSafariBrowser(AGENTS.firefox)).toBe(false);
  });
});

describe('alreadyInstalled', () => {
  it('accepts either browser’s way of saying so', () => {
    expect(alreadyInstalled(environment({ standaloneDisplay: true }))).toBe(true);
    expect(alreadyInstalled(environment({ iosStandalone: true }))).toBe(true);
  });

  it('is false in a tab, and where the browser has no opinion', () => {
    expect(alreadyInstalled(environment({}))).toBe(false);
    expect(alreadyInstalled(environment({ iosStandalone: false }))).toBe(false);
    expect(alreadyInstalled(environment({ iosStandalone: undefined }))).toBe(false);
  });
});

describe('installAffordance', () => {
  it('offers the browser’s own dialogue once it has offered us one', () => {
    expect(installAffordance(environment({ promptHeld: true }))).toBe('prompt');
    expect(
      installAffordance(environment({ promptHeld: true, userAgent: AGENTS.androidChrome })),
    ).toBe('prompt');
  });

  it('gives iOS Safari the two taps it has to make itself', () => {
    /* iOS fires no install event and never will, so a button would be a
       control that cannot work. */
    expect(
      installAffordance(environment({ userAgent: AGENTS.iphoneSafari, maxTouchPoints: 5 })),
    ).toBe('hint');
    expect(
      installAffordance(environment({ userAgent: AGENTS.ipadSafari, maxTouchPoints: 5 })),
    ).toBe('hint');
  });

  it('shows nothing inside the installed app', () => {
    /* Both ways of being installed, and on iOS especially — where the only
       answer on older versions is `navigator.standalone`. An install button
       inside the installed app is a screen not reading its own state. */
    expect(installAffordance(environment({ standaloneDisplay: true, promptHeld: true }))).toBe(
      'hidden',
    );
    expect(
      installAffordance(
        environment({
          iosStandalone: true,
          userAgent: AGENTS.iphoneSafari,
          maxTouchPoints: 5,
        }),
      ),
    ).toBe('hidden');
  });

  it('shows nothing where installing is not on offer at all', () => {
    /* Firefox on a desktop, and Chrome on iOS: neither can install this, and
       a dead control is worse than none. */
    expect(installAffordance(environment({ userAgent: AGENTS.firefox }))).toBe('hidden');
    expect(
      installAffordance(environment({ userAgent: AGENTS.iphoneChrome, maxTouchPoints: 5 })),
    ).toBe('hidden');
    /* Chromium that has not offered a prompt: it may yet, and until it does
       there is nothing to press. */
    expect(installAffordance(environment({ userAgent: AGENTS.desktopChrome }))).toBe('hidden');
  });
});

describe('the copy', () => {
  it('says what it does, and names no machinery', () => {
    expect(INSTALL_LABEL).toBe('Install Passport');
    expect(INSTALL_HINT_STEPS).toHaveLength(2);
    expect(INSTALL_CARD_LINE).toBe('Open it from your home screen, full screen, one tap away.');
    const copy = [INSTALL_LABEL, ...INSTALL_HINT_STEPS, INSTALL_CARD_LINE, INSTALL_SHOW_HOW, INSTALL_NOT_NOW]
      .join(' ')
      .toLowerCase();
    for (const word of [
      'wallet',
      'dust',
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'sdk',
      'dynamic',
      'pwa',
    ]) {
      expect(copy).not.toContain(word);
    }
  });
});

describe('the install card on Home (2026/09/28)', () => {
  const NOW = Date.UTC(2026, 8, 28, 12);
  const card = (over: Partial<InstallCardInput>): InstallCardInput => ({
    ...environment({ userAgent: AGENTS.androidChrome, maxTouchPoints: 5, promptHeld: true }),
    snoozedUntil: null,
    now: NOW,
    ...over,
  });

  it('knows a phone or a tablet by what it is, not by how wide its window is', () => {
    expect(isMobileBrowser(AGENTS.androidChrome, 5)).toBe(true);
    expect(isMobileBrowser(AGENTS.iphoneSafari, 5)).toBe(true);
    expect(isMobileBrowser(AGENTS.iphoneChrome, 5)).toBe(true);
    expect(isMobileBrowser(AGENTS.ipadSafari, 5)).toBe(true);
    expect(isMobileBrowser(AGENTS.desktopChrome, 0)).toBe(false);
    expect(isMobileBrowser(AGENTS.desktopSafari, 0)).toBe(false);
    expect(isMobileBrowser(AGENTS.firefox, 0)).toBe(false);
  });

  it('shows on a phone that can install Passport and has not', () => {
    // Android, with the browser's own prompt held.
    expect(installCardVisible(card({}))).toBe(true);
    // iPhone Safari, which has no prompt and is shown the two taps instead.
    expect(
      installCardVisible(card({ userAgent: AGENTS.iphoneSafari, promptHeld: false })),
    ).toBe(true);
  });

  it('never shows once Passport is installed', () => {
    expect(installCardVisible(card({ standaloneDisplay: true }))).toBe(false);
    expect(
      installCardVisible(card({ userAgent: AGENTS.iphoneSafari, promptHeld: false, iosStandalone: true })),
    ).toBe(false);
  });

  it('never shows where there is nothing to install with, or no home screen', () => {
    // Android before the browser has offered anything: a button would do nothing.
    expect(installCardVisible(card({ promptHeld: false }))).toBe(false);
    // Chrome on iOS has no Add to Home Screen the steps could name.
    expect(installCardVisible(card({ userAgent: AGENTS.iphoneChrome, promptHeld: false }))).toBe(false);
    // A desktop keeps its modest control in the bar, and gets no card.
    expect(installCardVisible(card({ userAgent: AGENTS.desktopChrome, maxTouchPoints: 0 }))).toBe(false);
  });

  it('goes away for a week on "not now", and comes back when the week is up', () => {
    const stored = installSnoozeValue(NOW);
    expect(Number(stored)).toBe(NOW + INSTALL_SNOOZE_MS);
    expect(INSTALL_SNOOZE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(INSTALL_SNOOZE_KEY).toBe('mn-passport:install-snoozed-until');
    expect(installCardVisible(card({ snoozedUntil: stored }))).toBe(false);
    expect(installCardVisible(card({ snoozedUntil: stored, now: NOW + INSTALL_SNOOZE_MS - 1 }))).toBe(false);
    // The snooze expiring: the card is back, because installing is encouraged.
    expect(installCardVisible(card({ snoozedUntil: stored, now: NOW + INSTALL_SNOOZE_MS }))).toBe(true);
    expect(installCardVisible(card({ snoozedUntil: stored, now: NOW + INSTALL_SNOOZE_MS + 1 }))).toBe(true);
  });

  it('reads anything it does not recognise as no snooze, and never more than a week', () => {
    expect(installSnoozed(null, NOW)).toBe(false);
    expect(installSnoozed(undefined, NOW)).toBe(false);
    expect(installSnoozed('', NOW)).toBe(false);
    expect(installSnoozed('1', NOW)).toBe(false);
    expect(installSnoozed('soon', NOW)).toBe(false);
    expect(installSnoozed('-5', NOW)).toBe(false);
    expect(installSnoozed(`${NOW + 1000}.5`, NOW)).toBe(false);
    expect(installSnoozed(` ${NOW + 1000} `, NOW)).toBe(true);
    // A date further ahead than any "not now" could write is not a snooze, so
    // it can never become the old "dismissed for ever" by another route.
    expect(installSnoozed(String(NOW + INSTALL_SNOOZE_MS), NOW)).toBe(true);
    expect(installSnoozed(String(NOW + INSTALL_SNOOZE_MS + 1), NOW)).toBe(false);
    expect(installSnoozed(String(NOW + 10 * INSTALL_SNOOZE_MS), NOW)).toBe(false);
  });
});
