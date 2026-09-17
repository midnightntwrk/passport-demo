# Dynamic in the Passport demo — stage 1, social sign-in and an embedded EVM wallet

**Date:** 2026/09/14
**Scope:** passport-demo issue #20, stage 1, first slice.
**Companion document:** `docs/demo/dynamic-evm-capability-audit.md`, which is the capability read this slice was scoped against. Nothing in it has been superseded.

---

## 1. What this slice does

A build given a `VITE_DYNAMIC_ENVIRONMENT_ID` gains three things, and nothing else:

1. **A secondary entry on the welcome screen.** Beneath "Continue with Passkey" and its hint, a "Continue with Google, Microsoft, X, or Discord" pill opens Dynamic's own sign-in overlay in a pop-up.
2. **A Dynamic session, remembered.** Dynamic's SDK persists its session itself, in this browser's storage, so a signed-in person is still signed in after a reload. It sits *beside* the passkey profile; neither one is stored inside the other, and neither can revoke the other.
3. **An identity row on Home**, in the quiet footer beside "Back up or restore": the provider and handle, the embedded Ethereum address, and a "Sign a test message" action that prints the signature it gets back.

After a social sign-in the person is handed straight back to the passkey button. **A Dynamic session is not a way into a Passport.** It proves who somebody is to a provider; it does not produce a key this account is held by.

## 2. What this slice deliberately does not do

- **Nothing about the account contract or its authorisation changes.** The passkey on the device remains the device key for every contract call the Passport makes. The Dynamic key has never signed one and cannot yet — see §5.
- **No key material moves anywhere.** The embedded key lives in Dynamic's MPC; the passkey-derived seed lives where it always has.
- **No existing Passport is migrated.** Stage 1 is additive by construction.
- **Nothing changes in any build shipped today.** With the variable unset — which is every build — the app renders and behaves exactly as it did before this slice, and the `@dynamic-labs` packages are not fetched at all.

## 3. How the flag works, and why it is shaped this way

`e1593bb` ("Remove Dynamic from the demo") measured what the previous integration cost: the app **could not boot** without an environment id, and the SDK sat in the **entry chunk** — 6,378 kB against 717 kB once it was gone. Both are properties of *where the import sits*. So the rule this slice ships under is structural:

> No module reachable from `src/main.tsx` through a **static** import may name `@dynamic-labs`.

That is enforced, not merely intended. `src/lib/dynamicBundle.test.ts` walks the static import graph from `main.tsx` and fails if the specifier appears on it.

| Module | Role |
|---|---|
| `src/lib/dynamicSession.ts` | The gate (`isDynamicEnabled`), the pure mapping from Dynamic's user object to the two strings a screen renders, and the module-level store. **Imports nothing.** 100 % covered. |
| `src/lib/dynamic.tsx` | The only module that names `@dynamic-labs`, both times inside `import()`. Exposes `mountDynamic()` and `useDynamicSession()`. |
| `src/main.tsx` | `if (isDynamicEnabled()) void import('./lib/dynamic.js')…`, **after** `root.render`, with the rejection swallowed. |

Two consequences worth stating, because both were decisions:

- **The provider is mounted on a second React root**, on its own `<div>`, rather than wrapped around `<PassportDemo />`. Inserting a provider above the app once the lazily-loaded chunk lands changes the tree's structure, and React reconciles by position — the swap would unmount and remount the whole Passport, potentially mid-passkey-ceremony. The session crosses between the two roots through a module-level store read with `useSyncExternalStore`.
- **A vendor that will not load costs a button, not a boot.** `mountDynamic` catches everything and returns the seam to its disabled state, in which every screen renders exactly what a flag-off build renders.

### Bundle-size effect, measured

Built through Playwright's `webServer` (`npm run build && npm run preview`), stagenet preview env, on this branch:

| | Entry chunk | Entry, gzipped | All JS | Chunks | CSS |
|---|---|---|---|---|---|
| Before this slice | 871,470 B | 238,572 B | 3,216,307 B | 44 | 109,503 B |
| Flag **unset** — every build today | 874,837 B | 239,509 B | 3,219,674 B | 44 | 111,812 B |
| **Delta** | **+3,367 B** | **+937 B** | **+3,367 B** | **0** | **+2,309 B** |
| Flag **set** | 878,468 B | 241,032 B | 10,169,915 B | 118 | 111,812 B |

With the flag unset the cost is **+3,367 B uncompressed, +937 B gzipped** in the entry chunk — the hook, the gate, and the two components that return `null` — plus 2,309 B of CSS for rules nothing matches. No chunk in that build names `@dynamic-labs`, and the chunk count is unchanged.

