# Dynamic in Passport — the build-out to v2.0

**Date:** 2026/09/16
**Where this comes from:** the check-in of 2026/09/16 (Hector, Karmel, Nicolas). Hector's two expectations, in substance: (1) Dynamic — Google, Discord, and the rest — is the **first** way into a Passport, because account recovery is what matters most for Charles and only Dynamic gives it; (2) **every transaction is signed through Dynamic's infrastructure**, not the passkey secret made on the device. Stage one integrate, stage two make Dynamic the first option; staging test on 2026/09/17 after a round of local tests; this is v2.0.
**Companions:** `dynamic-integration.md` (stage 1 as built), `dynamic-evm-capability-audit.md` (the signing seam).

---

## 1. Where we are after PR #54

- Stage 1 (social sign-in, embedded EVM wallet, identity row) is carried onto `main` after v1.1, flag off in every build, all gates green.
- A Dynamic session is **not yet a way into a Passport**. The passkey on the device is still the only key behind every account-contract call, and a Dynamic sign-in on a new device recovers nothing. That is the gap both of Hector's expectations point at, and it is not a screen: it is which key the account contract will accept.

## 2. What was established today, with evidence

| Question | Answer | Evidence |
|---|---|---|
| Can the demo compile the account custody contract? | **Yes.** `compact compile +0.34.0 --feature-zkir-v3` builds `contract/contracts/account.compact` (old repo `main`): 30 circuits, prover and verifier keys for every `_with_k256` and `_with_jubjub` export, IR version 3.0. The 2026/09/04 "unbound identifier" finding was the missing feature flag. | scratchpad compile, 2026/09/16 |
| Does Dynamic expose raw signing to the app? | **Yes.** `signRawMessage({ accountAddress, context, message, password })` on the EVM WaaS connector, in the installed SDK typings. It signs a 32-byte digest as given — the shape the k256 arm's envelope 0 needs (`SHA-256(challenge)`). | `node_modules/@dynamic-labs/wallet-connector-core`, `@dynamic-labs/waas-evm` |
| Does Dynamic hand the app the private key, or any deterministic key-bound material? | **No.** `exportPrivateKey` and `exportClientKeyshares` both return `void` and render into a cross-origin iframe the app cannot read; the `IDynamicWaasConnector` surface has no HMAC, derive, or session-key method; Delegated Access (enterprise) issues a server-side share and still signs with randomised DKLs23. | SDK typings and source, Dynamic docs (import-export, delegated-access) |
| Are Dynamic's MPC signatures deterministic (same key, same digest, same signature)? | **No.** DKLs23 (eprint 2023/765, Protocol 3.1, signing step 5) has every party sample a fresh instance key per signature; the docs name DKLs23 for EVM and nothing in Dynamic's stack applies RFC 6979. The client share's rounds run in Dynamic's cross-origin iframe (`browser-wallet-client` → `requestChannel.request('signRawMessage')`), so nothing on our side can seed them. An empirical run was attempted on the sandbox environment; a user created through an external-wallet login gets no embedded wallet there, so the protocol reading stands as the answer. | research 2026/09/16 evening (docs, paper, SDK source) |
| What does `signRawMessage` return? | `0x` + 65 bytes, r‖s‖v; the input is a 64-hex digest without `0x`, signed as supplied (enforced at 64 characters). Low-s normalisation not established — the k256 arm accepts either form. | `waas-evm/DynamicWaasEVMConnector.js`, `waasCore.esm.js`, raw-signing doc |
| Is the embedded key the same on a second device after social-login recovery? | **Yes.** The encrypted user share is delivered to the new device; reshares keep the address. | Dynamic docs, recovery and glossary |
| Can stagenet prove ZKIR v3 circuits? | **Yes — proven the same night** (see §6). Stagenet node 2.0.0 verified proofs from the droplet's `proof-server:9.0.0-rc.6`; the 1AM gateway (`ledger9-zkir2-dispatch`) and the in-browser prover (zkir-v2) still cannot make them, so account custody calls go to the droplet's server by name. | indexer: txs 15ba523c… (block 490985), e961946c… (block 490999) |

