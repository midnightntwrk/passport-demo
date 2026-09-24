/**
 * The wallet's submission service, with its closes made honest.
 *
 * LIVE ON STAGING, 2026/09/23 17:08 UTC (build 55dd2235). The first new
 * Passport in a browser set up; the second, a minute later, failed every press
 * with "WebSocket is already in CLOSING or CLOSED state", then
 * `submitAndWatchExtrinsic … disconnected … 1000:: Normal Closure`. Code 1000
 * is a close THIS TAB asked for, not the node's.
 *
 * WHAT CLOSED IT. The wallet SDK's node client (`PolkadotNodeClient` in
 * `@midnight-ntwrk/wallet-sdk-node-client`) opens its socket only to load
 * metadata and to submit, and calls `api.disconnect()` after each: once as the
 * last step of opening, and once in the `ensuring` of every submission. In
 * polkadot-js 16 (`WsProvider.disconnect`) that call only ASKS the socket to
 * close — `close(1000)` — and returns at once; `isConnected` stays `true` until
 * the socket's close event arrives a round trip later. The client decides
 * whether to reconnect from `isConnected` alone. So a submission that starts in
 * that window skips the reconnect and is written to a socket that is already
 * closing, and the close event then fails it with "Normal Closure".
 *
 * WHY THE SECOND PASSPORT, AND WHY EVERY PRESS. Since 2026/09/23 the setup
 * opens a fresh wallet at the press, and a warm tab balances the deploy in
 * well under a second — before the new node client has finished opening. The
 * submission waits for it, and is handed the client the instant its opening
 * `disconnect()` has been asked for: inside the window, every time. The one
 * resubmit then opened another fresh wallet and walked into the same window.
 * The first Passport of a tab escaped only because a cold tab was slow enough
 * for the close to finish first.
 *
 * THE FIX, HERE. Every `disconnect()` the node client makes resolves only once
 * the socket has actually closed (bounded by {@link NODE_SOCKET_CLOSE_WAIT_MS}),
 * a submission never starts while a close this service began is still running,
 * and one submission's close never cuts off another that is still using the
 * same socket. A close that does not finish within the bound fails the
 * submission as a closed connection — nothing is written to the socket — so the
 * caller's one resubmit on a fresh connection applies.
 *
 * It holds no SDK and no polkadot-js: the node client is opened through
 * `open`, which `./localWallet.ts` supplies from the SDK. Nothing is shared
 * between two services — each opens its own client and socket — so closing one
 * wallet's never touches another's.
 */

/** What this needs of polkadot-js's `ApiPromise`. */
export interface NodeSocketApi {
  /** Stays `true` while a requested close is still in progress. */
  readonly isConnected: boolean;
  disconnect(): Promise<void>;
  on(type: 'disconnected', handler: () => void): unknown;
  off(type: 'disconnected', handler: () => void): unknown;
}

export type SubmissionWait = 'Submitted' | 'InBlock' | 'Finalized';

/** One opened node client: its API, a submit, and its own shutdown. */
export interface NodeClientHandle<TResult> {
  readonly api: NodeSocketApi;
  send(tx: unknown, waitFor: SubmissionWait): Promise<TResult>;
  close(): Promise<void>;
}

/** The shape `WalletFacade` submits through. */
export interface NodeSubmissionService<TResult> {
  submitTransaction(tx: unknown, waitForStatus?: SubmissionWait): Promise<TResult>;
  close(): Promise<void>;
}

/** How long a requested close may take before the socket is given up on. */
export const NODE_SOCKET_CLOSE_WAIT_MS = 5_000;

/**
 * The refusal when a close did not finish within the bound. Named and worded
 * as the SDK's own closed-socket failures are, so the callers' existing rules
 * (a lost submission, one resubmit on a fresh connection) apply unchanged.
 */
export class NodeSocketStillClosing extends Error {
  constructor() {
    super(
      'WebSocket is not connected: the previous connection to the node had not finished closing, so nothing was sent.',
    );
    this.name = 'SubmissionError';
  }
}

/**
 * Resolves `true` once `api`'s socket has closed, or `false` if it is still
 * open at the bound. Already closed is `true` at once.
 */
export function untilSocketClosed(api: NodeSocketApi, boundMs: number): Promise<boolean> {
  if (!api.isConnected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (closed: boolean) => {
      clearTimeout(timer);
      api.off('disconnected', onClosed);
      resolve(closed);
    };
    const onClosed = () => settle(true);
    const timer = setTimeout(() => settle(!api.isConnected), boundMs);
    api.on('disconnected', onClosed);
  });
}

/**
 * A submission service over one node client whose closes are honest.
 *
 * The client is opened at once, as the SDK's default does, and a failure to
 * open is reported to the submission that needed it.
 */
export function settledSubmissionService<TResult>(
  open: () => Promise<NodeClientHandle<TResult>>,
  options: { closeWaitMs?: number } = {},
): NodeSubmissionService<TResult> {
  const boundMs = options.closeWaitMs ?? NODE_SOCKET_CLOSE_WAIT_MS;
  /** Submissions started and not yet finished. */
  let inFlight = 0;
  /** A close this service asked for that has not finished yet. */
  let closing: Promise<boolean> | null = null;
  let shuttingDown = false;

  const track = (api: NodeSocketApi): Promise<boolean> => {
    const settled = untilSocketClosed(api, boundMs);
    closing = settled;
    /* Only one close is ever tracked at a time: the wrapper below waits on a
       running one rather than starting another. */
    void settled.then(() => {
      closing = null;
    });
    return settled;
  };

  const ready = open().then((handle) => {
    const { api } = handle;
    /* THE OPENING CLOSE. The client disconnects the socket it loaded metadata
       on as the last step of opening, before any wrapper could be installed —
       so a socket that still reads as connected here is one that is closing. */
    void track(api);
    const disconnect = api.disconnect.bind(api);
    (api as { disconnect(): Promise<void> }).disconnect = async () => {
      /* Another submission is still on this socket; its own end closes it. A
         shutdown closes regardless. */
      if (!shuttingDown && inFlight > 1) return;
      if (closing !== null) {
        await closing;
        return;
      }
      const wasOpen = api.isConnected;
      const settled = wasOpen ? track(api) : null;
      await disconnect();
      if (settled !== null) await settled;
    };
    return handle;
  });
  // Reported to the submission that awaits it, never as an unhandled rejection.
  ready.catch(() => undefined);

  return {
    async submitTransaction(tx, waitForStatus = 'InBlock') {
      const handle = await ready;
      inFlight += 1;
      try {
        /* NEVER ON A SOCKET WE ARE CLOSING. Waiting here lets the close finish,
           so the client sees the socket as closed and opens a new one. */
        const pending: Promise<boolean> | null = closing;
        if (pending !== null && !(await pending)) throw new NodeSocketStillClosing();
        return await handle.send(tx, waitForStatus);
      } finally {
        inFlight -= 1;
      }
    },
    async close() {
      shuttingDown = true;
      const handle = await ready.catch(() => null);
      if (handle !== null) await handle.close();
    },
  };
}
