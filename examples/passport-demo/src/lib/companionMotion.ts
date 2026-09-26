/**
 * WHEN THE COMPANION'S FACE MOVES, AND WHEN IT HOLDS STILL (2026/09/25).
 *
 * THE DEFECT
 * ----------
 * The face in Home's top bar is a 2D canvas from `bot-avatars`, redrawn every
 * animation frame for as long as it is on screen. Home is the screen a
 * Passport is left open on, so that was every frame for as long as anybody
 * left it: 2,401 frames in twenty seconds in the Pixel 7 profile, 7.2 s of a
 * main thread slowed six times against 2.7 s with the face removed, and, on a
 * Samsung phone with 125 MB free, a GPU process at 87% of one core while
 * nothing on the screen changed. The canvas sits in the bar, so each redraw is
 * composited with everything the bar is drawn over.
 *
 * THE RULE
 * --------
 * The face keeps its look — the same bot, the same colours, the same pose — and
 * moves only when there is a reason to:
 *
 *   - for {@link COMPANION_GREETING_MS} after it appears, so a Passport opened
 *     on Home still has a companion that is plainly alive;
 *   - for {@link COMPANION_AWAKE_MS} after it is pressed or focused;
 *   - for as long as a pointer rests on it, which is somebody playing with it.
 *
 * Otherwise it holds a still frame, which costs one draw and nothing after it.
 * Somebody who asked for reduced motion gets the still frame always, including
 * when they change the setting with the page open; the library only checked it
 * once, when the face first mounted.
 *
 * A hidden tab needs nothing from here: the library already stops its frame
 * loop while the document is hidden.
 *
 * No DOM and no React, on the same principle as `balanceWatch.ts`: the clock
 * and the timer are injected, so the rule is drilled with a hand-wound clock.
 * The glue is `useCompanionMotion` in `src/screens/Companion.tsx`.
 */

/** How long the face moves after it first appears. */
export const COMPANION_GREETING_MS = 4_000;

/** How long it moves after a press or focus. */
export const COMPANION_AWAKE_MS = 6_000;

export interface CompanionMotionOptions {
  /** Told each time the answer to "should it move now" changes. */
  onChange: (moving: boolean) => void;
  /** Whether the reader has asked for reduced motion. Asked on every decision. */
  reducedMotion?: () => boolean;
  /** Defaults to `Date.now`. */
  now?: () => number;
  /** Defaults to `setTimeout`. Returns whatever handle `clearTimer` takes. */
  setTimer?: (run: () => void, delayMs: number) => unknown;
  /** Defaults to `clearTimeout`. */
  clearTimer?: (handle: unknown) => void;
}

export interface CompanionMotion {
  /** Whether the face should be moving right now. */
  moving: () => boolean;
  /** Move for at least `ms` from now. Defaults to {@link COMPANION_AWAKE_MS}. */
  wake: (ms?: number) => void;
  /** A pointer has come to rest on the face (`true`) or left it (`false`). */
  hold: (held: boolean) => void;
  /** The reduced-motion preference changed; decide again. */
  reconsider: () => void;
  /** For good. Nothing is reported after this. */
  stop: () => void;
}

/**
 * Starts the rule for one face. It begins moving — the greeting — unless the
 * reader asked for reduced motion.
 */
export function startCompanionMotion(options: CompanionMotionOptions): CompanionMotion {
  const now = options.now ?? (() => Date.now());
  const reducedMotion = options.reducedMotion ?? ((): boolean => false);
  const setTimer =
    options.setTimer ?? ((run: () => void, delayMs: number) => setTimeout(run, delayMs));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let awakeUntil = now() + COMPANION_GREETING_MS;
  let held = false;
  let stopped = false;
  let timer: unknown = null;

  const decide = (): boolean => !reducedMotion() && (held || now() < awakeUntil);
  let current = decide();

  const update = (): void => {
    if (stopped) return;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    const next = decide();
    if (next !== current) {
      current = next;
      options.onChange(next);
    }
    /* The one timer is the end of the waking window, and only while it is the
       thing keeping the face moving. A held face waits for the pointer to leave. */
    if (next && !held) {
      timer = setTimer(() => {
        timer = null;
        update();
      }, awakeUntil - now());
    }
  };

  update();

  return {
    moving: () => current,
    wake: (ms = COMPANION_AWAKE_MS): void => {
      awakeUntil = Math.max(awakeUntil, now() + ms);
      update();
    },
    hold: (next: boolean): void => {
      held = next;
      update();
    },
    reconsider: update,
    stop: (): void => {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