## 3. The two ways to Hector's expectations

### Path B — the account contract accepts the Dynamic key (what Hector described)

Every call to the account contract is authorised by an ECDSA-secp256k1 signature the Dynamic MPC wallet makes over `SHA-256(challenge)`, verified in-circuit by the k256 arm. Recovery is the key itself: the same MPC key on any device after a social login.

What it takes, in order, each a PR on passport-demo:

1. **Prove one k256 circuit on stagenet.** Deploy the account custody contract from a script with a software secp256k1 key and call `activate_initial_device_with_k256` through the droplet's proof server. This is the gate for everything below; if 9.0.0-rc.6 will not prove v3 IR, the ask goes to Webisoft (1AM prover) and to the Foundation (proof-server release), and the date moves with it. **One day.**
2. **Client custody layer for the gated ABI.** `accountCustody.ts` today calls the prototype's circuits with a hash-preimage device secret. The reference ABI is `(…args, pk, use_counter, sig, envelope)` on every gated circuit, with per-arm exports, challenge derivation circuits, and the `held_coin` witness model. New module beside the old one, chosen per account like `account`/`account-v1` are today. **Three to five days.**
3. **Dynamic as a device.** Enrolment derives the device entry from the Dynamic EVM public key (envelope 0); each call computes the challenge, asks `signRawMessage` for the digest, submits. Fresh randomness per signature is fine here — the contract checks validity and advances the use counter. **Two days**, in parallel with 2.
4. **Migration of existing Passports.** The upgrade machine (`accountUpgrade.ts`: drain, deploy, re-point the name, refund; check the chain before every step) already moves accounts between builds. Extend it to deploy the account custody contract with the passkey enrolled as a JubJub device and, once signed in, the Dynamic key as a k256 device — cross-arm enrolment is first-class in the contract. **Two to three days.**
5. **Dynamic first on Welcome**, "restorable on another device" copy, passkey second. **One day.**
6. Sponsor: the funder and gift desk open recipients by build; a third build joins `accountModuleFor`. **One day.**

Roughly **two weeks** if step 1 passes on day one. It is the design that makes Hector's sentence literally true.

### Path A — Dynamic recovers the passkey-style secret (no contract change) — **closed 2026/09/16**

This would have been the `experiment/metamask-device` shape: a deterministic signature over a fixed message → HKDF → the same device secret on every device → `add_device` on the existing contract. It needs a deterministic signature or a derived-secret API, and Dynamic has neither (table above). The only no-contract alternative left is escrow of the secret behind the Dynamic identity on our backend, which is custody and is not proposed.

## 4. The one question that was left — answered

**ZKIR v3 proving on stagenet: yes.** Established the same night; the evidence and the three lessons are in §6. The 1AM prover and the in-browser prover remain ZKIR v2, so a Passport that signs with Dynamic proves through the droplet's proof server by name (a `/prover-v3` route) until they catch up.

## 5. Recommendation

Path B is v2.0, and the sentence to say to Hector is that it is about two weeks after the proving test passes, not tomorrow. Tomorrow's staging session can still show stage 1 (social sign-in, the identity row) from a release of `main` once PR #54 is reviewed, with the honest label that it is sign-in, not yet recovery. The proving test is the first task of the morning, and if the droplet's proof server will not prove v3 IR, the ask goes to Webisoft (1AM prover) and to the Foundation (proof-server release) the same day.

Whatever the route: PRs on passport-demo, review, `main`, a release, staging, Hector's go, production — the same path v1.0 and v1.1 took.

---

## 6. Addendum, 2026/09/16 night — the gate passed, and the scope for v2.0 is narrowed

