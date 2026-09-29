---
name: midnight-passport
description: Integrate a web app or backend with Midnight Passport, the passkey identity and wallet for the Midnight network (`.night` names, stagenet). Covers "Continue with Passport" sign-in with `@midnight-passport/connect` (pop-up, in-app browser, React hooks, Next.js), asking Passport to pay, the signed redirect channel, gifting an item to a Passport by `.night` name or account from a backend (partner API `/gift-nft`), stagenet settings and explorer links, and troubleshooting. Use whenever a task mentions Midnight Passport, `@midnight-passport/connect`, a `.night` name, "Continue with Passport", `requestProfile`, `requestPayment`, gifting or paying a Passport user, or asking Passport to approve a Midnight transaction or Compact contract call.
license: Apache-2.0
metadata:
  author: Input Output Global, ARC
  source: https://github.com/midnightntwrk/passport-demo
  checked-against: v5.0 (d0faf26), 2026/09/28
---

# Building on Midnight Passport

Passport is the user's identity and wallet on Midnight: a passkey, a `.night`
name, and an account contract the user controls. Every Passport runs on
Midnight **stagenet**; nothing is mainnet. To an app, Passport is a
counterparty on another origin that it may **ask**; Passport decides, with the
user, on its own screen. An app never sees a key, a seed, a passkey, or a
signature, and there is no injected `window.midnight` provider for Passport.

Deployed Passports: `https://midnightpassport.com` (production) and
`https://midnight-passport-dev.vercel.app` (internal development build).

## Ground truth

This skill was checked against release **v5.0** of
https://github.com/midnightntwrk/passport-demo. When it and the code disagree,
the code wins: `packages/connect/src` (the package), `docs/demo/partner-api.md`
(the partner API), `examples/passport-demo/src` (how Passport answers). Never
invent a method, message type, field, endpoint, or error code. If a user asks
for something this skill says does not exist, say so and offer what does.

## What exists, and what answers today

Three things an app can do, and only three:

| Want | Use | Reference |
| --- | --- | --- |
| Who is this user? | `passport.requestProfile(['displayName', 'passportContract'])` | `references/connect-api.md` |
| Ask the user to pay NIGHT | `passport.requestPayment({ recipientAddress, amount, purpose })` | `references/transactions.md` |
| Give a user an item from a backend | `POST <partner base>/gift-nft` with `name`, `account`, or `address` | `references/partner-api.md` |

There is **no** request for an arbitrary Compact contract call, for a shielded
(mUSD) payment, for signing a message, or for wallet addresses. Do not write
code that pretends otherwise; read `references/transactions.md` for what to do
instead.

**Which Passports answer which channel on v5.0** (verified in the code, not a
promise about later releases). Since v5.0, every new Passport is made on the
account custody contract; Passports made earlier are older "prototype"
Passports.

| Channel | Passport made on v5.0 | Older Passport |
| --- | --- | --- |
| In-app browser (your app framed by Passport), `requestProfile` | Answers, one toggle per field | Answers |
| Pop-up `requestProfile` | **Not answered.** Passport shows "An app is waiting for your Passport"; your call ends `timed-out` (180 s) or `passport-closed` | Answers after consent |
| `requestPayment` (pop-up or framed) | **Refused** with `wallet-unavailable` | Approval sheet, then a passkey prompt; sponsored fee |
| Signed redirect | **Not answered** | Answers, signed |

So: build with the package (its outcomes are safe in every case), make the
in-app browser your primary path (`references/listing.md`), render every
result's `message`, and tell the developer plainly which rows above their flow
depends on. Deliver value to a v5.0 Passport through the partner API, which
does support them.

## Workflow

1. **Get the package.** `@midnight-passport/connect` (0.1.1) is **not on npm**;
   `npm install @midnight-passport/connect` fails with E404, whatever older
   READMEs say. Build it from a release and install the tarball:
   ```sh
   bash <skill>/scripts/vendor-connect.sh <app-dir>        # default ref: v5.0
   cd <app-dir> && npm install ./vendor/midnight-passport-connect-0.1.1.tgz
   ```
   It needs `git`, `node`, and network access; it writes one file,
   `vendor/midnight-passport-connect-<version>.tgz`. Commit that tarball.
   Inside the passport-demo repository itself, use the workspace instead (see
   `examples/doorman/vite.config.ts` for the alias).
2. **Pick the Passport origin** and put it in config, exactly (scheme, host,
   port, no path): `https://midnightpassport.com`,
   `https://midnight-passport-dev.vercel.app`, or `http://localhost:5175` for a
   Passport run from the repository.
