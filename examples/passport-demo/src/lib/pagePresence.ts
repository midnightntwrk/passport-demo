/**
 * WHETHER ANYBODY CAN SEE THIS PAGE, AND KEEPING IT SEEN WHILE IT MATTERS
 * (2026/09/27).
 *
 * WHAT THIS IS FOR
 * ----------------
 * Live on an Android phone: a recovery's proof was made on the service in 43
 * seconds and never reached the phone. The person had put it down; the screen
 * dimmed, Android froze the tab, and the request in flight was dropped with
 * "Failed to fetch". Three things follow, and they are the three halves of
 * this module:
 *
 *   - {@link holdScreenAwake} asks the platform to keep the screen on while a
 *     step is being proved or submitted, and asks again each time the page
 *     comes back, because the platform lets go of it whenever the page is
 *     hidden. Where there is no such thing to ask for, nothing happens.
 *   - {@link watchDrop} and {@link pageBack} say whether the page went away
 *     while a step ran, and wait for it to come back — visible and online — so
 *     a step the connection was pulled out from under can be picked up again
 *     rather than reported as a failure.
 *   - {@link visibleCountdown} is a bound that only counts while the page can
 *     be seen, so a tab that was frozen for ten minutes does not come back to
 *     a bound that ran out while nobody could have done anything about it.
 *
 * THE PAGE IS A SEAM, {@link PageSeam}, and so is the wake lock: every branch
 * is drilled with a stand-in in `./pagePresence.test.ts`, and the browser's own
 * are built by {@link browserPage} and {@link browserWakeLock}.
 */

/** What this module reads about the page, and how it hears that it changed. */
export interface PageSeam {
  /** Whether the page is hidden: a dimmed screen, another app, another tab. */
  hidden(): boolean
  /** Whether the browser believes it is online. */
  online(): boolean
  /** Calls `listener` whenever either may have changed; returns the way to stop. */
  watch(listener: () => void): () => void
}

/** The page events that can mean either answer changed. */
const DOCUMENT_EVENTS = ['visibilitychange', 'freeze', 'resume'] as const
const WINDOW_EVENTS = ['online', 'offline', 'pageshow'] as const

/**
 * The browser's page. `freeze` and `resume` are the Page Lifecycle events a
 * frozen tab is stopped and started with; `pageshow` is a page restored from
 * the back-forward cache. Outside a browser — a drill with no DOM — the page is
 * visible, online, and never changes.
 */
export function browserPage(): PageSeam {
  return {
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    watch: (listener) => {
      if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined
      for (const name of DOCUMENT_EVENTS) document.addEventListener(name, listener)
      for (const name of WINDOW_EVENTS) window.addEventListener(name, listener)
      return () => {
        for (const name of DOCUMENT_EVENTS) document.removeEventListener(name, listener)
        for (const name of WINDOW_EVENTS) window.removeEventListener(name, listener)
      }
    },
  }
}

/** Whether the page is away: hidden, or offline. */
function away(page: PageSeam): boolean {
  return page.hidden() || !page.online()
}

/**
 * Watches one attempt at a step: `dropped()` is whether the page was away at
 * any moment since the watch began, including now.
 */
export function watchDrop(page: PageSeam): { dropped(): boolean; stop(): void } {
  let dropped = away(page)
  const stop = page.watch(() => {
    if (away(page)) dropped = true
  })
  return { dropped: () => dropped || away(page), stop }
}

/**
 * Resolves once the page is visible and online — at once if it already is —
 * or as soon as `signal` aborts, whichever is first. Never rejects: the caller
 * reads the signal to tell the two apart.
 */
export function pageBack(page: PageSeam, signal?: AbortSignal): Promise<void> {
  if (!away(page) || signal?.aborted === true) return Promise.resolve()
  return new Promise((resolve) => {
    let finished = false
    let stop: (() => void) | null = null
    /* Runs once: it stops the watch and takes the abort listener away, so
       neither can call it again. */
    const done = () => {
      finished = true
      stop?.()
      signal?.removeEventListener('abort', done)
      resolve()
    }
    stop = page.watch(() => {
      if (!away(page)) done()
    })
    /* A page that answered while it was being watched has already resolved,
       and the stop it asked for did not exist yet. */
    if (finished) {
      stop()
      return
    }
    signal?.addEventListener('abort', done)
  })
}

/** The clock and timer a countdown runs on, injected so a drill needs no waiting. */
export interface CountdownClock {
  now(): number
  set(callback: () => void, milliseconds: number): unknown
  clear(handle: unknown): void
}

