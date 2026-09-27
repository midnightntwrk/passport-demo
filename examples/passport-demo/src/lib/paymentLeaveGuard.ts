/**
 * THE BROWSER'S OWN "LEAVE SITE?" WARNING, WHILE A PAYMENT HAS NOT GONE OUT
 * (2026/09/26).
 *
 * A payment is built, approved, and proved in this tab, and only then handed
 * to the network. Close the tab or the app before that hand-over and the
 * payment stops: nothing is sent, and nothing on the next open can finish it.
 * The progress sheet used to say "You can close this and keep using your
 * Passport. It carries on." — true of the sheet, and read as true of the app.
 * The screens now say to keep Passport open; this asks the browser to say it
 * too, at the one moment it matters.
 *
 * ONLY FOR THAT WINDOW. A `beforeunload` listener keeps a page out of the
 * back/forward cache for as long as it is registered, so it is added when the
 * payment starts and removed the moment it is handed over or ends — never
 * left on the page.
 *
 * AND IT HOLDS THE SILENT UPDATE BACK FOR THE SAME WINDOW. `./appUpdate.ts`
 * reloads the page into a new build only when no critical work is held
 * (`./appBusy.ts`), so the hold is taken BEFORE the listener goes on and
 * released AFTER it comes off: an update can never reload the page into the
 * browser's own warning, and never reload a payment that has not gone out.
 *
 * No React and no DOM beyond the target it is handed, so both orders are
 * drilled in `./paymentLeaveGuard.test.ts`.
 */

import { holdCriticalWork } from './appBusy.js';

/** A `beforeunload` listener, as the page calls it. */
export type LeaveListener = (event: BeforeUnloadEvent) => void;

/** The part of `window` the guard needs. */
export interface LeaveGuardTarget {
  addEventListener(type: 'beforeunload', listener: LeaveListener): void;
  removeEventListener(type: 'beforeunload', listener: LeaveListener): void;
}

/**
 * Asks the browser to warn before the page goes, and holds the silent update
 * back, until the returned function is called. Calling it twice is a no-op.
 */
export function guardUnsentPayment(
  target: LeaveGuardTarget,
  hold: () => () => void = holdCriticalWork,
): () => void {
  const release = hold();
  const warn: LeaveListener = (event) => {
    /* `preventDefault` is the standard; `returnValue` is what older Safari and
       Chromium still read. Browsers show their own wording, never ours. */
    event.preventDefault();
    event.returnValue = true;
  };
  target.addEventListener('beforeunload', warn);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    target.removeEventListener('beforeunload', warn);
    release();
  };
}
