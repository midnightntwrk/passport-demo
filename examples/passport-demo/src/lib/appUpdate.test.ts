/**
 * The silent update path: which worker is told to skip waiting, when a page is
 * reloaded into a new build, and when it is left alone.
 *
 * Every case below is a way the update used to go wrong, or could: a button
 * that offered a page its own build (the Android phone, 2026/09/25), a reload
 * under a passkey ceremony, a reload over a half-typed payment, a chunk reload
 * that loops. The critical-work counter is the real one from `appBusy.ts` —
 * each case releases every hold it takes — and everything else is a fake the
 * case winds by hand.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { holdCriticalWork } from './appBusy.js';
import {
  askWorkerBuildId,
  BUILD_ID_REPLY_TIMEOUT_MS,
  CHUNK_RELOAD_KEY,
  createSilentUpdater,
  INTERACTION_EVENTS,
  INTERACTION_QUIET_MS,
  isTextEntry,
  OPEN_SHEET_SELECTOR,
  type SessionFlags,
  type SilentUpdateHost,
  type UpdateWorker,
  WAITING_NUDGE_INTERVAL_MS,
} from './appUpdate.js';

const PAGE_BUILD = '1209def68cd2de1a';
const OLD_BUILD = '8c16d95be0ae6b23';

/** A worker that records what it was told. */
function worker(): UpdateWorker & { messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    messages,
    postMessage(message: unknown) {
      messages.push(message);
    },
  };
}

/** A session store backed by a map. */
function session(initial: Record<string, string> = {}): SessionFlags & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

interface Page {
  host: SilentUpdateHost;
  reloads: () => number;
  hidden: boolean;
  engaged: boolean;
  clock: number;
  /** What the next build-id question is answered with. */
  answer: Promise<string | null>;
}

function page(overrides: Partial<SilentUpdateHost> = {}): Page {
  let reloads = 0;
  const state: Page = {
    host: undefined as unknown as SilentUpdateHost,
    reloads: () => reloads,
    hidden: false,
    engaged: false,
    clock: 1_000_000,
    answer: Promise.resolve(OLD_BUILD),
  };
  state.host = {
    pageBuildId: PAGE_BUILD,
    controlled: true,
    isHidden: () => state.hidden,
    isEngaged: () => state.engaged,
    now: () => state.clock,
    reload: () => {
      reloads += 1;
    },
    askBuildId: () => state.answer,
    session: session(),
    ...overrides,
  };
  return state;
}

/** Lets the build-id answer land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('askWorkerBuildId', () => {
  it('returns the build the worker names', async () => {
    const answering: UpdateWorker = {
      postMessage(message, transfer) {
        expect(message).toEqual({ type: 'BUILD_ID' });
        (transfer[0] as MessagePort).postMessage(PAGE_BUILD);
      },
    };
    await expect(askWorkerBuildId(answering)).resolves.toBe(PAGE_BUILD);
  });

  it('treats an answer that is not a build id as no answer', async () => {
    const odd: UpdateWorker = {
      postMessage(_message, transfer) {
        (transfer[0] as MessagePort).postMessage({ build: PAGE_BUILD });
      },
    };
    await expect(askWorkerBuildId(odd)).resolves.toBeNull();
  });

  it('gives up on a worker that never answers', async () => {
    vi.useFakeTimers();
    const silent: UpdateWorker = { postMessage() {} };
    const answer = askWorkerBuildId(silent);
    await vi.advanceTimersByTimeAsync(BUILD_ID_REPLY_TIMEOUT_MS);
    await expect(answer).resolves.toBeNull();
  });

  it('gives up at once on a worker that cannot be written to', async () => {
    const gone: UpdateWorker = {
      postMessage() {
        throw new DOMException('redundant', 'InvalidStateError');
      },
    };
    await expect(askWorkerBuildId(gone, 60_000)).resolves.toBeNull();
  });
});

describe('isTextEntry', () => {
  it('counts the places a person types', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'input' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'Number' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('does not count a control that holds no typing', () => {
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry({ tagName: 'BODY', isContentEditable: false })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'submit' })).toBe(false);
  });

  it('names the interactions and sheets the wiring listens for', () => {
    expect(INTERACTION_EVENTS).toEqual(['pointerdown', 'keydown', 'input']);
    expect(OPEN_SHEET_SELECTOR).toContain('[aria-modal="true"]');
  });
});

describe('a waiting worker', () => {
  it('is told to skip waiting on a controlled page, and told again while it waits', () => {
    /* The repeat is the point: Chromium does not always re-check a parked
       worker once the running one goes idle, and a fresh `skipWaiting()` is
       what makes it. */
    const { host } = page();
    const updater = createSilentUpdater(host);
    const waiting = worker();
    updater.waitingWorker(waiting);
    updater.waitingWorker(waiting);
    expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }, { type: 'SKIP_WAITING' }]);
    expect(WAITING_NUDGE_INTERVAL_MS).toBeLessThanOrEqual(10_000);
    updater.dispose();
  });

  it('is left alone on a first install, where nothing controls the page', () => {
    const { host } = page({ controlled: false });
    const updater = createSilentUpdater(host);
    const waiting = worker();
    updater.waitingWorker(waiting);
    expect(waiting.messages).toEqual([]);
    updater.dispose();
  });

  it('is told once the first claim has made the page controlled', () => {
    const { host } = page({ controlled: false });
    const updater = createSilentUpdater(host);
    updater.controllerChanged(worker());
    const waiting = worker();
    updater.waitingWorker(waiting);
    expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    updater.dispose();
  });

  it('that went redundant in between costs nothing', () => {
    const { host } = page();
    const updater = createSilentUpdater(host);
    expect(() =>
      updater.waitingWorker({
        postMessage() {
          throw new DOMException('redundant', 'InvalidStateError');
        },
      }),
    ).not.toThrow();
    updater.dispose();
  });

  it('is ignored after the page has let go of the updater', () => {
    const { host } = page();
    const updater = createSilentUpdater(host);
    updater.dispose();
    const waiting = worker();
    updater.waitingWorker(waiting);
    expect(waiting.messages).toEqual([]);
  });
});

