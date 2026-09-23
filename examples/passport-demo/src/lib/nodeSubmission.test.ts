/**
 * The submission service whose closes are honest.
 *
 * The defect is in `./nodeSubmission.ts`'s header: on staging, 2026/09/23, a
 * second new Passport in one browser failed every press with "WebSocket is
 * already in CLOSING or CLOSED state" and "1000:: Normal Closure". The fakes
 * below behave as polkadot-js 16 and the wallet SDK's `PolkadotNodeClient` do —
 * `disconnect()` only asks the socket to close and returns, `isConnected` stays
 * true until the close event a round trip later, and the client reconnects only
 * when `isConnected` is false — so the defect reproduces here against a service
 * built the way the SDK's default is, and is gone against this one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NODE_SOCKET_CLOSE_WAIT_MS,
  NodeSocketStillClosing,
  settledSubmissionService,
  untilSocketClosed,
  type NodeClientHandle,
  type NodeSocketApi,
  type SubmissionWait,
} from './nodeSubmission.js';

/** One round trip to the node: how long a requested close takes to finish. */
const CLOSE_RTT_MS = 50;
const OPEN_MS = 10;
const INCLUSION_MS = 100;

interface FakeSocket {
  readonly id: number;
  state: 'connecting' | 'open' | 'closing';
}

/** polkadot-js's `ApiPromise` over a `WsProvider`, as far as this depends on it. */
class FakeApi implements NodeSocketApi {
  isConnected = false;
  socket: FakeSocket | null = null;
  sockets = 0;
  /** Writes the browser would refuse: "already in CLOSING or CLOSED state". */
  writesToClosingSocket = 0;
  /** A close that never finishes, for the bound. */
  closeNeverFinishes = false;
  private readonly listeners = new Set<() => void>();
  private pending: Array<(error: Error) => void> = [];

  on(_type: 'disconnected', handler: () => void) {
    this.listeners.add(handler);
    return this;
  }

  off(_type: 'disconnected', handler: () => void) {
    this.listeners.delete(handler);
    return this;
  }

  connect(): Promise<void> {
    if (this.socket) return Promise.reject(new Error('WebSocket is already connected'));
    this.sockets += 1;
    const socket: FakeSocket = { id: this.sockets, state: 'connecting' };
    this.socket = socket;
    setTimeout(() => {
      if (this.socket === socket && socket.state === 'connecting') {
        socket.state = 'open';
        this.isConnected = true;
      }
    }, OPEN_MS);
    return Promise.resolve();
  }

  /** `WsProvider.disconnect`: `close(1000)`, and return before it has closed. */
  disconnect(): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.state === 'closing') return Promise.resolve();
    socket.state = 'closing';
    if (this.closeNeverFinishes) return Promise.resolve();
    setTimeout(() => {
      this.isConnected = false;
      this.socket = null;
      const pending = this.pending;
      this.pending = [];
      for (const reject of pending) {
        reject(new Error('disconnected from wss://node/: 1000:: Normal Closure'));
      }
      for (const listener of [...this.listeners]) listener();
    }, CLOSE_RTT_MS);
    return Promise.resolve();
  }

  /** `submitAndWatchExtrinsic`, answered at inclusion. */
  submit(tx: string): Promise<string> {
    if (!this.isConnected || this.socket === null) {
      return Promise.reject(new Error('WebSocket is not connected'));
    }
    const socket = this.socket;
    return new Promise((resolve, reject) => {
      this.pending.push(reject);
      if (socket.state === 'closing') {
        this.writesToClosingSocket += 1;
        return;
      }
      setTimeout(() => {
        if (this.socket === socket && socket.state === 'open') {
          this.pending = this.pending.filter((entry) => entry !== reject);
          resolve(`in-block:${tx}`);
        }
      }, INCLUSION_MS);
    });
  }
}