With the flag set the SDK adds **6,950,241 B across 74 additional chunks**, none of which is in the entry chunk: the entry grows by 3,631 B, which is the `import()` call site and its module. Those 74 chunks are fetched after first paint, or not at all if the vendor is unreachable.

**A dynamic import is not dead code to a bundler merely because the branch above it is false at run time.** Written as `if (isDynamicEnabled())`, a flag-off build emitted all 118 chunks and 10,169,722 bytes anyway — nothing would ever have *fetched* them, but they would have been deployed. `main.tsx` therefore gates on `import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID` directly, which Vite substitutes with a literal so Rollup can collapse `if (undefined)` and delete everything behind it. That is the one place the variable is read directly rather than through `isDynamicEnabled()`, and `dynamicBundle.test.ts` holds it there.

## 4. Dashboard settings a staging environment needs

**We have none of these yet.** The environment id is the only value the app takes; everything else below is switched on inside Dynamic's dashboard, and the app cannot compensate for any of it. `socialProvidersFilter` in `dynamic.tsx` *narrows* the list an environment already offers — it cannot switch a provider on.

| Where, in the Dynamic dashboard | Setting | Value needed |
|---|---|---|
| Developers → SDK & API Keys | **Environment ID** | The value for `VITE_DYNAMIC_ENVIRONMENT_ID`. One per environment; use a sandbox environment for staging, not the live one. |
| Security → Account Security → CORS Origins ("Create Origin"; not Developers → Domains, not Settings → General) | **Origins** | `http://localhost:5175` (the dev origin this app pins itself to), `http://localhost:4173` (the Playwright preview origin), and the staging deployment's origin, `https://staging.midnightpassport.com`. A missing origin is not silent: the SDK's `settings`, `sdkSettings`, and `nonce` calls are refused by CORS, it never reports itself loaded, and the control stays on "Getting the other ways in ready" for good (seen on staging 2026/09/14; adding the origin fixed it with no redeploy). |
| Log in & User Profile → Social | **Providers** | Google, Discord, Microsoft, and X (stored as `twitter`) each switched on, each with its own OAuth client id and secret registered with that provider. Nothing appears in the overlay that is off here. |
| Log in & User Profile → Social | **Strategy** | Pop-up. The app requests `social: { strategy: 'popup' }`; a redirect discards the tab, and the tab may be holding a half-finished passkey ceremony. |
| Chains & Networks | **EVM enabled**, and the chains | At least one EVM chain. The demo does not transact on it in this slice, so any testnet is sufficient; pick the one stage 2 will use so the address does not change under us. |
| Embedded Wallets | **Create on sign-up** | On, for EVM. There is no client-side flag for this, which is why the app treats a signed-in session with no address as legitimate rather than an error. |
| Embedded Wallets → Security | **Private Key Exports** | Not required by this slice. It *was* required by the pre-`e1593bb` integration; do not switch it on by reflex. |

Once an environment exists, the smallest useful validation is: set the variable, load the app, press "Continue with …", sign in with each of the four providers in turn, and confirm that Home shows the provider, a handle, and an Ethereum address, and that "Sign a test message" returns a signature **twice with the same bytes**.

## 5. The open capability questions for the next slice

Stage 2 is "sign every account-contract call with the Dynamic EVM key". The audit established that this turns on one question, and it is not a question the client code can answer — it has to come from Dynamic.

### 5.1 Why `signMessage` is not the answer

The account contract's k256 arm verifies an ECDSA-secp256k1 signature over `SHA-256(prefix(envelope) || challenge)`. Dynamic's `primaryWallet.signMessage(text)` — the call this slice's "Sign a test message" button makes — is EIP-191 `personal_sign`: **keccak-256** over `"\x19Ethereum Signed Message:\n" + length + message`. There is no keccak-256 in Compact, so no envelope can recompute that digest. Typed-data signing has the same problem for the same reason.

This is why the test message here is a plain string and **not** the real `midnight_signed_message:32:` envelope. Printing a signature next to the real prefix would suggest a verification path that does not exist.

### 5.2 The questions put to Dynamic

Asked in the Webisoft–Dynamic channel, 2026/09/14. The substance is below; whoever has the channel to hand should confirm the wording matches and correct this section if it does not.

