# The account custody layer — design

2026/09/16. Implements step 2 of path B in `docs/demo/dynamic-build-out-plan.md`: the
client-side layer that lets the Passport demo talk to the account custody reference account
contract, the contract that can accept a Dynamic embedded EVM key as a device.

This is a design plus a scaffold. `src/identity/custodyContractSigning.ts` and its drill are in this
branch; nothing is wired into the app, `App.tsx` is untouched, and no existing behaviour
changes.

## 0. What is already true

Verified on 2026/09/16 against the compiled reference contract (`compactc 0.34.0
--feature-zkir-v3`, 30 circuits, `checkRuntimeVersion('0.19.0')`):

- The compiled `contract/index.js` **loads cleanly under the demo's
  `@midnight-ntwrk/compact-runtime` 0.19.0-rc.0**, and that runtime already declares
  `Secp256k1Point`, `CompactTypeSecp256k1Point`, and the `secp256k1*` built-ins. The
  reference harness was built against 0.18.0-rc.1 and midnight-js 5.0.0-beta.4; the demo
  is on 0.19.0-rc.0 and 5.0.0-beta.7, and the pure-circuit surface is unaffected.
- `envelope_digest(0, c)` is exactly `SHA-256(c)`, and `envelope_digest(1, c)` is exactly
  `SHA-256("midnight_signed_message:32:" || c)`, checked byte for byte. Those two values
  are the fixtures in `src/identity/custodyContractSigning.test.ts`, so the local digest is held
  against the contract's own circuit rather than against itself.
- Dynamic's `signRawMessage({ accountAddress, message })` signs a 64-hex digest verbatim
  and returns `0x` + `r‖s‖v`. That is envelope 0 and nothing else.

Proven the same night, 2026/09/16: **stagenet verifies ZKIR v3 proofs** made by the
droplet's `proof-server:9.0.0-rc.6`. The account custody contract was deployed in three
sponsored waves; `activate_initial_device_with_k256` landed at block 490985 (tx
`15ba523c…`) and `append_inbox_with_k256` at block 490999 (tx `e961946c…`), both
SUCCESS, with `device_count 1` and `auth_nonce 0 → 1` on the ledger. What remains true
is that the in-browser prover (`src/lib/wasmProver.ts`, `@midnight-ntwrk/zkir-v2` 2.1.0)
is v2 only and the 1AM gateway is `ledger9-zkir2-dispatch`, so account custody calls prove through the
droplet's server by name. See §1.4.

## 1. A third account module, `account-custody`

### 1.1 The name and the choice

`PassportContractName` (`src/identity/contractRuntime.ts:204`) widens to
`'account' | 'account-v1' | 'account-custody' | 'midnames'`.

`accountModuleFor` (`src/identity/accountCustody.ts:981`) becomes three-way, and the
discriminator stays what it is today — **the deployed circuit set, read off the chain**,
never a local record. `readAccountOperations` already returns the names; the account custody build
carries `withdraw_shielded_with_k256`, which neither prototype build has, so:

```
operations contains 'withdraw_shielded_with_k256'   → 'account-custody'
else operations contains 'transfer_shielded_to_account' → 'account'
else                                                 → 'account-v1'
```

Ask the custody question first. The `accountModules` cache, the `whenUnreadable` refusal, and
`resetAccountModuleChoice()` are unchanged.

### 1.2 Loading the module

`loadContractModule` (`contractRuntime.ts:243`) gets a fourth **literal** arm:
`import('../../contracts/stagenet/account-custody/contract/index.js')`. Literal because a
computed specifier gives the bundler nothing to follow, and because a module reached by a
different specifier can bind the *other* installed `compact-runtime` — two copies reject
each other's `ContractState` with "has unexpected type", reproduced 2026/08/24.

### 1.3 Artefacts

