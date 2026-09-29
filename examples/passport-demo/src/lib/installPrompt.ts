/**
 * WHETHER TO OFFER TO INSTALL PASSPORT, AND WHICH OFFER TO MAKE.
 *
 * THE DEFECT
 * ----------
 * Reported 2026/09/02: a reviewer running Passport in an ordinary browser tab
 * found no way to install it. There WAS one — a corner button in `pwa.tsx` —
 * but it only appeared on a desktop viewport, only once Chromium had fired
 * `beforeinstallprompt`, and nowhere near where anybody looks. On mobile the
 * only offer was a one-shot sheet four seconds into a clear screen, which any
 * dismissal retires permanently. A person who says "not now" once, or who
 * never sees it, has no route back.
 *
 * So the offer moved to the top bar, where a person looks for it, and this
 * module is the rule that decides what it says. There are exactly three
 * answers and the whole point is that the third one is honest:
 *
 *   `prompt` — Chromium has offered this page an install prompt and the page
 *              is holding it. A button, and pressing it opens the browser's
 *              own dialogue.
 *   `hint`   — iOS Safari, which fires no install event and never will. Two
 *              taps the person has to make themselves, said plainly. A button
 *              here would be a control that cannot work.
 *   `hidden` — already installed, or a browser that can do neither. Offering
 *              an install to somebody who is running the installed app is the
 *              clearest possible signal that a screen is not reading its own
 *              state, and offering one to a browser that cannot install is a
 *              dead end dressed as a feature.
 *
 * WHY "ALREADY INSTALLED" IS TWO QUESTIONS
 * ----------------------------------------
 * `display-mode: standalone` is the standard answer and iOS does not give it
 * on every version; `navigator.standalone` is iOS's own, non-standard one and
 * exists nowhere else. Either being true means installed. Asking only the
 * standard one put an "Install Passport" button inside the installed app on
 * older iOS, which is the exact opposite of the fix.
 *
 * No DOM, no React, no `window`: the environment is passed in, so every rule
 * here is drilled directly rather than through a browser nobody can pin down.
 */

/** What the top bar should offer, if anything. */
export type InstallAffordance = 'prompt' | 'hint' | 'hidden';

/** Everything the rules need, read off the browser by the caller. */
export interface InstallEnvironment {
  /** `matchMedia('(display-mode: standalone)').matches`. */
  standaloneDisplay: boolean;
  /** `navigator.standalone` — iOS's own answer, absent everywhere else. */
  iosStandalone?: boolean | undefined;
  /** True once this page has captured a `beforeinstallprompt` it can replay. */
  promptHeld: boolean;
  /** `navigator.userAgent`. */
  userAgent: string;
  /** `navigator.maxTouchPoints`. iPadOS reports itself as a Mac. */
  maxTouchPoints: number;
}

/** The two taps an iOS reader has to make. Shown, never performed. */
export const INSTALL_HINT_STEPS: readonly string[] = [
  'Tap Share in Safari’s toolbar.',
  'Choose “Add to Home Screen”.',
];

/** The control's one label, shared by the button and its accessible name. */
export const INSTALL_LABEL = 'Install Passport';

/**
 * iOS, including iPadOS, which reports itself as a Mac with a touchscreen.
 * The touch-point test is the only thing separating an iPad from a laptop in a
 * user-agent string Apple deliberately made indistinguishable.
 */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * Safari proper — not Chrome, Firefox, Edge, or Opera wearing its engine.
 *
 * It matters because only Safari has the Share sheet the hint names. Chrome on
 * iOS is running WebKit too, but its toolbar is its own and "tap Share in
 * Safari's toolbar" would be directions to a button that is not there.
 */
export function isSafariBrowser(userAgent: string): boolean {
  return (
    /Safari/.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Android/.test(userAgent)
  );
}

/** Running as an installed app, by either browser's way of saying so. */
export function alreadyInstalled(environment: InstallEnvironment): boolean {
  return environment.standaloneDisplay || environment.iosStandalone === true;
}

