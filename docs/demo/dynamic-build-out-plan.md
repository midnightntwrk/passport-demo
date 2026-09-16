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
| Can the demo compile the k1-arm reference account contract? | **Yes.** `compact compile +0.34.0 --feature-zkir-v3` builds `contract/contracts/account.compact` (old repo `main`): 30 circuits, prover and verifier keys for every `_with_k256` and `_with_jubjub` export, IR version 3.0. The 2026/09/04 "unbound identifier" finding was the missing feature flag. | scratchpad compile, 2026/09/16 |
| Does Dynamic expose raw signing to the app? | **Yes.** `signRawMessage({ accountAddress, context, message, password })` on the EVM WaaS connector, in the installed SDK typings. It signs a 32-byte digest as given — the shape the k256 arm's envelope 0 needs (`SHA-256(challenge)`). | `node_modules/@dynamic-labs/wallet-connector-core`, `@dynamic-labs/waas-evm` |
| Does Dynamic hand the app the private key, or any deterministic key-bound material? | **No.** `exportPrivateKey` and `exportClientKeyshares` both return `void` and render into a cross-origin iframe the app cannot read; the `IDynamicWaasConnector` surface has no HMAC, derive, or session-key method; Delegated Access (enterprise) issues a server-side share and still signs with randomised DKLs23. | SDK typings and source, Dynamic docs (import-export, delegated-access) |
| Are Dynamic's MPC signatures deterministic (same key, same digest, same signature)? | **No.** DKLs23 (eprint 2023/765, Protocol 3.1, signing step 5) has every party sample a fresh instance key per signature; the docs name DKLs23 for EVM and nothing in Dynamic's stack applies RFC 6979. The client share's rounds run in Dynamic's cross-origin iframe (`browser-wallet-client` → `requestChannel.request('signRawMessage')`), so nothing on our side can seed them. An empirical run was attempted on the sandbox environment; a user created through an external-wallet login gets no embedded wallet there, so the protocol reading stands as the answer. | research 2026/09/16 evening (docs, paper, SDK source) |
| What does `signRawMessage` return? | `0x` + 65 bytes, r‖s‖v; the input is a 64-hex digest without `0x`, signed as supplied (enforced at 64 characters). Low-s normalisation not established — the k256 arm accepts either form. | `waas-evm/DynamicWaasEVMConnector.js`, `waasCore.esm.js`, raw-signing doc |
| Is the embedded key the same on a second device after social-login recovery? | **Yes.** The encrypted user share is delivered to the new device; reshares keep the address. | Dynamic docs, recovery and glossary |
| Can stagenet prove ZKIR v3 circuits? | **Not proven.** Compiled IR is v3.0. The 1AM prover is `ledger9-zkir2-dispatch`; the droplet runs `proof-server:9.0.0-rc.6`; the in-browser prover is `zkir-v2` only. Ledger 9.1.0.0-rc.4 (2026/08/11) carries ZKIR v3 as an *experimental* prove path; "move zkir-v3 out of experimental" landed in 10.1.0.0-alpha.1 (2026/09/14). | prover `/health`, droplet `docker inspect`, ledger release notes |

## 3. The two ways to Hector's expectations

### Path B — the account contract accepts the Dynamic key (what Hector described)

Every call to the account contract is authorised by an ECDSA-secp256k1 signature the Dynamic MPC wallet makes over `SHA-256(challenge)`, verified in-circuit by the k256 arm. Recovery is the key itself: the same MPC key on any device after a social login.

What it takes, in order, each a PR on passport-demo:

1. **Prove one k256 circuit on stagenet.** Deploy the reference contract from a script with a software secp256k1 key and call `activate_initial_device_with_k256` through the droplet's proof server. This is the gate for everything below; if 9.0.0-rc.6 will not prove v3 IR, the ask goes to Webisoft (1AM prover) and to the Foundation (proof-server release), and the date moves with it. **One day.**
2. **Client custody layer for the gated ABI.** `accountCustody.ts` today calls the prototype's circuits with a hash-preimage device secret. The reference ABI is `(…args, pk, use_counter, sig, envelope)` on every gated circuit, with per-arm exports, challenge derivation circuits, and the `held_coin` witness model. New module beside the old one, chosen per account like `account`/`account-v1` are today. **Three to five days.**
3. **Dynamic as a device.** Enrolment derives the device entry from the Dynamic EVM public key (envelope 0); each call computes the challenge, asks `signRawMessage` for the digest, submits. Fresh randomness per signature is fine here — the contract checks validity and advances the use counter. **Two days**, in parallel with 2.
4. **Migration of existing Passports.** The upgrade machine (`accountUpgrade.ts`: drain, deploy, re-point the name, refund; check the chain before every step) already moves accounts between builds. Extend it to deploy the reference contract with the passkey enrolled as a JubJub device and, once signed in, the Dynamic key as a k256 device — cross-arm enrolment is first-class in the contract. **Two to three days.**
5. **Dynamic first on Welcome**, "restorable on another device" copy, passkey second. **One day.**
6. Sponsor: the funder and gift desk open recipients by build; a third build joins `accountModuleFor`. **One day.**

Roughly **two weeks** if step 1 passes on day one. It is the design that makes Hector's sentence literally true.

### Path A — Dynamic recovers the passkey-style secret (no contract change) — **closed 2026/09/16**

This would have been the `experiment/metamask-device` shape: a deterministic signature over a fixed message → HKDF → the same device secret on every device → `add_device` on the existing contract. It needs a deterministic signature or a derived-secret API, and Dynamic has neither (table above). The only no-contract alternative left is escrow of the secret behind the Dynamic identity on our backend, which is custody and is not proposed.

## 4. The one question left, and how it is answered

**ZKIR v3 proving on stagenet** — step B1. Compiled IR is v3.0. Images available on Docker Hub as of 2026/09/16: `proof-server:9.0.0-rc.6` (what the droplet runs, 2026/08/10), `9.0.0-rc.7` (2026/09/08), and `10.0.0-alpha.1` (2026/09/16; the ledger 10.1 alpha is where "zkir-v3 out of experimental" landed). The test: deploy the reference contract on stagenet from a script with a software secp256k1 key and prove `activate_initial_device_with_k256` through the droplet's proof server, first on rc.6, then on rc.7 or 10.0.0-alpha.1 if rc.6 refuses. The 1AM prover (`ledger9-zkir2-dispatch`) and the in-browser prover (zkir-v2) will not prove it; a Passport that signs with Dynamic proves through the droplet's server until they do.

## 5. Recommendation

Path B is v2.0, and the sentence to say to Hector is that it is about two weeks after the proving test passes, not tomorrow. Tomorrow's staging session can still show stage 1 (social sign-in, the identity row) from a release of `main` once PR #54 is reviewed, with the honest label that it is sign-in, not yet recovery. The proving test is the first task of the morning, and if the droplet's proof server will not prove v3 IR, the ask goes to Webisoft (1AM prover) and to the Foundation (proof-server release) the same day.

Whatever the route: PRs on passport-demo, review, `main`, a release, staging, Hector's go, production — the same path v1.0 and v1.1 took.