> 1. Is **raw signing** available to EVM embedded (MPC) wallets from the React SDK? We can see `IDynamicWaasConnector.signRawMessage({ accountAddress, context, message, password })` in `@dynamic-labs/wallet-connector-core` 5.8.0, and the API model `SignMessageRawSign` with `payload` (hex pre-image) and `hashFunction` in `{ sha512Half, keccak256, sha256, blake2b }`, but we found no implementation of `signRawMessage` in the four client packages we unpacked. Is it shipped, is it server-gated, or is it internal?
>
> 2. If it is available: does `hashFunction: sha256` accept a pre-image **longer than 32 bytes**? The model notes that `sha256` is "guarded against 32-byte pre-hashed payloads". Ours is 59 bytes (`midnight_signed_message:32:` followed by a 32-byte challenge), so the guard should not apply — we want that confirmed rather than assumed.
>
> 3. What exactly comes back — plain 64-byte `r‖s`, or 65-byte `r‖s‖v`, and in what encoding? We verify in a ZK circuit that has no keccak, so we need the raw curve values, not an Ethereum-shaped envelope.
>
> 4. Is the signature **deterministic** (RFC 6979 or equivalent) for the same key and the same pre-image, or does the MPC protocol introduce fresh randomness per signature? Either answer is workable; we need to know which, because one of them means a signature can be cached and re-presented and the other means it cannot.
>
> 5. Is the embedded key **the same key** across a user's devices after recovery, so a signature made on a second device verifies against the enrolment made on the first?

### 5.3 What each answer means for us

- **Raw `sha256` signing is available, arbitrary-length pre-image, plain `r‖s`.** Envelope 1 fits as-is and *nothing on the contract changes*. Stage 2 is a client integration.
- **It is not available.** The k256 arm cannot be used with a Dynamic EVM wallet, and that has to be said before an estimate is given — the working agreement on passport #106. A new envelope is not a way out: keccak-256 is not available in Compact.

### 5.4 The second dependency, unchanged

The demo's deployed account contract is the prototype (hash-preimage device witness), not the account custody reference. Signing account calls with a Dynamic key therefore also needs the demo to move to the account custody contract — a new address per Passport and a migration. The one-transaction transfer work (#13) already carries a migration of the same shape, and doing both at once would spare users a second upgrade. That is a sequencing decision for a call, not a unilateral one.

## 6. Files

| File | What it is |
|---|---|
| `examples/passport-demo/src/lib/dynamicSession.ts` | The gate, the pure session mapping, the cross-root store. No imports. |
| `examples/passport-demo/src/lib/dynamic.tsx` | The lazily-loaded provider wrapper and `useDynamicSession()`. |
| `examples/passport-demo/src/screens/ContinueWithSocial.tsx` | The welcome screen's secondary entry. |
| `examples/passport-demo/src/screens/DynamicIdentity.tsx` | Home's identity row and the test-signature action. |
| `examples/passport-demo/src/lib/dynamicSession.test.ts` | The gate and the mapping, drilled. |
| `examples/passport-demo/src/lib/dynamicBundle.test.ts` | The import-graph gate that keeps the SDK out of the entry chunk. |

---

# Stage 2 — the Dynamic-only Passport, as built

**Date:** 2026/09/16
**Scope:** `docs/demo/dynamic-build-out-plan.md` §6, PR 5 of its sequence. Builds on the account custody
custody layer (`docs/demo/account-custody-layer-design.md` §7a).

Everything above this line describes stage 1 and is still true of it. What changes is the
last sentence of §1: **a Dynamic session is now a way into a Passport**, on a build given
an environment id, for somebody who has no passkey Passport on the device.

## 7. What a person does, in order

1. **Welcome.** The passkey button is unchanged and still first. Beneath it, "Continue
   with Google, Microsoft, X, or Discord" opens Dynamic's overlay as it did.
2. **Signed in.** The sentence "Signed in … Finish with your passkey above" is gone. A
   signed-in person with no passkey profile is taken to their own screen: "Set up your
   Passport", over their provider and handle.
3. **Create.** One control. Behind it: the device point is recovered once from a
   signature over `SHA-256("midnight-passport:k1-device-enrolment:v1")`, then
   `deployCustodyAccount` runs its three sponsored waves and `activateK1Device` opens the boot
   commitment. The line under the button counts **three** steps — set up, finish, turn the
   sign-in on — not the four transactions, because the two maintenance waves are one thing
   to the person waiting and the wave count is a property of a verifier-key budget nobody
   outside this repository could follow. Resumable: the record is read before every press
   and the chain before every wave, so a reload continues rather than deploying again.
4. **Name.** The same sponsored `POST /register-alias` the passkey path uses, carrying the
   custody account address as the name's target — the request shape is identical, because
   `contractAddress` is what the service takes and a custody account has one like any other.
5. **Home.** The provider and handle; the account's own NIGHT, read from the account custody build's
   `unshielded_balances` mirror; the name (or the account address) to be paid at; a Send
   form; and one sentence saying a private token can be received here and not yet sent.