/** The one decision. See the module header for what each answer means. */
export function installAffordance(environment: InstallEnvironment): InstallAffordance {
  if (alreadyInstalled(environment)) return 'hidden';
  if (environment.promptHeld) return 'prompt';
  if (
    isIosDevice(environment.userAgent, environment.maxTouchPoints) &&
    isSafariBrowser(environment.userAgent)
  ) {
    return 'hint';
  }
  return 'hidden';
}

/* -------------------------------------------------------------------------- */
/* The card on Home, and how long a "not now" lasts (2026/09/28)              */
/* -------------------------------------------------------------------------- */

/*
 * THE REVIEW. The install control was a 34 px glyph in Home's top bar, and the
 * one invitation a phone got was a sheet four seconds in that any dismissal
 * retired for ever. The reviewer could not tell how to install Passport and
 * asked for it to be prominent, "like Coinbase". So a phone that has not
 * installed Passport gets a card on Home — the Companion, one line, and one
 * button — and a "not now" puts it away for a week rather than for good,
 * because installing is something this app wants people to do. The top bar
 * keeps its modest control, which is what a desktop is offered.
 */

/** The card's one line beneath "Install Passport". */
export const INSTALL_CARD_LINE = 'Open it from your home screen, full screen, one tap away.';

/** The iOS card's button, which shows the two taps rather than performing them. */
export const INSTALL_SHOW_HOW = 'Show me how';

/** The card's dismissal, and what it promises. */
export const INSTALL_NOT_NOW = 'Not now';

/** How long a "not now" keeps the card away: a week. */
export const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** Where the end of a snooze is kept, as epoch milliseconds. */
export const INSTALL_SNOOZE_KEY = 'mn-passport:install-snoozed-until';

/** The value to store for a "not now" pressed at `now`. */
export function installSnoozeValue(now: number): string {
  return String(now + INSTALL_SNOOZE_MS);
}

/**
 * Whether a stored snooze is still running at `now`.
 *
 * Anything that does not read as a whole number of milliseconds — nothing
 * stored, storage that threw and was read as `null`, a value some other build
 * wrote — is no snooze at all: the card shows, because a card that never came
 * back over a malformed value would be the old "dismissed for ever" by
 * accident. A snooze reaching further ahead than a week is not one this app
 * wrote — a clock that was wrong when it was written, say — and is read the
 * same way, for the same reason.
 */
export function installSnoozed(stored: string | null | undefined, now: number): boolean {
  if (typeof stored !== 'string' || !/^\d{1,16}$/.test(stored.trim())) return false;
  const until = Number(stored.trim());
  return until > now && until - now <= INSTALL_SNOOZE_MS;
}

/**
 * A phone or a tablet — somewhere "your home screen" means something.
 *
 * Read off the user agent, never the viewport: a desktop window made narrow is
 * still a desktop, and the card's promise is about a home screen it does not
 * have. iPadOS is found the way {@link isIosDevice} finds it.
 */
export function isMobileBrowser(userAgent: string, maxTouchPoints: number): boolean {
  return isIosDevice(userAgent, maxTouchPoints) || /Android|Mobi/i.test(userAgent);
}

/** Everything the card's rule needs. */
export interface InstallCardInput extends InstallEnvironment {
  /** What {@link INSTALL_SNOOZE_KEY} holds, or null. */
  readonly snoozedUntil: string | null;
  readonly now: number;
}

/**
 * Whether Home shows the install card.
 *
 * On a phone that can install Passport and has not — the browser holds an
 * install prompt, or it is iOS Safari — and has not said "not now" this week.
 * Installed, on a desktop, or in a browser that cannot install, never.
 */
export function installCardVisible(input: InstallCardInput): boolean {
  if (!isMobileBrowser(input.userAgent, input.maxTouchPoints)) return false;
  if (installAffordance(input) === 'hidden') return false;
  return !installSnoozed(input.snoozedUntil, input.now);
}