/** The wallet SDK's `PolkadotNodeClient`, as far as the defect goes. */
async function openFakeSdkClient(api: FakeApi): Promise<NodeClientHandle<string>> {
  // `make`: connect, load metadata, then disconnect before answering.
  await api.connect();
  while (!api.isConnected) await new Promise((resolve) => setTimeout(resolve, 1));
  await api.disconnect();
  return {
    api,
    async send(tx: unknown, _waitFor: SubmissionWait) {
      // `ensureConnection`: reconnect only if `isConnected` says so.
      while (!api.isConnected) {
        try {
          await api.connect();
        } catch (error) {
          if (!(error instanceof Error && error.message === 'WebSocket is already connected')) throw error;
        }
        if (!api.isConnected) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      try {
        return await api.submit(String(tx));
      } finally {
        // `Stream.ensuring(api.disconnect())`.
        await api.disconnect();
      }
    },
    close: () => api.disconnect(),
  };
}

/** The SDK's `makeDefaultSubmissionService`: open at once, submit when opened. */
function sdkDefaultService(open: () => Promise<NodeClientHandle<string>>) {
  const ready = open();
  return {
    submitTransaction: async (tx: unknown, waitFor: SubmissionWait = 'InBlock') =>
      (await ready).send(tx, waitFor),
  };
}

/** Runs `work` to the end on the fake clock, returning how it settled. */
async function settle<T>(work: Promise<T>): Promise<{ value?: T; error?: Error }> {
  const outcome = work.then(
    (value) => ({ value }),
    (error: Error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the defect, against a service built as the SDK builds its default', () => {
  it('a submission asked for while the client is opening is written to the closing socket and fails', async () => {
    const api = new FakeApi();
    const service = sdkDefaultService(() => openFakeSdkClient(api));
    const outcome = await settle(service.submitTransaction('deploy'));
    expect(outcome.error?.message).toMatch(/1000:: Normal Closure/);
    expect(api.writesToClosingSocket).toBe(1);
  });

  it('a submission straight after another is written to the socket the first is closing', async () => {
    const api = new FakeApi();
    const service = sdkDefaultService(() => openFakeSdkClient(api));
    await vi.advanceTimersByTimeAsync(OPEN_MS + CLOSE_RTT_MS + 5);
    const outcome = await settle(
      service.submitTransaction('1 of 4').then(() => service.submitTransaction('2 of 4')),
    );
    expect(outcome.error?.message).toMatch(/1000:: Normal Closure/);
    expect(api.writesToClosingSocket).toBe(1);
  });

  it('two submissions that overlap: the first to end closes the socket under the other', async () => {
    const api = new FakeApi();
    const service = sdkDefaultService(() => openFakeSdkClient(api));
    await vi.advanceTimersByTimeAsync(OPEN_MS + CLOSE_RTT_MS + 5);
    const a = service.submitTransaction('a');
    await vi.advanceTimersByTimeAsync(OPEN_MS + 30);
    const b = service.submitTransaction('b');
    const [left, right] = await Promise.all([settle(a), settle(b)]);
    expect(left.value).toBe('in-block:a');
    expect(right.error?.message).toMatch(/1000:: Normal Closure/);
  });
});

describe('settledSubmissionService', () => {
  it('waits out the opening close, then submits on a new socket', async () => {
    const api = new FakeApi();
    const service = settledSubmissionService(() => openFakeSdkClient(api));
    const outcome = await settle(service.submitTransaction('deploy'));
    expect(outcome.value).toBe('in-block:deploy');
    expect(api.writesToClosingSocket).toBe(0);
    expect(api.sockets).toBe(2);
  });

  it('asks for inclusion unless told otherwise, and passes the wait it is given', async () => {
    const seen: SubmissionWait[] = [];
    const api = new FakeApi();
    const service = settledSubmissionService(async () => {
      const handle = await openFakeSdkClient(api);
      return {
        ...handle,
        send: (tx: unknown, waitFor: SubmissionWait) => {
          seen.push(waitFor);
          return handle.send(tx, waitFor);
        },
      };
    });
    await settle(service.submitTransaction('one'));
    await settle(service.submitTransaction('two', 'Finalized'));
    expect(seen).toEqual(['InBlock', 'Finalized']);
  });

  it('submits back to back, each on a socket that is not closing', async () => {
    const api = new FakeApi();
    const service = settledSubmissionService(() => openFakeSdkClient(api));
    const steps = ['1 of 4', '2 of 4', '3 of 4', '4 of 4'];
    const answers: string[] = [];
    const outcome = await settle(
      steps.reduce<Promise<unknown>>(
        (previous, step) =>
          previous.then(async () => {
            answers.push(await service.submitTransaction(step));
          }),
        Promise.resolve(),
      ),
    );
    expect(outcome.error).toBeUndefined();
    expect(answers).toEqual(steps.map((step) => `in-block:${step}`));
    expect(api.writesToClosingSocket).toBe(0);
  });

  it('a submission that ends does not close the socket another is still using', async () => {
    const api = new FakeApi();
    const service = settledSubmissionService(() => openFakeSdkClient(api));
    await vi.advanceTimersByTimeAsync(OPEN_MS + CLOSE_RTT_MS + 5);
    const a = service.submitTransaction('a');
    await vi.advanceTimersByTimeAsync(OPEN_MS + 30);
    const b = service.submitTransaction('b');
    const [left, right] = await Promise.all([settle(a), settle(b)]);
    expect(left.value).toBe('in-block:a');
    expect(right.value).toBe('in-block:b');
    // …and the last one to end does close it.
    expect(api.isConnected).toBe(false);
    expect(api.socket).toBeNull();
  });

  it('a submission that arrives during a close waits for it rather than writing to it', async () => {
    const api = new FakeApi();
    const service = settledSubmissionService(() => openFakeSdkClient(api));
    await settle(service.submitTransaction('first'));
    await (api as NodeSocketApi).disconnect();
    // A socket opened by hand, then closed: the next submission meets the close.
    await api.connect();
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    const closing = api.disconnect();
    const next = service.submitTransaction('next');
    const [closed, outcome] = await Promise.all([settle(closing), settle(next)]);
    expect(closed.error).toBeUndefined();
    expect(outcome.value).toBe('in-block:next');
    expect(api.writesToClosingSocket).toBe(0);
  });

  it('a second close asked for during the first waits for the first', async () => {
    const api = new FakeApi();
    const service = settledSubmissionService(() => openFakeSdkClient(api));
    await settle(service.submitTransaction('first'));
    await api.connect();
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    const one = api.disconnect();
    const two = api.disconnect();
    let twoDone = false;
    void two.then(() => {
      twoDone = true;
    });
    await vi.advanceTimersByTimeAsync(CLOSE_RTT_MS - 5);
    expect(twoDone).toBe(false);
    await settle(Promise.all([one, two]));
    expect(twoDone).toBe(true);
    expect(api.isConnected).toBe(false);
  });

  it('a close that never finishes fails the submission as a closed connection, and sends nothing', async () => {
    const api = new FakeApi();
    api.closeNeverFinishes = true;
    const send = vi.fn();
    const service = settledSubmissionService(async () => ({
      ...(await openFakeSdkClient(api)),
      send,
    }));
    const outcome = await settle(service.submitTransaction('deploy'));
    expect(outcome.error).toBeInstanceOf(NodeSocketStillClosing);
    expect(outcome.error?.name).toBe('SubmissionError');
    expect(outcome.error?.message).toMatch(/WebSocket is not connected/);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a client that could not open to the submission, and closes quietly', async () => {
    const service = settledSubmissionService<string>(() => Promise.reject(new Error('no node')));
    await expect(service.submitTransaction('deploy')).rejects.toThrow('no node');
    await expect(service.close()).resolves.toBeUndefined();
  });

  it('close() shuts the client down, even with submissions on the socket', async () => {
    const api = new FakeApi();
    const shut = vi.fn(() => api.disconnect());
    const service = settledSubmissionService(async () => ({
      ...(await openFakeSdkClient(api)),
      close: shut,
    }));
    await vi.advanceTimersByTimeAsync(OPEN_MS + CLOSE_RTT_MS + 5);
    const a = service.submitTransaction('a');
    const b = service.submitTransaction('b');
    await vi.advanceTimersByTimeAsync(OPEN_MS + 5);
    const closed = settle(service.close());
    const outcomes = await Promise.all([settle(a), settle(b)]);
    expect((await closed).error).toBeUndefined();
    expect(shut).toHaveBeenCalledTimes(1);
    for (const outcome of outcomes) expect(outcome.error?.message).toMatch(/Normal Closure/);
    expect(api.isConnected).toBe(false);
  });

  it('a disconnect on a socket that is not open just passes through', async () => {
    const api = new FakeApi();
    const service = settledSubmissionService(() => openFakeSdkClient(api));
    await settle(service.submitTransaction('first'));
    expect(api.isConnected).toBe(false);
    expect(await settle(api.disconnect())).toEqual({ value: undefined });
    expect(api.socket).toBeNull();
  });

  it('two services never share a socket: closing one leaves the other open', async () => {
    const oldApi = new FakeApi();
    const newApi = new FakeApi();
    const oldService = settledSubmissionService(() => openFakeSdkClient(oldApi));
    const newService = settledSubmissionService(() => openFakeSdkClient(newApi));
    await vi.advanceTimersByTimeAsync(OPEN_MS + CLOSE_RTT_MS + 5);
    const pending = newService.submitTransaction('deploy');
    await vi.advanceTimersByTimeAsync(OPEN_MS + 5);
    const closing = oldService.close();
    await vi.advanceTimersByTimeAsync(CLOSE_RTT_MS + 5);
    await closing;
    expect(oldApi.socket).toBeNull();
    expect(newApi.isConnected).toBe(true);
    expect(newApi.socket?.state).toBe('open');
    expect((await settle(pending)).value).toBe('in-block:deploy');
  });
});

describe('untilSocketClosed', () => {
  it('is true at once for a socket that is not connected', async () => {
    const api = new FakeApi();
    await expect(untilSocketClosed(api, 10)).resolves.toBe(true);
  });

  it('is true when the close event arrives, and stops listening', async () => {
    const api = new FakeApi();
    await api.connect();
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    const off = vi.spyOn(api, 'off');
    const closed = untilSocketClosed(api, NODE_SOCKET_CLOSE_WAIT_MS);
    await api.disconnect();
    expect((await settle(closed)).value).toBe(true);
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('is false at the bound for a socket still open', async () => {
    const api = new FakeApi();
    await api.connect();
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    expect((await settle(untilSocketClosed(api, 1_000))).value).toBe(false);
  });

  it('is true at the bound for a socket that closed without saying so', async () => {
    const api = new FakeApi();
    await api.connect();
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    const closed = untilSocketClosed(api, 1_000);
    api.isConnected = false;
    expect((await settle(closed)).value).toBe(true);
  });
});