**The gate passed.** Stagenet (node 2.0.0-d9729c13) verifies ZKIR v3 proofs from the droplet's `proof-server:9.0.0-rc.6`. The account custody contract was deployed in three sponsored waves (final wave `dfbbd244…`, block 490978); `activate_initial_device_with_k256` landed (`15ba523c…`, block 490985) and `append_inbox_with_k256` landed (`e961946c…`, block 490999), all SUCCESS, all fees from the sponsor's balance-only route, from a wallet with no funds. The ledger showed `device_count 1` and `auth_nonce 0 → 1`. No image change on the droplet is needed. Three lessons: artefacts must be compiled against the runtime the client bundles; the 30-circuit roster needs a deploy plus two maintenance updates before the account is usable; and the hash the chain knows for a sponsored transaction is the sponsor's `txHash`, not midnight-js's 33-byte identifier.

**The scope for v2.0, set by the user the same night:** a **Dynamic-only Passport**. Sign in with Google or Discord through Dynamic, no passkey; Passport deploys an account on the account custody contract with the Dynamic key as its only device; the sponsor pays in the opening balance; send shielded tokens and NIGHT to a name as today, every call authorised by a Dynamic signature over the contract's challenge (obtained silently from the embedded wallet after Passport's own consent sheet). **No migration of existing passkey Passports** in this version; the two kinds coexist and can pay each other. Recovery on a new device is **by name**: sign in with Dynamic, type the `.night` name, Passport resolves the account and checks the Dynamic key is its device. "Dynamic first on Welcome" with an address index, and the one-transaction send shape for these accounts, are checked in week two and not promised.

**Estimate for that scope: two weeks**, on four assumptions: proving for these accounts goes to the droplet's proof server by name (a Caddy route, not the 1AM gateway or the browser prover); no migration; recovery by name; sends use the two-step path first.

**PR sequence:** (1) the account custody build, module loader, HTTP-only proving route; (2) a private coin store that survives reloads; (3) the account custody client module — deploy in waves, activate with the Dynamic key, deposit, withdraw; (4) the sponsor recognises the third build for the opening balance and gifts; (5) Welcome and Home: the Dynamic path end to end, and recovery by name; (6) live walks on staging with a Dynamic login, then the release. Design and skeleton for (3): PR #55.

**What the screen does, as built (2026/09/17).** The Dynamic-only screen now
covers the whole of the money half:

- **Sets a Passport up** in three sponsored steps, resumes one it did not
  finish, and claims a `.night` name for it.
- **Shows what it holds** — the account's NIGHT off its own mirror, and every
  token it has been paid, read out of the coin store after the account's own
  list of deliveries has been walked (on opening and on every refresh). A coin
  whose position in the commitment tree cannot be established is shown as
  arriving, never as balance.
- **Sends NIGHT**, in two legs, to a Passport on any of the three builds — a
  prototype account or another Dynamic Passport, the deposit chosen by reading
  what the recipient's account is built from.
- **Sends mUSD**, in three legs: withdrawn for exactly the amount to the
  Passport's own receiving address, identified there by its nonce, then
  deposited into the recipient with a description sealed to their key where they
  hold one of these accounts. A payment that stops between legs is written down
  and offered again on the next open; one that cannot be delivered goes back
  where it came from, and the screen says where the money is.
- **Comes back by name** on a second device, checking the account's device set
  before anything is restored.

What is still not deployed, and says so in one sentence rather than failing
late: `POST /prove-account-custody` on the balancer, which every account custody
transaction goes through.

**The contract is consumed, never copied (2026/09/17).** Everything above reads
against the account custody contract as Nicolas provides it. It is not modified,
copied, forked, renamed, or versioned here: `scripts/account-custody-contract.lock.json`
pins the revision, the sync script compiles that revision into the tracked
`account-custody` module, and any blocker goes to Nicolas rather than into a local
change. See `docs/demo/account-custody-contract.md`.
