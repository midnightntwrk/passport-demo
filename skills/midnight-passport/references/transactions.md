# Asking Passport to make a transaction

Checked against v5.0 (d0faf26): `packages/connect/src/protocol/tx.ts`,
`src/core/client.ts`, and in Passport `examples/passport-demo/src/txConsent.tsx`,
`screens/AppBrowser.tsx`, `lib/txApproval.ts`, and `App.tsx`.

## Contents

- What can be requested (and what cannot)
- `requestPayment`: the call, what the user sees, the result
- Which Passports can pay on v5.0
- Explorer links
- Contract calls, mUSD, and other requests that do not exist
- A payment handler to copy

## What can be requested

Exactly one transaction: an **unshielded NIGHT transfer** from the user's
Passport account to an unshielded Midnight address. On the wire the intent is
`{ kind: 'unshielded-transfer', recipientAddress, amount, purpose }`, and the
parser refuses any other `kind`.

Not requestable, in any channel: a Compact contract call (any circuit on any
contract), a shielded payment (mUSD or any other shielded token), a message
signature, a DUST registration, or a batch. The package has no method for them
and Passport has no handler for them.

## `requestPayment`

```ts
const paid = await passport.requestPayment({
  recipientAddress: 'mn_addr_stagenet1…', // unshielded, same network as the Passport
  amount: 2_500_000n,                      // atomic NIGHT: 2.5 NIGHT. string or bigint, never a float
  purpose: 'Order #1042',                  // 1–140 chars, shown to the user on the sheet
});
```

Convert display amounts with integer arithmetic (1 NIGHT = 1,000,000 atomic,
`NIGHT_DECIMALS = 6`); for display the package exports `formatNight(atomic)`.
Invalid input (empty or over-long purpose, amount not 1–20 digits or zero,
recipient over 200 characters) never leaves the page: the result is
`{ status: 'failed', source: 'local', error: 'invalid-request' }`.

Call it from a click handler. In pop-up mode it opens (or reuses) the window
named `midnight-passport` with `?passportTxRequestId=&passportTxNonce=`.

### What the user sees (a Passport that can pay)

1. Passport's approval sheet: the app's origin, the recipient, the amount, the
   purpose, and the account balance it will be paid from.
2. On approve, the **passkey prompt**. Every payment is approved with the
   passkey; nothing that can sign is kept between payments. Cancelling the
   passkey prompt means nothing is signed.
3. Passport proves, signs, and submits. That can take tens of seconds; the
   client waits up to `timeoutMs` (default 180 s).

Checks Passport makes before the sheet, in order (`lib/txApproval.ts`): no
other sheet open (else `invalid-request`), a payable account open (else
`wallet-unavailable`), the recipient decodes as an unshielded address on the
Passport's network (else `invalid-request` or `network-mismatch`), and the
amount is valid.

### The result

```ts
type PassportPaymentResult =
  | { status: 'submitted'; txId: string; sponsored: boolean; feeNote?: string; message: string }
  | { status: 'declined' | 'failed'; source: 'passport'; error: PassportTxErrorCode; detail?: string; message: string }
  | { status: 'failed'; source: 'local'; error: PassportLocalErrorCode; message: string };
```

- `submitted`: the node accepted it. It is **not** final and no confirmation
  depth is reported. Say "sent", not "confirmed".
- The result reaches your page over an unsigned channel. Treat `txId` as the
  user's claim: before fulfilling anything of value, confirm on your side that
  the payment reached your address (your own indexer query or node), and
  never fulfil twice for one `txId`.
- `sponsored: true`: the network fee was covered. Only then may you say so.
- `declined` (`error: 'declined'`): the user said no on the sheet. Nothing was
  signed. Do not re-ask automatically.
- `failed` from `passport`: see `errors.md`; `detail` is a sentence for the
  user; `message` already includes it.
- `failed` from `local`: nothing was sent (`popup-blocked`,
  `passport-closed`, `invalid-request`) or nothing is known (`timed-out`).

## Which Passports can pay on v5.0

- **A Passport made on v5.0** (the account custody contract, every new
  Passport): the payment seam is not wired to the connect channels. Pop-up and
  framed requests are answered `{ status: 'failed', source: 'passport', error:
  'wallet-unavailable' }` (in the pop-up after a grace of about 5 s). The user
  can still send from Passport's own Send screen; an app cannot ask for it.
- **An older Passport**: works as described above; the payment comes out of the
  account with `withdraw_night`, and the fee is sponsored (`sponsored: true`).

Design for both: a `wallet-unavailable` must leave the page usable and say what
happened with `message`. If your product needs a NIGHT payment from every
user today, say to the developer that v5.0 does not provide one to apps, rather
than working around it.

## Explorer links

`https://explorer.1am.xyz/tx/<hash>?network=stagenet`, where `<hash>` is a
64-hex ledger transaction hash (this is what Passport itself links).
`txId` may instead be a 66-hex submission identifier when the indexer had not
caught up; that does not resolve on the explorer. Link only a 64-hex value:

```ts
function explorerLink(txId: string): string | null {
  const hash = txId.replace(/^0x/, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? `https://explorer.1am.xyz/tx/${hash}?network=stagenet` : null;
}
```

## Contract calls, mUSD, and anything else

If a user asks to "request a Passport transaction for my Compact contract", to
charge mUSD, or to have Passport sign data:

1. Say plainly that v5.0 has no such request, and do not invent one (no
   `requestTransaction`, `callContract`, `signMessage`, `window.midnight`, or
   custom `postMessage` types; Passport would ignore them or refuse them as
   malformed).
2. Offer what exists: a NIGHT `requestPayment` to an unshielded address the
   contract's operator controls (subject to the v5.0 limits above), then do the
   contract work on your own side; or, to give the user something, the partner
   API (`partner-api.md`).
3. If the product truly needs Passport to approve a contract call, that is a
   feature request to the Passport team (https://github.com/midnightntwrk/passport-demo),
   not something to build around the package.

## A payment handler to copy

```ts
import type { Passport, PassportPaymentResult } from '@midnight-passport/connect';

export async function pay(passport: Passport, recipient: string, atomicNight: bigint, purpose: string) {
  const result: PassportPaymentResult = await passport.requestPayment({
    recipientAddress: recipient,
    amount: atomicNight,
    purpose,
  });
  switch (result.status) {
    case 'submitted': {
      const link = explorerLink(result.txId);
      return {
        ok: true as const,
        text: result.sponsored ? 'Sent. Network fee covered.' : 'Sent.',
        link, // null: show result.txId as text, no link
      };
    }
    case 'declined':
      return { ok: false as const, text: result.message }; // the user said no; do not re-ask
    case 'failed':
      return {
        ok: false as const,
        text: result.message,
        // timed-out: the payment may have gone through. Ask the user to check Passport before retrying.
        checkPassport: result.source === 'local' && result.error === 'timed-out',
      };
  }
}
```
