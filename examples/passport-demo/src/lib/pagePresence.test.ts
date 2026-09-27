/**
 * THE PAGE AND THE SCREEN (2026/09/27), drilled with stand-ins for both: when
 * a page counts as away, waiting for it to come back, a bound that counts only
 * visible time, and keeping the screen on — asked for, asked for again when
 * the page comes back, and let go of.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  browserPage,
  browserWakeLock,
  holdScreenAwake,
  pageBack,
  visibleCountdown,
  watchDrop,
  type CountdownClock,
  type PageSeam,
  type ScreenLock,
} from './pagePresence.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A page that is visible and online until a drill says otherwise. */
function fakePage(initial: { hidden?: boolean; online?: boolean } = {}) {
  let hidden = initial.hidden ?? false
  let online = initial.online ?? true
  const listeners = new Set<() => void>()
  const page: PageSeam = {
    hidden: () => hidden,
    online: () => online,
    watch: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    page,
    set(next: { hidden?: boolean; online?: boolean }) {
      if (next.hidden !== undefined) hidden = next.hidden
      if (next.online !== undefined) online = next.online
      for (const listener of [...listeners]) listener()
    },
    watching: () => listeners.size,
  }
}

/** A clock that moves only when a drill moves it. */
function fakeClock() {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  const clock: CountdownClock = {
    now: () => now,
    set: (callback, milliseconds) => {
      const id = next
      next += 1
      timers.set(id, { at: now + milliseconds, callback })
      return id
    },
    clear: (handle) => {
      timers.delete(handle as number)
    },
  }
  return {
    clock,
    advance(milliseconds: number) {
      now += milliseconds
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.callback()
        }
      }
    },
    pending: () => timers.size,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/* -------------------------------------------------------------------------- */
/* The browser's page                                                         */
/* -------------------------------------------------------------------------- */