describe('a new worker taking over', () => {
  it('never reloads a page that already runs its build — the phone, 2026/09/25', async () => {
    const state = page();
    state.answer = Promise.resolve(PAGE_BUILD);
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(worker());
    await settle();
    updater.visibilityChanged();
    state.hidden = true;
    updater.visibilityChanged();
    expect(state.reloads()).toBe(0);
    updater.dispose();
  });

  it('is not an update on a first install', async () => {
    const state = page({ controlled: false });
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(0);
    updater.dispose();
  });

  it('reloads an idle page into a build it is not running, at once', async () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(1);
    // And only ever once, whatever happens next.
    updater.visibilityChanged();
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('reloads when the worker will not say which build it serves', async () => {
    const state = page();
    state.answer = Promise.resolve(null);
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('treats a question that fails as no answer', async () => {
    const state = page();
    state.answer = Promise.reject(new Error('no channel'));
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('does nothing when the controller went away', async () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(null);
    await settle();
    expect(state.reloads()).toBe(0);
    updater.dispose();
  });

  it('acts on the latest takeover only', async () => {
    const state = page();
    let answerFirst: (value: string | null) => void = () => {};
    state.answer = new Promise((resolve) => {
      answerFirst = resolve;
    });
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(worker());
    // A second takeover — a rollback to the page's own build — lands first.
    state.answer = Promise.resolve(PAGE_BUILD);
    updater.controllerChanged(worker());
    await settle();
    answerFirst(OLD_BUILD);
    await settle();
    expect(state.reloads()).toBe(0);
    updater.dispose();
  });

  it('lets an answer that arrives after the page let go do nothing', async () => {
    const state = page();
    let answer: (value: string | null) => void = () => {};
    state.answer = new Promise((resolve) => {
      answer = resolve;
    });
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(worker());
    updater.dispose();
    answer(OLD_BUILD);
    await settle();
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(0);
  });

  it('reloads a hidden page at once, even straight after a touch', async () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    updater.interacted();
    state.hidden = true;
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });
});

describe('the safe moment', () => {
  it('never reloads under critical work, and not on its release while on screen', async () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    const release = holdCriticalWork();
    try {
      updater.controllerChanged(worker());
      await settle();
      state.hidden = true;
      updater.visibilityChanged();
      state.hidden = false;
      updater.visibilityChanged();
      expect(state.reloads()).toBe(0);
    } finally {
      release();
    }
    // The result of the work is on screen: leave it there.
    expect(state.reloads()).toBe(0);
    state.hidden = true;
    updater.visibilityChanged();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('reloads the moment critical work ends on a page that is already hidden', async () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    const release = holdCriticalWork();
    updater.controllerChanged(worker());
    await settle();
    state.hidden = true;
    release();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('waits out a person mid-use, and reloads when they come back to the page', async () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    updater.interacted();
    state.clock += INTERACTION_QUIET_MS - 1;
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(0);
    state.hidden = true;
    state.engaged = true;
    updater.visibilityChanged();
    expect(state.reloads()).toBe(0);
    state.hidden = false;
    state.engaged = false;
    updater.visibilityChanged();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('counts a person idle once the quiet period has passed', async () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    updater.interacted();
    state.clock += INTERACTION_QUIET_MS;
    updater.controllerChanged(worker());
    await settle();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('never reloads over a field in focus or an open sheet', async () => {
    const state = page();
    state.engaged = true;
    const updater = createSilentUpdater(state.host);
    updater.controllerChanged(worker());
    await settle();
    state.hidden = true;
    updater.visibilityChanged();
    expect(state.reloads()).toBe(0);
    state.engaged = false;
    updater.visibilityChanged();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('has nothing to do when no reload is owed', () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    state.hidden = true;
    updater.visibilityChanged();
    const release = holdCriticalWork();
    release();
    expect(state.reloads()).toBe(0);
    updater.dispose();
  });

  it('stops listening for critical work once disposed', async () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    const release = holdCriticalWork();
    updater.controllerChanged(worker());
    await settle();
    updater.dispose();
    state.hidden = true;
    release();
    updater.visibilityChanged();
    expect(state.reloads()).toBe(0);
  });
});

describe('a lazy chunk that will not load', () => {
  it('reloads once, at once, and remembers the build that did', () => {
    const flags = session();
    const state = page({ session: flags });
    const updater = createSilentUpdater(state.host);
    // The person has just tapped the thing that failed: that is no reason to wait.
    updater.interacted();
    expect(updater.chunkLoadFailed()).toBe(true);
    expect(state.reloads()).toBe(1);
    expect(flags.values.get(CHUNK_RELOAD_KEY)).toBe(PAGE_BUILD);
    updater.dispose();
  });

  it('never reloads the same build twice, so it cannot loop', () => {
    const state = page({ session: session({ [CHUNK_RELOAD_KEY]: PAGE_BUILD }) });
    const updater = createSilentUpdater(state.host);
    expect(updater.chunkLoadFailed()).toBe(false);
    expect(state.reloads()).toBe(0);
    updater.dispose();
  });

  it('gives a newer build its own one reload', () => {
    const flags = session({ [CHUNK_RELOAD_KEY]: OLD_BUILD });
    const state = page({ session: flags });
    const updater = createSilentUpdater(state.host);
    expect(updater.chunkLoadFailed()).toBe(true);
    expect(state.reloads()).toBe(1);
    expect(flags.values.get(CHUNK_RELOAD_KEY)).toBe(PAGE_BUILD);
    updater.dispose();
  });

  it('does not reload without somewhere to remember it did', () => {
    const state = page({ session: null });
    const updater = createSilentUpdater(state.host);
    expect(updater.chunkLoadFailed()).toBe(false);

    const refusing = page({
      session: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('full', 'QuotaExceededError');
        },
      },
    });
    const second = createSilentUpdater(refusing.host);
    expect(second.chunkLoadFailed()).toBe(false);

    const unreadable = page({
      session: {
        getItem: () => {
          throw new DOMException('denied', 'SecurityError');
        },
        setItem: () => {},
      },
    });
    const third = createSilentUpdater(unreadable.host);
    expect(third.chunkLoadFailed()).toBe(false);

    expect(state.reloads() + refusing.reloads() + unreadable.reloads()).toBe(0);
    updater.dispose();
    second.dispose();
    third.dispose();
  });

  it('waits for critical work, then for the page to be put away', () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    const release = holdCriticalWork();
    expect(updater.chunkLoadFailed()).toBe(true);
    expect(state.reloads()).toBe(0);
    release();
    expect(state.reloads()).toBe(0);
    state.hidden = true;
    updater.visibilityChanged();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('is still owed when a takeover turns out to be the page’s own build', async () => {
    const state = page();
    state.answer = Promise.resolve(PAGE_BUILD);
    const updater = createSilentUpdater(state.host);
    const release = holdCriticalWork();
    updater.chunkLoadFailed();
    updater.controllerChanged(worker());
    await settle();
    release();
    state.hidden = true;
    updater.visibilityChanged();
    expect(state.reloads()).toBe(1);
    updater.dispose();
  });

  it('is ignored after the page has let go of the updater', () => {
    const state = page();
    const updater = createSilentUpdater(state.host);
    updater.dispose();
    expect(updater.chunkLoadFailed()).toBe(false);
    expect(state.reloads()).toBe(0);
  });
});
