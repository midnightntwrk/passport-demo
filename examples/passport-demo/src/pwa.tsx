import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { WifiOff } from 'lucide-react';

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
import {
  INSTALL_SNOOZE_KEY,
  installAffordance,
  installCardVisible,
  installSnoozeValue,
  isMobileBrowser,
  type InstallAffordance,
} from './lib/installPrompt.js';

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

/* -------------------------------------------------------------------------- */
/* The browser's install offer, held for the whole page (2026/09/28)          */
/*                                                                            */
/* Chromium fires `beforeinstallprompt` ONCE, usually within a second of the  */
/* page loading — long before Home or the landing has mounted. So it is       */
/* caught here, as the module loads, and held where every install control    */
/* reads it: the card on Home, the landing's secondary action, and the top    */
/* bar's modest control. `prompt()` still runs on a press and nowhere else.   */
/*                                                                            */
/* THE TIMED INVITATION IS GONE. It was a sheet four seconds into a clear     */
/* screen that any dismissal retired for ever, and the reviewer could still   */
/* not tell how to install Passport. The card on Home replaces it; the sheet  */
/* it used is kept as the iPhone's step-by-step (`screens/InstallOffer.tsx`). */
/* -------------------------------------------------------------------------- */

interface InstallOfferState {
  /** The captured event, while the browser is willing to be asked. */
  readonly prompt: BeforeInstallPromptEvent | null;
  /** `appinstalled` has fired on this page. */
  readonly installed: boolean;
}

let installOfferState: InstallOfferState = { prompt: null, installed: false };
const installOfferListeners = new Set<() => void>();

function setInstallOfferState(next: InstallOfferState): void {
  installOfferState = next;
  for (const listener of installOfferListeners) listener();
}

function subscribeInstallOffer(listener: () => void): () => void {
  installOfferListeners.add(listener);
  return () => {
    installOfferListeners.delete(listener);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event: Event) => {
    /* Held rather than acted on: Chromium's own mini-infobar is suppressed,
       and the page replays the event from a press. */
    event.preventDefault();
    setInstallOfferState({ ...installOfferState, prompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    setInstallOfferState({ prompt: null, installed: true });
  });
}

/**
 * Replays the browser's own install dialogue, from a press. `'unavailable'`
 * where there is nothing held — iOS, or an event already spent.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const held = installOfferState.prompt;
  if (held === null) return 'unavailable';
  try {
    await held.prompt();
    const choice = await held.userChoice;
    /* An accepted prompt cannot be replayed, and is gone. A declined one is
       kept for the session: Chromium hands the page a fresh event when it is
       willing to be asked again, and a replay it refuses lands below. */
    if (choice.outcome === 'accepted') {
      setInstallOfferState({ ...installOfferState, prompt: null });
    }
    return choice.outcome;
  } catch {
    setInstallOfferState({ ...installOfferState, prompt: null });
    return 'unavailable';
  }
}

function readSnooze(): string | null {
  try {
    return window.localStorage.getItem(INSTALL_SNOOZE_KEY);
  } catch {
    return null;
  }
}

/** What every install control needs to know, read off this browser. */
export interface InstallOffer {
  /** What a control offers: the browser's prompt, the iPhone's steps, or nothing. */
  readonly affordance: InstallAffordance;
  /** A phone or tablet, where "your home screen" means something. */
  readonly mobile: boolean;
  /** Whether Home shows the install card: see `installCardVisible`. */
  readonly cardVisible: boolean;
  /** "Not now": the card goes for a week. */
  readonly snooze: () => void;
}

/**
 * The install offer, as a hook. Re-renders when the browser offers a prompt,
 * when Passport is installed, when the display mode changes, and on a snooze.
 * The rules are `lib/installPrompt.ts`'s, where they are drilled.
 */
export function useInstallOffer(): InstallOffer {
  const offer = useSyncExternalStore(subscribeInstallOffer, () => installOfferState);
  const [standalone, setStandalone] = useState(isStandaloneDisplay);
  const [snoozedUntil, setSnoozedUntil] = useState(readSnooze);
  useEffect(() => {
    /* An app opened in a tab and then launched from the home screen into the
       same document changes display mode without reloading. */
    const media = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setStandalone(isStandaloneDisplay());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const snooze = useCallback(() => {
    const value = installSnoozeValue(Date.now());
    try {
      window.localStorage.setItem(INSTALL_SNOOZE_KEY, value);
    } catch {
      /* Without storage the card is put away for this visit only. */
    }
    setSnoozedUntil(value);
  }, []);
  const environment = {
    standaloneDisplay: standalone || offer.installed,
    iosStandalone: (navigator as NavigatorWithStandalone).standalone,
    promptHeld: offer.prompt !== null,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  };
  return {
    affordance: installAffordance(environment),
    mobile: isMobileBrowser(environment.userAgent, environment.maxTouchPoints),
    cardVisible: installCardVisible({ ...environment, snoozedUntil, now: Date.now() }),
    snooze,
  };
}

function pwaRegistrationEnabled(): boolean {
  return import.meta.env.PROD || import.meta.env.VITE_ENABLE_PWA_DEV === 'true';
}

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

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
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

          The install button that shared the corner went on 2026/09/03, and
          the timed invitation sheet on 2026/09/28. Installing is offered on
          Home — a card on a phone, the top bar's control everywhere — and on
          the landing; see `screens/InstallOffer.tsx`. */}

    </>
  );
}