describe('the browser’s page', () => {
  it('is visible, online, and never changes where there is no page at all', () => {
    const page = browserPage()
    expect(page.hidden()).toBe(false)
    expect(page.online()).toBe(true)
    const stop = page.watch(() => undefined)
    expect(() => stop()).not.toThrow()
  })

  it('reads the document and the navigator, and hears every event that can change them', () => {
    const documentEvents = new Map<string, () => void>()
    const windowEvents = new Map<string, () => void>()
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      addEventListener: (name: string, listener: () => void) => documentEvents.set(name, listener),
      removeEventListener: (name: string) => documentEvents.delete(name),
    })
    vi.stubGlobal('window', {
      addEventListener: (name: string, listener: () => void) => windowEvents.set(name, listener),
      removeEventListener: (name: string) => windowEvents.delete(name),
    })
    vi.stubGlobal('navigator', { onLine: false })
    const page = browserPage()
    expect(page.hidden()).toBe(true)
    expect(page.online()).toBe(false)
    const stop = page.watch(() => undefined)
    expect([...documentEvents.keys()]).toEqual(['visibilitychange', 'freeze', 'resume'])
    expect([...windowEvents.keys()]).toEqual(['online', 'offline', 'pageshow'])
    stop()
    expect(documentEvents.size + windowEvents.size).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Away, and back                                                             */
/* -------------------------------------------------------------------------- */

describe('whether the page went away during a step', () => {
  it('did not, for a page that stayed in view and online', () => {
    const { page } = fakePage()
    const watch = watchDrop(page)
    expect(watch.dropped()).toBe(false)
    watch.stop()
  })

  it('did, for a page hidden at any moment — even one back in view by the end', () => {
    const fake = fakePage()
    const watch = watchDrop(fake.page)
    fake.set({ hidden: true })
    fake.set({ hidden: false })
    expect(watch.dropped()).toBe(true)
    watch.stop()
    expect(fake.watching()).toBe(0)
  })

  it('did, for a page that was offline when it began or is offline now', () => {
    expect(watchDrop(fakePage({ online: false }).page).dropped()).toBe(true)
    const fake = fakePage()
    const watch = watchDrop(fake.page)
    fake.set({ online: true })
    expect(watch.dropped()).toBe(false)
    fake.set({ online: false })
    expect(watch.dropped()).toBe(true)
  })
})

describe('waiting for the page to come back', () => {
  it('is over at once for a page that is in view and online', async () => {
    const fake = fakePage()
    await pageBack(fake.page)
    expect(fake.watching()).toBe(0)
  })

  it('waits for both: in view, and online', async () => {
    const fake = fakePage({ hidden: true, online: false })
    let back = false
    void pageBack(fake.page).then(() => {
      back = true
    })
    fake.set({ hidden: false })
    await flush()
    expect(back).toBe(false)
    fake.set({ online: true })
    await flush()
    expect(back).toBe(true)
    expect(fake.watching()).toBe(0)
  })

  it('stops waiting when told to, and at once when already told', async () => {
    const fake = fakePage({ hidden: true })
    const controller = new AbortController()
    const waiting = pageBack(fake.page, controller.signal)
    controller.abort()
    await waiting
    expect(fake.watching()).toBe(0)
    await pageBack(fake.page, controller.signal)
    expect(fake.watching()).toBe(0)
  })

  it('stops watching a page that answered while it was being watched', async () => {
    let hidden = true
    const listeners = new Set<() => void>()
    const page: PageSeam = {
      hidden: () => hidden,
      online: () => true,
      watch: (listener) => {
        listeners.add(listener)
        hidden = false
        listener()
        return () => {
          listeners.delete(listener)
        }
      },
    }
    await pageBack(page)
    expect(listeners.size).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* A bound that counts only what can be seen                                  */
/* -------------------------------------------------------------------------- */

describe('a bound that counts visible time only', () => {
  it('fires once its time has passed in view', () => {
    const fake = fakePage()
    const time = fakeClock()
    const fire = vi.fn()
    const bound = visibleCountdown(fake.page, fire, time.clock)
    bound.restart(1_000)
    time.advance(999)
    expect(fire).not.toHaveBeenCalled()
    time.advance(1)
    expect(fire).toHaveBeenCalledTimes(1)
    time.advance(10_000)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('does not count while hidden, and carries on from what was left', () => {
    /* The frozen tab: ten minutes pass while nobody can see it, and none of
       them are counted. */
    const fake = fakePage()
    const time = fakeClock()
    const fire = vi.fn()
    const bound = visibleCountdown(fake.page, fire, time.clock)
    bound.restart(1_000)
    time.advance(600)
    fake.set({ hidden: true })
    time.advance(600_000)
    expect(fire).not.toHaveBeenCalled()
    fake.set({ hidden: false })
    time.advance(399)
    expect(fire).not.toHaveBeenCalled()
    time.advance(1)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('starts from the top on every restart, and waits for the page when it starts hidden', () => {
    const fake = fakePage({ hidden: true })
    const time = fakeClock()
    const fire = vi.fn()
    const bound = visibleCountdown(fake.page, fire, time.clock)
    bound.restart(1_000)
    time.advance(5_000)
    expect(fire).not.toHaveBeenCalled()
    fake.set({ hidden: false })
    time.advance(900)
    bound.restart(1_000)
    time.advance(900)
    expect(fire).not.toHaveBeenCalled()
    time.advance(100)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('is held by a pause until the next restart, and ended for good by a stop', () => {
    const fake = fakePage()
    const time = fakeClock()
    const fire = vi.fn()
    const bound = visibleCountdown(fake.page, fire, time.clock)
    bound.restart(1_000)
    bound.pause()
    time.advance(5_000)
    fake.set({ hidden: true })
    fake.set({ hidden: false })
    time.advance(5_000)
    expect(fire).not.toHaveBeenCalled()
    bound.restart(1_000)
    bound.stop()
    bound.restart(1_000)
    time.advance(5_000)
    expect(fire).not.toHaveBeenCalled()
    expect(fake.watching()).toBe(0)
    expect(time.pending()).toBe(0)
  })

  it('runs on the real clock by default', async () => {
    const fire = vi.fn()
    const bound = visibleCountdown(fakePage().page, fire)
    bound.restart(5)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fire).toHaveBeenCalledTimes(1)
    bound.restart(5_000)
    bound.stop()
  })
})

/* -------------------------------------------------------------------------- */
/* Keeping the screen on                                                      */
/* -------------------------------------------------------------------------- */

/** A platform lock, which the platform itself can let go of. */
function fakeLock() {
  const lock = {
    released: false,
    release: vi.fn(() => {
      lock.released = true
      return Promise.resolve()
    }),
  }
  return lock
}

describe('keeping the screen on', () => {
  it('asks for it at once, and lets go of it at the end', async () => {
    const fake = fakePage()
    const lock = fakeLock()
    const request = vi.fn(() => Promise.resolve(lock as ScreenLock))
    const awake = holdScreenAwake({ request, page: fake.page })
    await flush()
    expect(request).toHaveBeenCalledWith('screen')
    awake.release()
    expect(lock.release).toHaveBeenCalledTimes(1)
    expect(fake.watching()).toBe(0)
    awake.release()
    expect(lock.release).toHaveBeenCalledTimes(1)
  })

  it('asks again when the page comes back, because the platform let go when it was hidden', async () => {
    const fake = fakePage()
    const first = fakeLock()
    const second = fakeLock()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const awake = holdScreenAwake({ request, page: fake.page })
    await flush()
    /* Hidden: the platform takes it back, and nothing is asked for while hidden. */
    first.released = true
    fake.set({ hidden: true })
    expect(request).toHaveBeenCalledTimes(1)
    fake.set({ hidden: false })
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    /* In view again with a lock held: nothing more is asked for. */
    fake.set({ hidden: false })
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    awake.release()
    expect(second.release).toHaveBeenCalledTimes(1)
    expect(first.release).not.toHaveBeenCalled()
  })

  it('waits for a hidden page to be seen before asking at all', async () => {
    const fake = fakePage({ hidden: true })
    const request = vi.fn(() => Promise.resolve(fakeLock() as ScreenLock))
    const awake = holdScreenAwake({ request, page: fake.page })
    await flush()
    expect(request).not.toHaveBeenCalled()
    fake.set({ hidden: false })
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    awake.release()
  })

  it('asks once at a time, and lets go of a lock that arrives after the end', async () => {
    const fake = fakePage()
    const lock = fakeLock()
    let grant: (lock: ScreenLock) => void = () => undefined
    const request = vi.fn(
      () =>
        new Promise<ScreenLock>((resolve) => {
          grant = resolve
        }),
    )
    const awake = holdScreenAwake({ request, page: fake.page })
    fake.set({ hidden: false })
    expect(request).toHaveBeenCalledTimes(1)
    awake.release()
    grant(lock)
    await flush()
    expect(lock.release).toHaveBeenCalledTimes(1)
  })

  it('says nothing, and asks again later, when the platform refuses', async () => {
    const fake = fakePage()
    const lock = fakeLock()
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockImplementationOnce(() => {
        throw new Error('not in this document')
      })
      .mockResolvedValueOnce(lock)
    const awake = holdScreenAwake({ request, page: fake.page })
    await flush()
    fake.set({ hidden: false })
    await flush()
    fake.set({ hidden: false })
    await flush()
    expect(request).toHaveBeenCalledTimes(3)
    awake.release()
    expect(lock.release).toHaveBeenCalledTimes(1)
  })

  it('says nothing when letting go throws, or is refused, or was done already', async () => {
    const throwing: ScreenLock = {
      release: () => {
        throw new Error('gone')
      },
    }
    const awakeA = holdScreenAwake({ request: () => Promise.resolve(throwing), page: fakePage().page })
    await flush()
    expect(() => awakeA.release()).not.toThrow()

    const refusing: ScreenLock = { release: () => Promise.reject(new Error('gone')) }
    const awakeB = holdScreenAwake({ request: () => Promise.resolve(refusing), page: fakePage().page })
    await flush()
    expect(() => awakeB.release()).not.toThrow()

    const taken = fakeLock()
    const awakeC = holdScreenAwake({ request: () => Promise.resolve(taken), page: fakePage().page })
    await flush()
    taken.released = true
    awakeC.release()
    expect(taken.release).not.toHaveBeenCalled()
  })

  it('does nothing at all where the platform has no such thing', () => {
    const fake = fakePage()
    const awake = holdScreenAwake({ request: null, page: fake.page })
    expect(fake.watching()).toBe(0)
    expect(() => awake.release()).not.toThrow()
  })
})

describe('the browser’s wake lock', () => {
  it('is the navigator’s, called on the navigator’s own lock', async () => {
    const lock = fakeLock()
    const wakeLock = {
      request: vi.fn(function (this: unknown) {
        expect(this).toBe(wakeLock)
        return Promise.resolve(lock)
      }),
    }
    vi.stubGlobal('navigator', { wakeLock })
    const seam = browserWakeLock(fakePage().page)
    expect(seam.request).not.toBeNull()
    await expect(seam.request?.('screen')).resolves.toBe(lock)
  })

  it('is absent where the navigator has none, or no navigator exists', () => {
    vi.stubGlobal('navigator', {})
    expect(browserWakeLock(fakePage().page).request).toBeNull()
    vi.stubGlobal('navigator', undefined)
    expect(browserWakeLock().request).toBeNull()
  })

  it('is what keeping the screen on uses when it is given nothing', () => {
    vi.stubGlobal('navigator', {})
    const awake = holdScreenAwake()
    expect(() => awake.release()).not.toThrow()
  })
})