`account-custody` gets **its own asset tree**: `ASSET_CONTRACT`
(`contractRuntime.ts:215`) gains `'account-custody': 'account-custody'`. It must not share
`/zk/account` the way `account-v1` does — that sharing is sound only because every v1 key
file is byte-identical to the account one, and this is a different contract with
different circuit names. The compiled-contract label changes with it, to
`'passport-account-custody'`: the label is the namespace `FetchZkConfigProvider` composes
artefact paths from.

`scripts/prepare-zk-assets.mjs:100` gains `{ name: 'account-custody', assets: true }`, staging
`compiler/`, `keys/`, and `zkir/` into `public/zk/account-custody/`. Thirty circuits is 60 key
files and 60 IR files; the twelve-circuit `account` tree is already ~100 MB, so **measure
the staged size before committing to a Vercel deploy** — this may be the change that
makes `.vercelignore` and the artefact origin (`PASSPORT_ZK_ORIGIN`) load-bearing rather
than convenient.

The build-id query (`src/lib/buildId.ts`, `buildIdFetch`) applies unchanged, and must:
the 2026/09/14 incident was a year-long immutable cache on an unhashed manifest, and a
new tree is exactly when a returning browser holds a stale one.

### 1.4 Proving — the HTTP provider only

ZKIR v3 cannot be proved in the browser and cannot be proved by the 1AM gateway. Every
`account-custody` call therefore goes to an HTTP proof provider running a v3-capable image.

`createContractProofProvider` (`contractRuntime.ts:1178`) branches only on
`wallet.network.provingServerUrls` (from `VITE_MIDNIGHT_PROVING_URL`, read in
`src/lib/networks.ts`): zero URLs falls back to the WASM worker. For a custody account that
fallback is wrong, and **silently** wrong — the worker fails with a key-format error, not
with "this IR is not supported". So the branch becomes module-aware: with
`contract === 'account-custody'` and no proving URL configured, refuse by name.

Two configuration consequences:

1. `VITE_MIDNIGHT_PROVING_URL` must point at the droplet's proof server directly, on an
   image that proves v3 (`9.0.0-rc.6` is unproven; `9.0.0-rc.7` and `10.0.0-alpha.1`
   exist). It cannot point at the 1AM gateway for account custody traffic.
2. Where the variable is a comma-separated failover list, the 1AM entry must not be in
   it for account custody — `failoverProvingProvider` would try it and fail per request.

### 1.5 The deploy ceiling

Thirteen circuits deploy; fourteen do not (`1010: Transaction would exhaust the block
limits`, `docs/demo/one-tx-transfer-drill.md` §3b). The account custody contract has thirty. The
reference harness deploys **in waves** — the initial device's arm first, the other arm's
verifier keys by a maintenance update afterwards — and the demo must adopt the same
shape. A Passport's deploy therefore stops being one sponsored transaction. After the
proving test, this is the largest unknown in the plan.

## 2. The device model

### 2.1 The passkey becomes a JubJub device

Today's ladder ends at 32 bytes, not at a scalar. WebAuthn PRF → HKDF-SHA256 (salt
`midnight-passport:wallet-seed:v1`, info `…:v1:<appId>:passport-contract-v1`) → `rootSecret`
(`demo-backend/src/passkey.ts:587`), then `derivePassportContractSecrets`
(`src/identity/passportContract.ts:151`) does `sha256(label padded to 32 || rootSecret)`
for labels `midnight.passport.dev` and `midnight.passport.rec`.

A third label — `midnight.passport.jj` — joins those two, and its 32 bytes are reduced
into `[1, r_J)`. **Reject-and-retry with a counter byte, not `mod r_J`**: a plain
reduction is biased, and the bias lands in the low bits of a signing key. Nothing in this
app performs a curve-order reduction today; this is a new step and it belongs beside the
existing labels, where the domain separation is already written down.

### 2.2 The Dynamic key becomes a k256 device, envelope 0