3. **Create one client per page, in the browser only**: `createPassport({ origin })`.
   It reads `window` when created, so it throws during server rendering. In
   Next.js or any SSR framework follow `references/nextjs.md`; with React use
   `references/react.md`.
4. **Call requests from a click handler.** Outside Passport's in-app browser the
   request opens a pop-up, which needs the click's user gesture; do not call it
   from an effect or after unrelated `await`s.
5. **Render the result.** Every result is a discriminated union with a
   `message` written for the user. Show it; never show a bare code. Handle
   partial consent, a decline, and the local failures (`references/errors.md`).
6. **Test without a browser** by passing a scripted `PassportTransport` (see
   `assets/connect-example/test/connect.test.ts`), then walk it once against a
   deployed Passport.

## The minimal integration

```ts
import { createPassport } from '@midnight-passport/connect';

const passport = createPassport({ origin: 'https://midnightpassport.com' });

button.addEventListener('click', async () => {
  const who = await passport.requestProfile(['displayName', 'passportContract']);
  if (who.approved) {
    const name = who.profile.displayName;          // 'alice' or 'alice.night'; undefined if not shared
    const account = who.profile.passportContract;  // { address: <64 hex>, network: 'stagenet' } or undefined
    showSignedIn(name, account, who.withheld);     // withheld: fields the user did not share
  } else {
    show(who.message);                             // decline, blocked pop-up, closed window, timeout
  }
});
```

- `displayName` is the user's `.night` name. A v5.0 Passport sends the label
  (`alice`); an older one sends `alice.night`. Normalise: append `.night` only
  if it is missing.
- `passportContract.address` is the account contract the name resolves to: the
  user's identity, and what `/gift-nft` takes as `account`. It is not a wallet
  address; never send NIGHT or tokens to it by hand.
- `approved: true` with a non-empty `withheld` is still a sign-in.

## The bundled example

`assets/connect-example/` is a minimal Vite + TypeScript app ("Continue with
Passport", renders the name, the account, and every failure sentence) with a
Vitest suite that drives the real package through a scripted transport. To use
it:

```sh
cp -R <skill>/assets/connect-example my-app
bash <skill>/scripts/vendor-connect.sh my-app
cd my-app && npm install ./vendor/midnight-passport-connect-0.1.1.tgz && npm install
npm test                                  # 8 tests, no browser
VITE_PASSPORT_ORIGIN=https://midnight-passport-dev.vercel.app npm run dev   # http://localhost:5190
```

Pressing the button opens Passport. With no Passport in that browser, Passport
shows its welcome page and "An app is waiting for your Passport"; closing it
shows "The Passport window was closed before it answered. Nothing was shared
and nothing was paid."

## References (read the one the task needs)

- `references/connect-api.md`: every export, option, result shape, the two
  transports, limits, and testing with a scripted transport.
- `references/transactions.md`: `requestPayment`, what the user sees, results,
  explorer links, and what to do for contract calls and mUSD.
- `references/errors.md`: every error code, its sentence, and how to word
  what happened.
- `references/troubleshooting.md`: symptoms to causes (nothing happens, pop-up
  blocked, wrong origin, timeouts, passkey prompt cancelled, SSR crash).
- `references/react.md` and `references/nextjs.md`: the provider, the hooks,
  and the SSR-safe patterns (verified with `next build`).
- `references/redirect-channel.md`: the signed full-page redirect for phones.
- `references/partner-api.md`: `POST /gift-nft` by name, account, or shielded
  address; responses, errors, rate limits, and resolving names yourself.
- `references/stagenet.md`: network settings, address kinds, assets (NIGHT,
  mUSD), the opening grant, the faucet, the explorer, recovery, and pitfalls.
- `references/listing.md`: the in-app browser, local testing with
  `VITE_LOCAL_APP_URL`, and getting listed in the Apps grid.
- `references/copy-and-vocabulary.md`: the words to use in anything a user
  reads.

## Never

- Never handle or request key material: seeds, private keys, passkeys,
  mnemonics, signatures, viewing keys. The protocol carries none.
- Never imitate or pre-empt Passport's sheets: no auto-retry of a decline, no
  UI implying approval already happened, no fake `submitted`.
- Never treat `timed-out` or `passport-closed` as a decision. For a payment,
  `timed-out` means "unknown": tell the user to check Passport before retrying.
- Never say a payment is free. Show "network fee covered" only when
  `sponsored === true` on a `submitted` result.
- Never write your own `postMessage` transport or post to `'*'`; the package
  pins the origin and the source window.
- Never call the partner API from a browser, and never ship an
  `X-Passport-Key` in client code or a `VITE_*`/`NEXT_PUBLIC_*` variable.
- Never call this an SDK in user- or partner-facing text: it is the Passport
  connect package.
