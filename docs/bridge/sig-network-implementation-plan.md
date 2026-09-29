# sig.network → ACC bridge: implementation plan

Companion to [`sig-network-integration.md`](./sig-network-integration.md) (the
what and why). This is the phased build. Each phase is one reviewable PR with a
clear boundary, a demo, and acceptance criteria. No ACC contract change is
needed, so every phase is TypeScript in the PWA. sig.network's MPC and relayer
are already deployed on stagenet, so we build no bridge infrastructure.

## End state

A Passport user taps **Add funds → from Ethereum**, sends USDC to a shown Sepolia
address from their own Ethereum wallet, and watches it arrive as a USDC balance
in their ACC. The claim runs from Passport's internal wallet; the deposit into
the ACC is fee-sponsored as usual.

## Phase map

| # | PR | Boundary | Depends on |
|---|-----|----------|------------|
| 1 | Config, deps, USDC colour | A USDC coin renders in the app | — |
| 2 | Deposit + claim → internal wallet | vault-USDC lands in the internal wallet | 1 |
| 3 | ACC hand-off | claimed coin lands in the ACC | 2 |
| 4 | "Add from Ethereum" UX | the full user flow | 3 |
| 5 | Hardening | resume, failure, persistence | 4 |

Phases 2 and 3 may be merged into one "mechanism" PR if the team prefers; the
plan keeps them split for reviewability (two boundaries: coin-in-wallet, then
coin-in-ACC).

---

## Phase 1 — Config, deps, USDC colour

**Goal.** Land the dependency and configuration surface on its own, and make a
USDC-coloured coin render in the UI, with no bridge logic yet.

**Scope.**
- Add the sig.network client packages (`@sig-net/midnight`, the vault contract
  package) and pin the matched-set versions to the ones the PWA already uses
  (ledger-9 / midnight-js-5-beta.6 line). Resolve any version skew against
  `examples/passport-demo`'s existing pins.
- Add config: vault contract address, signet singleton address, MPC public keys,
  Sepolia USDC address, stagenet endpoints — as env vars with the demo's
  failover-list convention.
- Add `USDC_COLOUR_HEX` and one `KNOWN_COLOURS` entry in
  `examples/passport-demo/src/lib/colour.ts`. The colour is
  `rawTokenType(vaultTokenDomainSeparator(usdcAddress), vaultAddress)` — compute
  it once and pin it as a constant with a comment showing the derivation.

**Files (indicative).** `examples/passport-demo/package.json`,
`src/lib/colour.ts`, a new `src/bridge/config.ts`, `.env.example`.

**Acceptance.** `npm run build` clean; a coin of the USDC colour, deposited by a
throwaway script, renders on Home/Assets with the `$` mark and `USDC` symbol.

**Review size.** Small; mostly additive plumbing. Dependency review is the main
cost, which is why it is isolated.

---

## Phase 2 — Deposit + claim into the internal wallet (mechanism core)

**Goal.** From the internal wallet, run the sig.network deposit and claim so a
vault-USDC coin lands in that wallet. Driven from a dev/debug entry point, no
polished UI.

**Scope.**
- Resolve the internal wallet's sig.network deposit address (the address
  sig.network derives for that wallet) and expose it.
- Build the deposit request (`startDeposit`/`deposit`) and let the deployed MPC +
  relayer execute the Sepolia transfer.
- Poll for the attestation and run the claim (`completeDeposit`/`claim`) with
  `recipient = none`, minting vault-USDC to the internal wallet's coin public key.
- A typed `bridge` module wrapping the sig.network client (deposit-address,
  initiate, status, claim) behind an interface the later UI consumes.
- A dev entry point (hidden command or debug screen) to run it end to end for one
  test user. Proving on the remote proof server.

**Files (indicative).** `src/bridge/signetClient.ts`, `src/bridge/claim.ts`,
`src/bridge/types.ts`, a dev trigger under an existing debug surface.

**Acceptance.** With USDC pre-sent to the deposit address on Sepolia, the dev
trigger moves it to the vault and the internal wallet ends holding a vault-USDC
coin (verifiable from the wallet state / indexer). Recorded with real tx hashes.

**Review size.** Largest PR. Keep it logic-only behind a dev flag so reviewers
judge the mechanism, not UI.

---

## Phase 3 — ACC hand-off

**Goal.** Take the claimed coin and register it in the user's ACC, so it becomes
a spendable ACC balance.

**Scope.**
- Call the ACC `deposit_shielded({ color, nonce, value })` spending the claimed
  coin as the balancing input, reusing the balancer's deposit engine pattern
  (`examples/passport-balancer/src/account.ts:1385` as reference).
- Fee-sponsor via the balancer's `/balance-only` path (confirm it accepts the
  claim/deposit call-tree transaction).
- Guard the target is a real ACC (`device_count >= 1 &&
  recovery_shares.size() === 3`) before depositing.
- Chain it after the Phase 2 claim so the dev trigger now runs the whole
  mechanism.

**Files (indicative).** `src/bridge/depositToAcc.ts`, wiring in the bridge module;
reuse of existing `deposit_shielded` call helpers under `src/identity/`.

**Acceptance.** The dev trigger runs Ethereum-USDC → internal wallet → ACC end to
end; the ACC balance shows USDC. Recorded with tx hashes.

**Review size.** Medium; a focused leg on top of a working claim.

---

## Phase 4 — "Add from Ethereum" UX

**Goal.** The real user-facing flow, on top of the working mechanism.

**Scope.**
- An "Add funds → from Ethereum" screen: the deposit address with QR, the amount
  guidance, and progress states (awaiting USDC → relaying → claiming → depositing
  → landed).
- Passport builds the user's funding transfer as a ready-to-authorize request.
  **Decision:** minimal (show address + an EIP-681 QR the user scans in their own
  wallet) vs assisted (connect an Ethereum wallet via WalletConnect/injected and
  prompt `transfer(depositAddress, amount)` for approval). Default to minimal for
  the demo; assisted can follow.
- Wire `assetsOnTheWay.ts` + `balanceWatch.ts` so USDC shows "On the way" then
  lands, reusing the activation-grant machinery.

**Files (indicative).** a new screen under `src/screens/`, `src/screens/`
add-funds entry, `src/lib/balanceWatch.ts` / `assetsOnTheWay.ts` wiring.

**Acceptance.** A user completes the whole flow from the UI on stagenet: scans/
sends on Sepolia, sees "On the way", then a USDC balance in the ACC.

**Review size.** Medium; pure front-end.

---

## Phase 5 — Hardening

**Goal.** Make it survive real use.

**Scope.**
- **Resume:** a claim in flight when the app closes is picked up on reopen (the
  sig.network request id is deterministic and pollable; persist enough to resume).
- **Failure states:** the Sepolia transfer failed (attested as failure) — surface
  it, nothing to deposit; a stuck attestation past the timeout window.
- **Status persistence + observability:** per-deposit status keyed by request id;
  validation-log entries with real tx hashes.

**Files (indicative).** `src/bridge/resume.ts`, status persistence in the bridge
module, `docs/demo/validation-log.md` entries.

**Acceptance.** Kill the app mid-flow and reopen — it resumes and lands. A failed
Sepolia transfer shows a clear terminal state, not a hang.

**Review size.** Medium; edge-case focused.

---

## Open decisions

1. **Merge phases 2+3** into one mechanism PR, or keep split (default: split).
2. **Phase 4 funding UX:** minimal QR vs assisted Ethereum-wallet connect
   (default: minimal for the demo).