No derivation at all. The key exists inside Dynamic's MPC, the app never sees it, and
envelope 0 is the only shape `signRawMessage` can produce. The public point is recovered
**once, at enrolment**, from a signature over a known digest — which is why
`parseEvmSignature` in the scaffold keeps the recovery byte and normalises 27/28 and 0/1
to the same two values. Deriving it per call would mean a signature before the signature
that matters.

### 2.3 One gated call

```
1. read the ledger              → auth_nonce, device_epoch            (AUTH-2, AUTH-3)
2. resolve the use counter      → roster value, verified against devices.member(entry),
                                  else rescan from 0                  (AUTH-9, S11)
3. build the challenge          → the contract's own exported pure circuit
4. hash it                      → envelopeDigest(envelope, challenge)
5. sign                         → JubJub: local, with the grind loop
                                  k256:   signRawMessage, 64-hex in, 0x r‖s‖v out
6. submit                       → callTx[`<op>_with_<arm>`](…args, ...authArgs(auth))
```

Steps 3, 4, and 6 are what `src/identity/custodyContractSigning.ts` already does. Steps 1, 2, and 5's
JubJub half need a provider and are the next PR.

Two wrinkles worth writing down. The two shielded challenges **bind the `held_coin`
witness value** (AUTH-10), so the coin is chosen before the signature, not during
balancing — the approver signs over the exact note the spend consumes. And randomised
signatures are fine: the contract checks validity, consumes the entry, and advances
`auth_nonce`, so Dynamic's fresh instance key per signature costs nothing here.

## 3. Private state: the coin store

The reference keeps held coins **out of public state**. `witness held_coin(color) ->
QualifiedShieldedCoinInfo` is backed by `CoinStorePrivateState = { encSecretKeyHex,
coins: Record<colourHex, { nonceHex, colorHex, value, mtIndex }> }`, all strings so every
private-state provider serialises them losslessly.

The demo today does the opposite, in three ways that each cost work:

1. **The prototype's qualified coins live in public ledger state** (`Ledger.coins`), and
   the client projection drops what the witness needs: `AccountState.shieldedCoins` is
   colour → value. Nonces survive only wallet-side, in `walletShieldedNotes()` reading
   `facade.state().shielded.availableCoins`, and `mt_index` is dropped outright by
   `shieldedCoinFromWalletCoin`. **Nothing in the demo carries `mt_index` today.**
2. **The private-state provider is in-memory with a fresh id per connection**
   (`accountCustody.ts:1275`: `passport-account-<addr8>-<random8>`). A coin store that
   does not survive the connection cannot spend. The account custody path needs a stable
   private-state id per account and a persisted store.
3. `accountWitnesses()` (`passportContract.ts:218`) gains `held_coin` and
   `AccountPrivateState` gains the coin map. The account custody contract declares no other witness —
   `device_secret`, `grant_secret`, and `recovery_secret` all go.

Beside the store sits the inbox: 192-byte InboxEntry v1, X25519 → HKDF-SHA256 (info
`midnight:custody:inbox:v1`) → AES-GCM, entirely client-side. `src/identity/backup.ts` has
no equivalent. **This section is the largest piece of unbudgeted work in the plan**, and
the shielded balance depends on all of it.

## 4. Migration, through `accountUpgrade.ts`

