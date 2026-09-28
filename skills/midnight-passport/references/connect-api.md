# `@midnight-passport/connect`: the API

Checked against `packages/connect/src` at release v5.0 (d0faf26), 2026/09/28.
Version 0.1.1, ESM only, `sideEffects: false`, Apache-2.0. If this file and the
code disagree, the code wins.

## Contents

- Three entry points
- `createPassport(options)` and the `Passport` object
- `detect()`, `requestProfile(fields)`, `requestPayment(intent)`, `reportIncentive(incentive)`, `on(event)`
- The two transports
- Wire limits
- Testing with a scripted transport

## Three entry points

| Entry | Runtime dependencies | Contents |
| --- | --- | --- |
| `@midnight-passport/connect` | none | wire protocols, `createPassport`, the iframe and pop-up transports |
| `@midnight-passport/connect/react` | `react` >= 18 (optional peer) | `PassportProvider`, `usePassport`, `usePassportProfile`, `usePassportPayment` |
| `@midnight-passport/connect/redirect` | `@noble/curves`, `@noble/hashes`, `@scure/base` | the signed redirect channel and its verifier |

No entry pulls in WebAssembly or the Midnight SDK. Nothing here is a wallet:
the package only asks Passport, on another origin, to do things.

## `createPassport(options)`

```ts
interface CreatePassportOptions {
  origin: string;        // REQUIRED. Exact Passport origin. No default, on purpose.
  transport?: 'auto' | 'iframe' | 'popup' | PassportTransport; // 'auto': window.parent !== window
  timeoutMs?: number;          // one exchange; default PASSPORT_DEFAULT_TIMEOUT_MS = 180_000
  presenceTimeoutMs?: number;  // detect() / framed handshake; default 2_500
  closedPollMs?: number;       // pop-up closed poll; default 500
  popupFeatures?: string;      // default 'popup,width=620,height=780'
  window?: Window;             // injected for tests
}
```

- Trailing slashes on `origin` are stripped. Anything else must be exact:
  scheme, host, port, **no path**. A wrong origin is a silent failure: the
  client drops every message whose `event.origin` differs.
- `createPassport` reads `window` immediately. It throws
  `ReferenceError: window is not defined` on a server. Create it only in the
  browser (see `nextjs.md`).
- Create **one** client per page and keep it. Two clients are two listeners.

```ts
interface Passport {
  readonly origin: string;
  readonly mode: 'iframe' | 'popup';
  detect(): Promise<PassportPresence>;
  ready(): Promise<void>;   // framed: resolves after the handshake, rejects if absent; pop-up: resolves at once
  requestProfile(fields: readonly PassportProfileField[]): Promise<PassportProfileResult>;
  requestPayment(intent: PassportPaymentIntent): Promise<PassportPaymentResult>;
  reportIncentive(incentive: PassportIncentive): Promise<PassportIncentiveResult>;
  on<K extends 'message' | 'ready' | 'error'>(event: K, listener: (e) => void): () => void;
  destroy(): void;
}
```

None of the request methods throw. Every outcome is a value with a `message`.

### `detect()`

- `{ present: true, via: 'handshake' }`: framed, and Passport answered.
- `{ present: false, reason: 'no-reply' }`: framed, and nothing answered.
- `{ present: 'unknown', reason: 'popup-mode' }`: not framed. There is no
  injected provider (`window.midnight` does not exist for Passport). Render the
  button; find out when the user presses it.

### `requestProfile(fields)`

`fields`: a non-empty, duplicate-free subset of
`PASSPORT_PROFILE_FIELDS = ['displayName', 'passportContract']`. Anything else
is refused locally (`invalid-request`) before anything is sent. There is no
field for wallet addresses, email, or keys, and asking for one is refused.

```ts
type PassportProfile = Partial<{
  displayName: string;                                  // the .night name: 'alice' (v5.0 Passport) or 'alice.night' (older)
  passportContract: { address: string; network: string }; // the account the name resolves to
}>;

type PassportProfileResult =
  | { approved: true;  profile: PassportProfile; withheld: PassportProfileField[]; message: string }
  | { approved: false; source: 'passport'; error: 'denied' | 'profile_unavailable' | 'invalid_request' | 'version_mismatch'; message: string }
  | { approved: false; source: 'local';    error: PassportLocalErrorCode; message: string };
```

