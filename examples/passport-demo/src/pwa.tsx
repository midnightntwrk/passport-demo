import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Bell, Download, Share, SquarePlus, WifiOff } from 'lucide-react';

import {
  askWorkerBuildId,
  createSilentUpdater,
  INTERACTION_EVENTS,
  isTextEntry,
  OPEN_SHEET_SELECTOR,
  type SessionFlags,
  WAITING_NUDGE_INTERVAL_MS,
} from './lib/appUpdate.js';
import { BUILD_ID } from './lib/buildId.js';
import './pwa-install.css';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

/**
 * What the install sheet promises, and why there are two of them.
 *
 * WHERE THE BROWSER OFFERS THE INSTALL ITSELF — Chrome, Edge — the installed
 * app shares the browser's storage, so a Passport signed in before the install
 * is signed in after it and {@link INSTALL_LEDE} is simply true.
 *
 * ON iOS IT IS NOT. An installed web app gets a storage container of its own:
 * the passkey follows, through iCloud Keychain, but the profile and the
 * encrypted state stay behind in Safari, so the first thing the new app does is
 * ask for the passkey. Promising otherwise and then showing a sign-in screen
 * is the app telling somebody it is broken, in its own words, one tap after
 * they trusted it. {@link INSTALL_LEDE_IOS} says what happens instead.
 */
export const INSTALL_LEDE =
  'It opens full-screen, keeps you signed in, and is one tap away next time.';

export const INSTALL_LEDE_IOS =
  'It opens full-screen and is one tap away next time. You will sign in once more with your passkey.';

function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as NavigatorWithStandalone).standalone)
  );
}

function pwaRegistrationEnabled(): boolean {
  return import.meta.env.PROD || import.meta.env.VITE_ENABLE_PWA_DEV === 'true';
}

/* -------------------------------------------------------------------------- */
/* Mobile install and notifications invitation (2026/08/06)                   */
/*                                                                            */
/* On a phone, "install" is the difference between a tab someone loses and an */
/* icon on their home screen. Desktop keeps the quiet corner button it always */
/* had; only mobile gets the sheet, and only once — a prompt that reappears   */
/* after it has been declined is a nag, so ANY dismissal is permanent.        */
/*                                                                            */
/* Nothing here asks the browser for anything on load. `prompt()` runs on an  */
/* affirmative tap and nowhere else, and the notification permission is       */
/* requested only from its own explicit button, because a permission dialog   */
/* nobody asked for is the fastest way to a permanent "denied".               */
/* -------------------------------------------------------------------------- */

const INSTALL_DISMISSED_KEY = 'mn-passport:install-dismissed';
const NOTIFICATIONS_DECLINED_KEY = 'mn-passport:notifications-declined';

/**
 * Written by the app the first time a passkey Passport is created or signed
 * in to. Read here — never written — as the signal that the invitation is
 * worth making: "add this to your home screen" is a question for somebody who
 * has a Passport, not for somebody looking at the welcome screen, and a modal
 * sheet over an onboarding ceremony would be actively in the way.
 */
const PASSPORT_SESSION_KEY = 'passport-last-passkey';

/** How long the app is left alone after that before the invitation appears. */
const INSTALL_SHEET_DELAY_MS = 4_000;

/** How often the session signal is re-read while an invitation is pending. */
const SESSION_POLL_MS = 1_500;

/**
 * The floor on how often the browser is asked whether `/sw.js` has changed.
 *
 * The interval is the backstop, not the mechanism: the check that matters runs
 * on `visibilitychange` and `pageshow`, i.e. the moment somebody opens the
 * installed app. That is the literal question a reviewer asked on 2026/08/26
 * — "shouldn't it update on its own when I open the PWA?" — and until this
 * was added the answer was no: the only check was an hourly timer in a
 * document that a phone had long since backgrounded.
 */
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1_000;

/** How long an update check is left alone after one has just run. */
const UPDATE_CHECK_MIN_GAP_MS = 60 * 1_000;

function hasPassportSession(): boolean {
  try {
    return Boolean(window.localStorage.getItem(PASSPORT_SESSION_KEY));
  } catch {
    return false;
  }
}

/**
 * `sessionStorage`, or `null` where reading it throws — a sandboxed frame, or
 * site data blocked outright. Without it the chunk reload has nowhere to note
 * that it already happened, so it does not happen at all.
 */
function sessionFlags(): SessionFlags | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Without storage the invitation may be offered once more. Acceptable;
    // silently failing to record it is not worth blocking the flow over.
  }
}

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 860px)').matches;
}

/**
 * iOS, including iPadOS, which reports itself as a Mac with a touchscreen.
 * iOS has no `beforeinstallprompt` at all, so it gets instructions instead of
 * a button that cannot work.
 */