6. **Send.** Two legs, as on every build: `withdraw_unshielded_with_k256(colour, amount,
   this device's receiving address)` — the one thing the holder approves, through
   `signRawMessage` — then the recipient's permissionless deposit, chosen by asking the
   chain what the recipient's account is built from.
7. **On a second device.** "I already have a Passport" → type the name → Passport resolves
   it, checks the account carries `withdraw_shielded_with_k256`, derives this sign-in's
   device entry exactly as activation did and asks the ledger whether the device set holds
   it. Only then is the local record written.

## 8. What is real and what is not

| | |
|---|---|
| Real | The identity choice, the stage machine, the setup copy, the resumable deploy, the name claim, the balance read, the send plan, the recovery checks, and both legs' call shapes. |
| Real | The approval. `signRawMessage` signs the contract's own challenge, and `k1Call` is the shipped gated-call path from the custody layer. |
| **Not built** | **Sending a shielded balance.** `withdraw_shielded_with_k256` binds the qualified coin into the challenge (AUTH-10), and the coin comes from the `held_coin` witness — the coin store, `account-custody-layer-design.md` §3. The row is shown with one sentence rather than a control that would fail. |
| **Not built** | **Paying somebody who holds one of these Passports.** `deposit_unshielded` is permissionless but is not reachable through `k1Call`, which always appends `_with_k256` and an authorisation trailer. One sentence, not a call that fails three files away. |
| **Not deployed** | `POST /prove-account-custody` on the balancer (probed 2026/09/16: `404`). Every account custody transaction goes through it, so a live run stops at the first one. `custodyProofProvider` refuses immediately with one sentence rather than waiting out a ten-minute proof timeout. |
| Deliberately absent | Migration of an existing passkey Passport. §6 of the build-out plan puts it out of this version; the two kinds coexist and can pay each other. |

**One consequence worth writing down.** The `.night` name's owner secret is derived from
this device's own transaction key, because the sign-in holds nothing deterministic to
derive one from — its signatures carry fresh randomness per signature (DKLs23). So the
name can be claimed here and **cannot be re-pointed from a second device** in this
version. Coming back to the Passport does not need it: recovery reads the registry and the
account's device set, neither of which is the owner key.

## 9. Files

| File | What it is |
|---|---|
| `src/lib/dynamicSession.ts` | Gains `choosePassportIdentity` and `dynamicUserKey`. The choice lives in the module that imports nothing, because `App.tsx` asks it on every render. |
| `src/identity/custodyContractSession.ts` | The stage machine, the setup copy, the name store (`passport-account-custody-name:v1`), and the recovery checks. Pure; 100 % covered. |
| `src/identity/custodyContractSend.ts` | The send plan, the deposit-circuit choice, the approval and refusal copy, and the balance read off the mirror. Pure; 100 % covered. |
| `src/screens/DynamicPassport.tsx` | The whole path, as one screen with its own state. Lazily loaded. |
| `src/lib/dynamicWalk.ts` | A stand-in sign-in for the mocked walk, with a real secp256k1 signer. Deleted from any build that does not set `VITE_DYNAMIC_WALK`. |
| `e2e/dynamic-only.spec.ts` | The mocked walk: the welcome path, the recovery offer, and the one-sentence refusal. |

## 10. What it costs a build that has none of this

Measured 2026/09/16, production build, flag unset, against `feat/account-custody-module`:

| | Entry chunk | Entry, gzipped | All JS | Chunks |
|---|---|---|---|---|
| Before | 879,691 B | 241,352 B | 3,496,631 B | 45 |
| After, flag unset | 899,632 B | 246,205 B | 3,553,933 B | 46 |
| **Delta** | **+19,941 B** | **+4,853 B** | **+57,302 B** | **+1** |

The new chunk is `DynamicPassport` (37,130 B) and it is **never fetched** with the flag
unset: `choosePassportIdentity` answers `'none'` for a `disabled` session, the branch is
false, and React never asks for it. `src/lib/localWallet.ts` stays out of the entry chunk,
which is the reason the screen is `lazy` rather than imported — `custodyContractClient.ts`
imports the wallet statically, and a static import here would have put its WASM ledger and
chain sync in front of every visitor of every build.

## 11. Two more dashboard settings

Beside the table in §4, a staging environment driving this path also needs:

| Where | Setting | Value |
|---|---|---|
| Security → Account Security → CORS Origins | **Origins** | `http://localhost:5175` is the origin the dev server pins itself to, and it is the one a local flag-set build must be served on. A build at any other port never leaves `loading`. |
| Embedded Wallets → Security | **Raw signing** | The path is `primaryWallet.connector.signRawMessage`, not `wallet.signMessage`. Only Dynamic's own embedded connector exposes it; an externally connected wallet is refused with a sentence. |