What the values look like on v5.0 is in `stagenet.md` ("Identity values").

### `requestPayment(intent)`

```ts
interface PassportPaymentIntent {
  recipientAddress: string;   // an UNSHIELDED Midnight address (mn_addr_…), 1–200 chars
  amount: string | bigint;    // atomic NIGHT, base 10, 1–20 digits, > 0. 1 NIGHT = 1_000_000. Never a float.
  purpose: string;            // 1–140 chars; the user reads it on the approval sheet
}

type PassportPaymentResult =
  | { status: 'submitted'; txId: string; sponsored: boolean; feeNote?: string; message: string }
  | { status: 'declined' | 'failed'; source: 'passport'; error: PassportTxErrorCode; detail?: string; message: string }
  | { status: 'failed'; source: 'local'; error: PassportLocalErrorCode; message: string };
```

The only intent kind on the wire is an unshielded NIGHT transfer
(`kind: 'unshielded-transfer'`). There is no request for shielded tokens
(mUSD), for an arbitrary contract call, or for a message signature. Read
`transactions.md` before promising any of those to a user.

`formatNight(atomic: string): string` and `NIGHT_DECIMALS` (6) are exported for
display.

### `reportIncentive({ id, label, txId? })`

Framed only (pop-up gives `sent: false, error: 'unsupported-transport'`).
Unauthenticated by construction: Passport records the app's assertion as the
app's assertion. Result: `{ sent: true, message } | { sent: false, error, message }`.

### `on(event, listener)`

`'message'` (`{ direction: 'in' | 'out', type, payload, at }`), `'ready'`
(`{ requestId, nonce }`), `'error'` (`{ code, message }`). Returns the
unsubscribe function. Rendering the `message` stream in a dev panel is the
fastest way to debug an origin problem: if it stays empty, the origin is wrong.

## The two transports

| | Framed by Passport (`iframe`) | Your own page (`popup`) |
| --- | --- | --- |
| Chosen when | `window.parent !== window` | otherwise |
| Exchange pair | minted by Passport in `passport.profile.ready`, echoed | minted by the client, put on the pop-up URL |
| Launch URL | none | `<origin>/?passportRequestId=&passportNonce=` (profile), `?passportTxRequestId=&passportTxNonce=` (payment) |
| Needs a user gesture | no | **yes**: call from a click handler |
| `reportIncentive` | yes | no |
| `detect()` | answers | `'unknown'` |

One pop-up window name (`PASSPORT_WINDOW_NAME = 'midnight-passport'`) is used
for both exchanges, so a payment reuses the window the user signed in with. The
pop-up is polled; a window closed before answering is `passport-closed`.

## Wire limits (`src/protocol/limits.ts`)

ids, nonces, profile strings 256; profile addresses 512; `recipientAddress`
200; `purpose` 140; `detail` 400; incentive `label` 80; `feeNote` 140.

Both postMessage protocols carry a numeric `version`. A Passport that cannot
read yours answers `version_mismatch` (profile) or `version-mismatch` (payment).

## Testing with a scripted transport

Pass a `PassportTransport` object as `transport` and answer what the client
posts with the exported message constructors
(`createPassportProfileResponse`, `createPassportTxResponse`). Pass
`window: globalThis as unknown as Window` so it runs under Node. The bundled
`assets/connect-example/test/connect.test.ts` does exactly this for approve,
partial consent, decline, blocked pop-up, closed window, and timeout.

Other root exports, for receivers and custom transports only:
`randomExchangePair`, `randomRequestId`, `createPopupTransport`,
`createIframeTransport`, `PASSPORT_LAUNCH_PARAMS`, `PassportTransportError`,
the `create*`/`read*`/`parse*` message functions, the error-code arrays and
guards, `passportErrorMessage`, and `PassportProtocolError`.