function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Safari proper — not Chrome, Firefox, or Edge wearing its engine. */
function isSafariBrowser(): boolean {
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Android/.test(ua);
}

/**
 * How long the persistent-storage request may hold onboarding before it is
 * treated as unanswered.
 *
 * Firefox answers `navigator.storage.persist()` with a permission doorhanger,
 * and the promise stays pending until somebody presses it — for ever, if the
 * reader ignores it or the browser is headless. Onboarding awaited that
 * promise, so every Firefox walk stopped at "Encrypting your Passport state on
 * this device" (found by the cross-browser suite, 2026/09/05). Persistence is
 * a nicety: nothing about the passkey, the account, or the state just written
 * depends on it, so it may not hold the critical path open.
 */
export const STORAGE_PERSISTENCE_TIMEOUT_MS = 3_000;

export async function requestPassportStoragePersistence(
  timeoutMs = STORAGE_PERSISTENCE_TIMEOUT_MS,
): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unanswered = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const answer = (async () => {
      if (await navigator.storage.persisted?.()) return true;
      return navigator.storage.persist();
    })();
    /* The request itself is left running: a doorhanger answered later still
       takes effect, and nothing is waiting on it any more. */
    return await Promise.race([answer, unanswered]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function PassportPwaShell({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandaloneDisplay);
  const [installSheetOpen, setInstallSheetOpen] = useState(false);
  const [installSheetSettled, setInstallSheetSettled] = useState(() =>
    readFlag(INSTALL_DISMISSED_KEY),
  );
  const [notificationsAsked, setNotificationsAsked] = useState(() =>
    readFlag(NOTIFICATIONS_DECLINED_KEY),
  );
  const [mobile] = useState(isMobileViewport);
  const [ios] = useState(isIosDevice);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setStandalone(true);
      // Installed is the strongest possible "do not ask again".
      setInstallSheetOpen(false);
      setInstallSheetSettled(true);
      writeFlag(INSTALL_DISMISSED_KEY);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  /* --- Keeping an installed Passport on the deployed build ----------------- */

  /**
   * The whole update path, and the fix for the 2026/08/26 incident in which a
   * reviewer's installed PWA served a client build weeks out of date. The
   * worker's half is written up in `public/sw.js`; the two halves that live
   * here are:
   *
   *   ASK OFTEN ENOUGH. `registration.update()` runs when the app becomes
   *   visible and when a page is restored from the back/forward cache — i.e.
   *   every time somebody opens the installed app — not only on a timer in a
   *   document a phone stopped running hours ago.
   *
   *   ACT WHEN IT LANDS, AND SAY NOTHING (2026/09/25). There is no update
   *   button and no update bar any more: an "Update Passport" button sat across
   *   the bottom of an Android phone offering a page its own build, and
   *   pressing it could only spin. Every decision the button and the bar used
   *   to put to the reader — whether a waiting worker is told to skip waiting,
   *   whether this page needs reloading at all, and when it is safe to — is
   *   `src/lib/appUpdate.ts`'s now. This effect only hands it the page's
   *   events.
   */
  useEffect(() => {
    const serviceWorkers =
      pwaRegistrationEnabled() && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    const updates = createSilentUpdater({
      pageBuildId: BUILD_ID,
      /* A page with no controller is a FIRST install, and the
         `clients.claim()` that follows it fires `controllerchange` on THIS
         page. That one is not an update; the updater tells the two apart from
         this starting point. */
      controlled: Boolean(serviceWorkers?.controller),
      isHidden: () => document.visibilityState === 'hidden',
      isEngaged: () =>
        isTextEntry(document.activeElement) ||
        document.querySelector(OPEN_SHEET_SELECTOR) !== null,
      now: () => Date.now(),
      reload: () => window.location.reload(),
      askBuildId: (worker) => askWorkerBuildId(worker),
      session: sessionFlags(),
    });

    const onVisibility = () => updates.visibilityChanged();
    const onInteraction = () => updates.interacted();
    /* A lazy chunk the deployment no longer serves. Vite raises this for a
       dynamic import that failed to load — the previous build's hashes are
       gone from the alias the moment a new one is promoted — and the reload
       is what brings the screen that import was for. */
    const onChunkLoadFailed = () => {
      updates.chunkLoadFailed();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    for (const type of INTERACTION_EVENTS) {
      window.addEventListener(type, onInteraction, { capture: true, passive: true });
    }
    window.addEventListener('vite:preloadError', onChunkLoadFailed);

    const stopListening = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
      for (const type of INTERACTION_EVENTS) {
        window.removeEventListener(type, onInteraction, { capture: true });
      }
      window.removeEventListener('vite:preloadError', onChunkLoadFailed);
      updates.dispose();
    };
    if (!serviceWorkers) return stopListening;

    let disposed = false;
    let updateTimer: number | undefined;
    let liveRegistration: ServiceWorkerRegistration | null = null;
    let lastCheckedAt = 0;

    /* A worker that finishes installing while this page is open. The shipped
       worker skips waiting on its own; telling it again costs nothing, and a
       worker installed by an OLDER `sw.js` — one that never skips waiting on
       its own — needs telling, which is precisely the state the 2026/08/26
       incident was. */
    const inspectInstallingWorker = (registration: ServiceWorkerRegistration) => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (!disposed && installing.state === 'installed') {
          updates.waitingWorker(registration.waiting ?? installing);
        }
      });
    };

    const noteWaitingWorker = (registration: ServiceWorkerRegistration) => {
      if (!disposed && registration.waiting) updates.waitingWorker(registration.waiting);
    };
    /* A worker still parked is told again, every few seconds, for as long as
       it waits: see `WAITING_NUDGE_INTERVAL_MS` for the measurement. Reading
       `registration.waiting` is all this costs while nothing is waiting. */
    let nudgeTimer: number | undefined;

    const checkForUpdate = () => {
      const registration = liveRegistration;
      if (!registration || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastCheckedAt < UPDATE_CHECK_MIN_GAP_MS) return;
      lastCheckedAt = now;
      void registration
        .update()
        .then(() => noteWaitingWorker(registration))
        .catch(() => undefined);
    };

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        if (disposed) return;
        liveRegistration = registration;
        lastCheckedAt = Date.now();
        noteWaitingWorker(registration);
        inspectInstallingWorker(registration);
        registration.addEventListener('updatefound', () => inspectInstallingWorker(registration));
        updateTimer = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
        nudgeTimer = window.setInterval(
          () => noteWaitingWorker(registration),
          WAITING_NUDGE_INTERVAL_MS,
        );
      } catch (error) {
        console.error('Midnight Passport service worker registration failed.', error);
      }
    };

    const onControllerChange = () => updates.controllerChanged(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    /* The reviewer's question, answered: opening the app IS the update check. */
    document.addEventListener('visibilitychange', checkForUpdate);
    window.addEventListener('pageshow', checkForUpdate);
    window.addEventListener('focus', checkForUpdate);

    const onLoad = () => {
      void register();
    };
    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
    }

    return () => {
      disposed = true;
      if (updateTimer) window.clearInterval(updateTimer);
      if (nudgeTimer) window.clearInterval(nudgeTimer);
      window.removeEventListener('load', onLoad);
      document.removeEventListener('visibilitychange', checkForUpdate);
      window.removeEventListener('pageshow', checkForUpdate);
      window.removeEventListener('focus', checkForUpdate);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      stopListening();
    };
  }, []);

  /* --- The mobile invitation ---------------------------------------------- */

  /**
   * Android and other Chromium browsers can only be invited once the browser
   * has told us it is installable. iOS never will, so it is invited on the
   * strength of being iOS Safari — and shown instructions, not a button.
   */
  const iosInstructional = ios && isSafariBrowser();
  const installSheetEligible =
    mobile && !standalone && !installSheetSettled && (Boolean(installPrompt) || iosInstructional);

  useEffect(() => {
    if (!installSheetEligible) return;
    /**
     * The invitation may only open once the user is clear of onboarding: a
     * session exists AND no identity screen (`.mnid-screen` — the name step,
     * and Backup/Ecosystem when routed to) is on show. The session key is
     * written the moment the wallet opens, which is BEFORE the name step, so
     * the session alone is not enough — on iOS, where no install event gates
     * the sheet, it would slide over "Choose your .night name" four seconds
     * into it (observed live, 2026/08/06).
     */
    const clearToOpen = () =>
      hasPassportSession() && !document.querySelector('.mnid-screen');
    // `localStorage` fires no same-tab event, so the signal is polled rather
    // than subscribed to. The sheet opens only after the app has been clear
    // for a full INSTALL_SHEET_DELAY_MS — an identity screen appearing mid-
    // countdown resets it, so the invitation follows the flow, it never
    // interrupts one.
    let clearSince: number | undefined;
    const tick = () => {
      if (!clearToOpen()) {
        clearSince = undefined;
        return;
      }
      clearSince = clearSince ?? Date.now();
      if (Date.now() - clearSince >= INSTALL_SHEET_DELAY_MS) {
        window.clearInterval(poll);
        setInstallSheetOpen(true);
      }
    };
    const poll = window.setInterval(tick, SESSION_POLL_MS);
    tick();
    return () => window.clearInterval(poll);
  }, [installSheetEligible]);

  /** Any dismissal is permanent — no second invitation, ever. */
  const dismissInstallSheet = useCallback(() => {
    setInstallSheetOpen(false);
    setInstallSheetSettled(true);
    writeFlag(INSTALL_DISMISSED_KEY);
  }, []);

  const acceptInstall = async () => {
    if (!installPrompt) return;
    // The affirmative tap, and the only place `prompt()` is ever called from
    // on mobile.
    setInstallSheetOpen(false);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstallPrompt(null);
    } finally {
      setInstallSheetSettled(true);
      writeFlag(INSTALL_DISMISSED_KEY);
    }
  };

  /**
   * Notifications are unavailable to an iOS Safari tab — the API only exists
   * for an installed app from 16.4 — so the button is not offered where it
   * could only fail. A previous refusal is remembered and never revisited.
   */
  const notificationsOfferable =
    typeof Notification !== 'undefined' &&
    Notification.permission === 'default' &&
    !notificationsAsked &&
    (!ios || standalone);

  const enableNotifications = async () => {
    if (!notificationsOfferable) return;
    setNotificationsAsked(true);
    try {
      const permission = await Notification.requestPermission();
      // "Denied" and "dismissed" both mean: do not put this in front of them
      // again. Only a grant leaves the flag unwritten.
      if (permission !== 'granted') writeFlag(NOTIFICATIONS_DECLINED_KEY);
    } catch {
      writeFlag(NOTIFICATIONS_DECLINED_KEY);
    }
  };

  return (
    <>
      {children}

      {!online && (
        <div className="pwa-offline-bar" role="status" aria-live="polite">
          <WifiOff size={15} aria-hidden="true" />
          <span>
            Offline shell. Sign-in, syncing, proofs, and transactions require a connection.
          </span>
        </div>
      )}

      {/* NO UPDATE BUTTON AND NO UPDATE BAR (2026/09/25). There used to be
          both: a "Reload" bar when a reload had been deferred, and an "Update
          Passport" button in the corner — full-width across the bottom on a
          phone — whenever a new worker had installed. Updating is the app's
          job, so it happens without either; see `src/lib/appUpdate.ts`.
          Nothing is announced to a screen reader in their place, because
          there is nothing for anybody to do: the reload happens only at a
          moment when there is nothing on screen to lose.

          The install button that shared the corner went on 2026/09/03.
          Installing is offered from Home's top bar (`screens/InstallPassport.tsx`),
          where a person looks for it, on every browser that can do it. */}

      {installSheetOpen && (
        <>
          <div
            className="pwainstall-scrim"
            role="presentation"
            onClick={dismissInstallSheet}
          />
          <section
            className="pwainstall-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwainstall-title"
          >
            <span className="pwainstall-grip" aria-hidden="true" />

            <header className="pwainstall-head">
              <span className="pwainstall-mark" aria-hidden="true">
                <SquarePlus size={20} strokeWidth={2} />
              </span>
              <div>
                <h2 id="pwainstall-title">Add Passport to your home screen</h2>
                {/* WHAT IS TRUE ON EACH PLATFORM, AND NOT A WORD MORE
                    (2026/09/05). This used to promise "keeps you signed in" to
                    everybody. On iOS it is false: an installed web app gets a
                    storage container of its own, so the passkey follows through
                    iCloud Keychain but every local record — the profile, the
                    encrypted state — stays behind in Safari, and the first
                    thing the new app does is ask for the passkey. Somebody who
                    read that sentence and then met a sign-in screen has been
                    told the app is broken by the app itself. Where the browser
                    offers the install itself, the app shares the browser's
                    storage and the original sentence was true, so it stands. */}
                <p>{iosInstructional && !installPrompt ? INSTALL_LEDE_IOS : INSTALL_LEDE}</p>
              </div>
            </header>

            {iosInstructional && !installPrompt ? (
              /* iOS fires no install event, so the only honest thing to offer
                 is the two taps the user has to make themselves. */
              <ol className="pwainstall-steps">
                <li>
                  <Share size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Tap the Share button in Safari&rsquo;s toolbar.</span>
                </li>
                <li>
                  <SquarePlus size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Choose &ldquo;Add to Home Screen&rdquo;.</span>
                </li>
              </ol>
            ) : null}

            <div className="pwainstall-actions">
              {installPrompt ? (
                <button
                  type="button"
                  className="pwainstall-primary"
                  onClick={() => void acceptInstall()}
                >
                  <Download size={17} strokeWidth={2} aria-hidden="true" />
                  Add to home screen
                </button>
              ) : null}

              {notificationsOfferable ? (
                <button
                  type="button"
                  className="pwainstall-secondary"
                  onClick={() => void enableNotifications()}
                >
                  <Bell size={16} strokeWidth={2} aria-hidden="true" />
                  Enable notifications
                </button>
              ) : null}

              <button
                type="button"
                className="pwainstall-secondary"
                onClick={dismissInstallSheet}
              >
                Not now
              </button>
            </div>

            <p className="pwainstall-note">
              Asked once. Dismiss it and Passport will not bring it up again.
            </p>
          </section>
        </>
      )}
    </>
  );
}