Extend the machine, do not rewrite it. Drain → deploy → re-point → refund → switch, with
a chain check before every step and a write the moment each lands, is exactly the right
shape for a longer sequence. Evidence (2026/09/16, SDK 5.8.0 on disk and Dynamic's docs): `@dynamic-labs/waas-evm/src/DynamicWaasEVMConnector.js` lines 754–777 pass a `hashAuthorization(...).slice(2)` digest (32 bytes, hex, no `0x`) to `signRawMessage` and hand the result straight to viem's `parseSignature`, which requires `0x` + 64 bytes + v; `@dynamic-labs-sdk/client/dist/waasCore.esm.js` line 208 enforces `RAW_MESSAGE_MESSAGE_REQUIRED_LENGTH = 64` and throws at line 483 otherwise; the raw-signing doc page states the SDK adds no prefix and no re-hash. Not yet observed against a live embedded wallet from this code — the first gated call in PR 3 is where that observation is made, and it is the go/no-go for PR 6.
- **The seam is `UpgradeDeps.submitAccount`** (`accountUpgrade.ts:283`, defaulted at
  `:372`). `submitPassportContract` (`passportContract.ts:720`) hardcodes `'account'`
  twice; parameterise it by module. This is the first time a deploy chooses.
- **The constructor changes shape.** `(initial_device_boot, encryption_key)` — a salted
  boot commitment plus an X25519 public key — replaces `[deviceCommitment,
  recoveryCommitment, slot1, slot2, slot3]`. And `kernel.self()` is unavailable in a
  Compact constructor, so the account is **dormant** until
  `activate_initial_device_with_jubjub` runs. Two transactions where there was one, on
  top of the wave deploy of §1.5.
- **The initial device is the passkey.** The boot commitment's domain-separation tag
  fixes which arm's activation circuit can ever open it, and a holder who has not signed
  in to Dynamic still has a passkey. Deploying with Dynamic as the initial device would
  make a Dynamic session a precondition of having a Passport.
- **Dynamic joins afterwards, cross-arm.** `add_device_with_jubjub` carrying
  `enrolmentEntry(pure, dynamicDevice, address, currentEpoch)` — the new device travels as
  its derived entry, so the contract never learns which curve produced it. One sponsored
  transaction, and it can land days after the deploy.
- **A new step, `enrol`,** between `refund` and `switch`: skipped when
  `devices.member(entry)` is already true, which is the same chain-before-act rule as
  every other step.

Cost: the existing 4–6 sponsored transactions become roughly 6–9 per Passport.

## 5. The sponsor

`examples/passport-balancer` learns the third build in three places.

- **`src/accountModule.ts`.** `AccountModuleName` widens. `accountModuleFor` can no
  longer be answered from one boolean — it needs the operations list, so it takes the
  names and returns the three-way answer; `carriesOneTxTransferIn` stays and a sibling
  `carriesK256ArmIn` joins it. Its drill (`test/accountModule.test.ts`) gains the third
  case.
- **`src/account.ts::createAccountFunder` and `src/gift.ts::prepare`.** Each loads a
  third `await import('../contracts-stagenet/managed/account-custody/contract/index.js')` and
  a third `CompiledContract.make('passport-account-custody', …)`, chosen per recipient exactly
  as `account`/`account-v1` are today. The refusing-witness triple becomes a single
  refusing `held_coin`.
- **`contracts-stagenet/managed/account-custody/`** ships; its `keys/` and `zkir/` are
  gitignored, so the README's rsync instruction covers them.

Two things that are not renames. The desks only ever call `deposit_shielded` and
`deposit_unshielded`, and on the account custody contract both are **permissionless** — no device, no
signature, no envelope. That is the good news. But `deposit_shielded(coin, entry)` takes a
192-byte inbox entry sealed to the account's `enc_key`, so the desk must read `enc_key`
off the ledger and encrypt the entry, or the recipient can never discover the coin. And
the droplet's proof server must be v3-capable before the desks can prove anything for a
custody account — the same gate as the client.

## 6. What the two product claims need from this layer

**"Dynamic first on Welcome."** Social sign-in can sit above the passkey only when a
Dynamic session can *reach* a Passport. That needs the custody account deployed with a passkey
device, Dynamic enrolled on it, and — the missing piece — **a lookup from the Dynamic EVM
address to the account address**. There is no such index: `passportContractStore.ts` keys
on `localStorage`, which a new device does not have. Either the `.night` name is the index
(the holder types it), or the demo backend keeps a Dynamic-subject → account-address map.
The second is a backend change and is not in anyone's estimate yet. Until enrolment has
landed, "Continue with Google" opens nothing, so the button order must not change: stage 1
is sign-in, not recovery, and the copy has to say so.

**"Restorable on another device."** The MPC key is the same after social recovery and the
k256 entry is on-chain, so a fresh device needs the account address (above), the current
`device_epoch` and `auth_nonce` (a ledger read), and the private coin store (§3). The
third is the hard one. The inbox is the contract's own answer — walk it from ordinal 0 and
decrypt each entry with the X25519 viewing key — but **the viewing key is itself private**,
and Dynamic exports nothing it could be derived from. Derived from the passkey ladder, it
is unavailable on exactly the device that needs it. This is open, and it decides whether
"restorable" means "can send" or only "can receive".

## 7. PR sequence

Each a pull request on `midnightntwrk/passport-demo`, reviewed, merged to `main`,
released, staged, and only then promoted — the path of the delivery rule.

| # | What | Estimate | Blocked by |
|---|---|---|---|
| 1 | **This PR.** Design plus `src/identity/custodyContractSigning.ts` and its drill; nothing wired. | done | — |
| 2 | Prove one k256 circuit on stagenet from a script, through the droplet's proof server. | 1 day | — |
| 3 | **Landed 2026/09/16 — see §7a.** `account-custody` as a module: `PassportContractName`, the literal import arm, `ASSET_CONTRACT`, `prepare-zk-assets.mjs`, the three-way `accountModuleFor`, the module-aware proof-provider refusal, and an `accountModule.test.ts` clone. | 2 days | 2 |
| 4 | The coin store: `held_coin`, a durable private-state id, `mt_index` carried end to end, and the inbox reader. | 4–5 days | 3 |
| 5 | The JubJub device: the third HKDF label, the rejection-sampled scalar, the grind loop, and `callCustodyCircuit` — read, resolve, challenge, sign, submit. | 3 days | 3 |
| 6 | Dynamic as a k256 device: point recovery at enrolment, `dynamicK256Signer` wired behind the lazy boundary, `add_device_with_jubjub`. | 2 days | 5 |
| 7 | Wave deploy and the dormant-account activation in `submitPassportContract`. | 2 days | 3 |
| 8 | Migration: `submitAccount` parameterised, the `enrol` step, the drills. | 2–3 days | 7, 6 |
| 9 | Sponsor: the third build in `accountModule.ts`, the funder, and the gift desk, plus the sealed inbox entry on deposit. | 2 days | 3, 4 |
| 10 | Welcome reordering and the address index. | 1 day + backend | 6, 8 |

Roughly three weeks of engineering after PR 2 passes, with 4, 5, and 9 able to run in
parallel across people. That is longer than the plan's "about two weeks", and the
difference is §3 and §1.5: the coin store and the wave deploy were both under-counted.

## 7a. As built — PR 3, 2026/09/16

PR 3 of §7 landed as `src/identity/custodyContractClient.ts` and
`src/identity/custodyContractPlan.ts`, with a developer milestone screen behind a flag.
Four things in the design above are different in the built version, and each is a
finding rather than a preference.

### 7a.1 Proving does not go through `VITE_MIDNIGHT_PROVING_URL_V3`

§1.4 routed `account-custody` at a v3-capable proof server, and `contractProvingRoute`
(PR #58) does exactly that. **It cannot work**, and the reason is not the image.
`httpClientProofProvider` uploads the prover key with every request, and the account custody
build's keys are **3.2 GB — 224 MB per k256 circuit**. A browser can neither hold
one nor upload one per call. The droplet's `/prover-v3` is up (`HTTP 200` on
2026/09/16) and it is still the wrong shape for this traffic.

So proving for a custody account is **server-side, and takes a transaction rather than
a key**. The keys live on the balancer, which already holds them at
`/opt/passport-account-custody-artefacts/managed/account-custody/{keys,zkir,contract,compiler}`.

**The endpoint contract, coded against and stubbed in tests:**

```
POST  {VITE_SPONSOR_URL first entry}/prove-account-custody
      e.g. https://67-205-177-162.sslip.io/balancer/prove-account-custody

request  application/json
  { "circuit":    "append_inbox_with_k256",
    "unprovenTx": "<lower-case hex, no 0x, of the serialised unproven transaction>",
    "network":    "stagenet" }

200      { "provenTx": "<lower-case hex, no 0x, of the serialised proven transaction>" }
4xx/5xx  { "error": "<code>", "detail": "<text>" }
```

`unprovenTx` is `Transaction<SignatureEnabled, PreProof, PreBinding>.serialize()`.
`provenTx` must deserialise as
`Transaction.deserialize('signature', 'proof', 'pre-binding', bytes)` — **proven
but not yet bound**, because `proveTx` returns an `UnboundTransaction` and it is
`walletProvider.balanceTx` that binds. Getting the third marker wrong is the
mistake this paragraph exists to prevent.

**Why the sponsor's origin and not the v3 list.** The v3 list names a proof
server, whose contract is midnight-js's own; `/prove-account-custody` is a balancer route, and
the balancer is the service that holds the keys and already serves
`/balance-only`. `VITE_MIDNIGHT_PROVING_URL_V3` keeps the job PR #58 gave it —
the switch that says a v3 route exists at all — and nothing reads it for this
traffic.

**It does not exist yet.** Probed 2026/09/16:
`POST https://67-205-177-162.sslip.io/balancer/prove-account-custody` → `404`,
`{"error":"not-found","message":"Routes: GET /status, GET /wallet-status, …"}`.
Until it lands, every account custody path fails immediately with one plain sentence and a
console line naming the endpoint — never the ten-minute `PROOF_TIMEOUT_MS` wait an
unreachable proof server would otherwise give.

### 7a.2 The deploy is three transactions, and wave 1 is fixed

The wave plan is `custodyContractPlan.ts`'s `planCustodyWaves`, and it is the reference
client's, measured: a 25,000-verifier-byte budget per maintenance update lands the
thirty-circuit roster on **three** waves — the deploy carrying the two deposits
plus the whole eight-circuit k256 arm, then two updates of ten verifier keys, the
last of which retires the maintenance authority.

**Wave 1 is fixed rather than packed by size**, and that is the one place the
implementation refuses to be clever. `activate_initial_device_with_k256` must be
in the deploy, or the account is deployed and can never be opened — and no later
wave can repair it. Two details that cost a transaction each if they are wrong:
`VerifierKeyInsert` takes `ContractOperationVersionedVerifierKey('v4', key)`
(`compact-js` hardcodes `'v3'`, whose keys carry a different header), and the
retiring `ReplaceAuthority` carries `counter + 1n` — the counter its own
application will expect.

### 7a.3 A reload mid-deploy cannot continue

`CustodyAccountRecord` (`passport-account-custody:v1`, keyed by lower-cased Dynamic EVM
address and network) remembers the address, the salt, the recovered point, the
waves done, and the chain hashes, and the chain's own authority counter is read
before every wave. But the **maintenance signing key** lives in the private-state
provider, which is still `inMemoryPrivateStateProvider` with a fresh id per
connection (§3.2). It is held in a tab-lifetime cache here; a reload between wave
1 and wave 3 therefore cannot carry on, and says so in a sentence rather than
retrying into a rejection. **A durable private-state provider — PR 4 — is what
actually fixes this**, and it is a second reason for that PR beyond the coin store.

### 7a.4 The Dynamic key, and what it needed from the seam

`DynamicActions` gained `signRaw(digestHex)`, reached through
`primaryWallet.connector.signRawMessage` rather than `wallet.signMessage`. They
are different calls, not a flag: `signMessage` is `personal_sign` and wraps its
argument in the EIP-191 preamble before a keccak, which nothing on the k256 arm
can express. Only Dynamic's own embedded connector exposes the raw path; an
externally connected wallet does not, and the seam says so in a sentence.

The public point is recovered once, at enrolment, from a signature over
`SHA-256("midnight-passport:k1-device-enrolment:v1")`, using the recovery byte
`parseEvmSignature` keeps. `@dynamic-labs/waas-evm` offers no `getPublicKey`.
`src/lib/custodyRecover.ts` is the only file in `src` that names `@noble/curves`, inside
an `import()`; it is now a **declared, exactly pinned** dependency (`2.4.0`, not a
caret — the v11 `@scure/base` float is why).

### 7a.5 What is stubbed

- `POST /prove-account-custody` — the service (above).
- The `held_coin` witness **refuses**. The coin store is PR 4, and nothing this
  layer calls invokes it: activation and `append_inbox` declare no witness. A
  witness answering with a zero coin would build a transaction the node rejects
  for a reason naming none of this.
- The account's X25519 `encryption_key` is generated and advertised so the
  constructor's shape is the real one, but its secret half is discarded — the
  inbox cannot be read back. §3 is where that is fixed.
- The jubjub arm is deployed (waves 2 and 3 carry its verifier keys) but nothing
  signs with it. PR 5.

### 7a.6 What a live run would need

The sponsor is live and ready (`/wallet-status`, 2026/09/16: one wallet, synced,
259 DUST UTxOs), so fees are not the blocker. Three things are:

1. `POST /prove-account-custody` on the balancer.
2. The `account-custody` artefacts staged where the client can read them. The client
   needs **verifier keys and `zkir/` only** — `getVerifierKey` is what the wave
   deploy reads, and it fetches the small file. The 3.2 GB of `.prover` keys never
   need to reach a browser, which means `prepare-zk-assets.mjs`'s all-three-or-
   nothing `when-present` rule is the wrong shape for this build: it should stage
   `compiler/`, `zkir/`, and the verifier half of `keys/`, and leave the prover
   keys on the balancer. **This is a change for the artefacts PR, not this one.**
3. The demo's origin in Dynamic's Allowed Origins. A local build at
   `http://localhost:5176` is refused at `app.dynamicauth.com/api/v0/sdk/…/nonce`
   by CORS, so the session never leaves `loading` and no sign-in can be driven —
   which is also why the flow is drilled with a fake session rather than walked.

## 8. Notes for the reviewer

- **The module is in the coverage denominator.** `vitest.config.ts` lists
  `src/identity/custodyContractSigning.ts`, and it reaches 100% of statements, branches, functions, and
  lines. The header there says why.
- **The pure circuits are injected, not imported.** The compiled build is ~100 MB and
  gitignored; a static import would make the module unloadable in a unit test. The
  interface in the scaffold is the exact subset of the generated `PureCircuits` type this
  layer needs, so the real module satisfies it structurally. The loader is a marked TODO
  and belongs in `contractRuntime.ts`.
- **`@noble/curves` is a test dependency only**, and not a declared one — it resolves at
  2.4.0 from the hoisted tree. That is acceptable for a test signer and would not be
  acceptable in `src`; given the v11 `@scure/base` float, anything shipped would need a
  declared pin. `src/identity/custodyContractSigning.ts` hashes through WebCrypto for the same reason.
- **One API difference to watch.** The reference's `CustodyAccount` probes three surfaces
  for a circuit's declared return value, because midnight-js versions disagree about where
  it lands. The demo's `callAccountCircuit` reads only `result.public.txId ??
  result.public.transactionHash` and never reads a return value — but
  `withdraw_shielded_with_k256` returns the **change coin** on the private channel, and
  that coin has to go into the store. Where it surfaces on 5.0.0-beta.7 is unverified; PR
  4 finds out.