const realClock: CountdownClock = {
  now: () => Date.now(),
  set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** A bound that counts only while the page is visible. */
export interface Countdown {
  /** Starts the count again from `milliseconds`, whether or not it was running. */
  restart(milliseconds: number): void
  /** Stops the count, without firing, until the next {@link Countdown.restart}. */
  pause(): void
  /** Stops for good. */
  stop(): void
}

/**
 * A bound that counts visible time only, and fires `onFire` once when that
 * runs out.
 *
 * HIDDEN TIME IS NOT COUNTED. A phone that dimmed its screen, or a tab Android
 * froze, comes back with its timers overdue; a wall-clock bound would fire the
 * moment it thawed and say something had hung when nothing had had a chance to
 * run. So the count stops while the page is hidden and carries on, from what
 * was left, when it is seen again.
 */
export function visibleCountdown(
  page: PageSeam,
  onFire: () => void,
  clock: CountdownClock = realClock,
): Countdown {
  let remaining = 0
  let armed = false
  let stopped = false
  let handle: unknown = null
  let startedAt = 0

  const halt = () => {
    if (handle === null) return
    clock.clear(handle)
    handle = null
    remaining = Math.max(0, remaining - (clock.now() - startedAt))
  }
  const run = () => {
    if (!armed || stopped || handle !== null || page.hidden()) return
    startedAt = clock.now()
    handle = clock.set(() => {
      handle = null
      armed = false
      onFire()
    }, remaining)
  }
  const unwatch = page.watch(() => {
    if (page.hidden()) halt()
    else run()
  })

  return {
    restart: (milliseconds) => {
      halt()
      remaining = milliseconds
      armed = true
      run()
    },
    pause: () => {
      halt()
      armed = false
    },
    stop: () => {
      halt()
      armed = false
      stopped = true
      unwatch()
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Keeping the screen on                                                      */
/* -------------------------------------------------------------------------- */

/** The part of a `WakeLockSentinel` this module uses. */
export interface ScreenLock {
  /** True once the platform, or this module, has let go of it. */
  readonly released?: boolean
  release(): Promise<void>
}

/** The platform's wake lock, and the page it belongs to. */
export interface WakeLockSeam {
  /** `navigator.wakeLock.request`, or null where there is none. */
  readonly request: ((type: 'screen') => Promise<ScreenLock>) | null
  readonly page: PageSeam
}

/**
 * The browser's wake lock: Chrome on Android, Safari from 16.4, and most
 * desktop Chromium. Null anywhere else, and everything that uses it goes on
 * exactly as before.
 */
export function browserWakeLock(page: PageSeam = browserPage()): WakeLockSeam {
  const lock =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as { wakeLock?: { request?: (type: 'screen') => Promise<ScreenLock> } }).wakeLock
  const request = lock?.request
  return {
    request: typeof request === 'function' ? (type) => request.call(lock, type) : null,
    page,
  }
}

/**
 * Keeps the screen on until `release()` is called — asked for now, asked for
 * again every time the page comes back into view, and let go of at the end.
 *
 * THE PLATFORM LETS GO WHENEVER THE PAGE IS HIDDEN, by design: a lock is only
 * ever held by a page somebody can see. So it is asked for again on the way
 * back, and never while hidden, where the request is refused.
 *
 * NOTHING HERE CAN FAIL. A platform with no wake lock, a request refused (a
 * battery saver, a permissions policy), a release that throws: each is the
 * screen behaving as it would have without this, and none of them is worth a
 * sentence to anybody.
 */
export function holdScreenAwake(seam: WakeLockSeam = browserWakeLock()): { release(): void } {
  const { request, page } = seam
  if (request === null) return { release: () => undefined }
  let released = false
  let asking = false
  let held: ScreenLock | null = null

  const acquire = () => {
    if (released || asking || page.hidden()) return
    if (held !== null && held.released !== true) return
    asking = true
    let pending: Promise<ScreenLock>
    try {
      pending = request('screen')
    } catch {
      asking = false
      return
    }
    pending.then(
      (lock) => {
        asking = false
        if (released) letGo(lock)
        else held = lock
      },
      () => {
        asking = false
      },
    )
  }
  const unwatch = page.watch(acquire)
  acquire()

  return {
    release: () => {
      if (released) return
      released = true
      unwatch()
      const lock = held
      held = null
      if (lock !== null && lock.released !== true) letGo(lock)
    },
  }
}

/** Lets go of a lock, and says nothing whichever way that goes. */
function letGo(lock: ScreenLock): void {
  try {
    void lock.release().catch(() => undefined)
  } catch {
    /* A release that throws is a lock the platform has already taken back. */
  }
}