/* -------------------------------------------------------------------------- */
/* The landing's button, on every browser (2026/09/29)                        */
/* -------------------------------------------------------------------------- */
/*
 * THE REVIEW. The landing's "Install Passport" appeared only on a phone whose
 * browser could install right then, so a reviewer on a desktop saw nothing,
 * and a desktop Chrome that had not yet offered its prompt saw nothing either.
 * Every browser a reader is likely to hold CAN install Passport, or can say
 * where to go to: Chromium from its menu, Safari on a Mac from File → Add to
 * Dock (Safari 17), iOS from the Share sheet. So the landing always offers it,
 * unless Passport is already installed, and the press does the most it can:
 * the browser's own dialogue where the page holds one, and the right steps for
 * this browser where it does not.
 */

/** Which steps install Passport in this browser, when it cannot be asked directly. */
export type InstallGuide = 'ios' | 'android' | 'mac-safari' | 'chrome' | 'edge' | 'other';

/** One step, and the glyph beside it. */
export interface InstallGuideStep {
  readonly glyph: 'share' | 'add' | 'menu' | 'dock' | 'install' | 'browser';
  readonly text: string;
}

/** What the steps sheet says for one browser. */
export interface InstallGuideCopy {
  readonly title: string;
  readonly lede: string;
  readonly steps: readonly InstallGuideStep[];
}

/** The browser, read off the user agent — order matters: Edge and Chrome both say "Chrome", every iOS browser says "Safari". */
export function installGuide(userAgent: string, maxTouchPoints: number): InstallGuide {
  if (isIosDevice(userAgent, maxTouchPoints)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/Chrome|Chromium|CriOS/.test(userAgent) && !/OPR\//.test(userAgent)) return 'chrome';
  if (/Macintosh/.test(userAgent) && isSafariBrowser(userAgent)) return 'mac-safari';
  return 'other';
}

/** The steps for each browser. Shown, never performed. */
export const INSTALL_GUIDES: Readonly<Record<InstallGuide, InstallGuideCopy>> = {
  ios: {
    title: 'Add Passport to your home screen',
    lede: 'It opens full screen, like any other app.',
    steps: [
      { glyph: 'share', text: 'Tap Share in the browser’s toolbar.' },
      { glyph: 'add', text: 'Choose “Add to Home Screen”.' },
    ],
  },
  android: {
    title: 'Add Passport to your home screen',
    lede: 'It opens full screen, like any other app.',
    steps: [
      { glyph: 'menu', text: 'Open the browser’s menu (⋮).' },
      { glyph: 'install', text: 'Choose “Install app” or “Add to Home screen”.' },
    ],
  },
  'mac-safari': {
    title: 'Add Passport to your Dock',
    lede: 'It opens in its own window, one click away.',
    steps: [
      { glyph: 'menu', text: 'In the menu bar, choose File.' },
      { glyph: 'dock', text: 'Choose “Add to Dock”.' },
    ],
  },
  chrome: {
    title: 'Install Passport on this computer',
    lede: 'It opens in its own window, one click away.',
    steps: [
      { glyph: 'menu', text: 'Open Chrome’s menu (⋮) at the top right.' },
      { glyph: 'install', text: 'Choose “Cast, save, and share”, then “Install page as app”.' },
    ],
  },
  edge: {
    title: 'Install Passport on this computer',
    lede: 'It opens in its own window, one click away.',
    steps: [
      { glyph: 'menu', text: 'Open Edge’s menu (…) at the top right.' },
      { glyph: 'install', text: 'Choose “Apps”, then “Install this site as an app”.' },
    ],
  },
  other: {
    title: 'Install Passport',
    lede: 'This browser cannot install apps from a website.',
    steps: [
      { glyph: 'browser', text: 'Open this page in Chrome, Edge, or Safari.' },
      { glyph: 'install', text: 'Choose “Install Passport” there.' },
    ],
  },
};

/** The line under the landing's button: where Passport will live once installed. */
export function installLandingLine(guide: InstallGuide): string {
  if (guide === 'ios' || guide === 'android') return 'Keep it on your home screen';
  if (guide === 'mac-safari') return 'Keep it in your Dock';
  return 'Open it like an app, in its own window';
}

/** Whether the landing offers to install: always, unless Passport is installed already. */
export function landingInstallVisible(environment: InstallEnvironment): boolean {
  return !alreadyInstalled(environment);
}
