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

### 3a. As built — the store wired in, 2026/09/17

All three of the problems above are answered. What follows is what was actually built,
including the two things the design did not anticipate.

**One private-state id, computed from the address.** The store keys everything by network
and address (`k1PrivateStateId`), and the deploy record made its own id from the Dynamic
user because the account has no address until wave 1 lands. Those were two different
strings, and a witness reading one while the store writes the other is a Passport that can
be paid and can never spend. `custodyPrivateStateId(record)` is now the only answer: the
record's id before there is an address, and the store's from the moment there is one. Wave
1 writes the store's id into the record as it lands, so a reader of the record sees one id
and not two, and a record written by an earlier build resolves to the same place because
the id is computed from the address rather than read.

**The store IS the private state.** `defaultCustodyDeps().providers` substitutes
`k1PrivateStateProvider(account)` for the in-memory provider `createContractProviders`
builds, and `custodyWitnesses().held_coin` reads `context.privateState.coins[colourHex]`
and returns the private state unchanged. A missing coin throws one sentence.

**midnight-js writes the private state back, and it is a write we do not make.**
`submitCallTx` builds a call against the private state it read BEFORE the circuit ran,
carries it through as `nextPrivateState` — `held_coin` is a read, so it is unchanged — and
on success writes it back through the provider. That state still holds the coin the
withdrawal has just consumed. The ordering happens to favour us today (the write lands
before the call's promise resolves, so the caller's own write is later), and ordering is
not something to depend on: it is midnight-js's, and `submitCallTxAsync` already hands the
write back to the caller entirely. So `k1PrivateStateProvider.set` MERGES rather than
overwrites — a row whose nonce the store has recorded as spent is dropped, a colour the
store already holds keeps the stored coin, and the queue, the spent list, and the
candidates are never taken from an incoming state. Drilled in both orders.

**A colour's awaiting rows are a LIST, and one slot lost a coin.** The store files a
spend's change coin the instant the circuit returns, with its description and no position
(`awaiting`). That was one row per colour, and this sequence — spend, be paid in the same
colour, spend again — put the second spend's change on the first's row. The row it
replaced was the only description of that coin anywhere: the chain carries the note, not
its nonce, value, or transaction, so the coin became unspendable by anybody for ever,
with nothing on screen saying so. A colour now holds as many rows as it has coins in
flight; `settleK1AwaitingCoin` and `renameK1AwaitingTx` name ONE row by the transaction it
is filed under, and within a colour the nonce is the coin's identity, so a resumed run
offering the same coin twice stores it once. A store written by the older build is read as
a one-element list, losslessly, and the new shape is written by the account's next write.
A row whose candidate positions could not be stored (the colour's held slot is occupied)
now WAITS for the slot instead of being dropped with its description.

**How a change coin's position is asked for, exactly — one question, by the chain's
hash.** The design read as though the client tried the hash and then the identifier for
the same coin. It does not, and it should not. A spend files its change the instant the
circuit returns, and the only name for the transaction at that moment is midnight-js's
own identifier; a sponsored transaction is superseded by the balanced one, so that
identifier is a key the indexer will never answer a commitment window for. So
`settleShieldedChange` RENAMES the awaiting row to the chain hash as soon as
`resolveHash` has it (`renameK1AwaitingTx`) and then asks ONCE, at
`offset: { hash: … }` — the only offset this indexer answers (§3b). There is no
identifier attempt for the same coin, because the identifier form can never answer for
one: it is not a fallback that was dropped, it is a question with no answer in it. What
makes a coin the indexer has not caught up with safe is not a second spelling of the
question but the awaiting row itself, which is asked about again on every read of Home,
after a reload, or tomorrow.

**And `resolveHash` does not always have a hash — corrected 2026/09/18.** The paragraph
above was written as though it did. `resolveTransactionHash` polls the indexer twenty
times at half-second intervals and then **returns the identifier it was given**, which is
not a failure and is indistinguishable from an answer at the call site. So an indexer
more than ten seconds behind left the row filed under the identifier, with nothing to
rename it to and every later read asking `{ hash: <identifier> }` — a question with no
answer in it, for ever. The real rule, in one place used by both callers
(`settleK1AwaitingCoinByChainHash` in `k1CoinStore.ts`, called by `settleShieldedChange`
and by Home's walk of the awaiting rows):

- a row whose `txId` is a 64-hex chain hash is settled directly;
- a row whose `txId` is anything else — midnight-js's identifier is 66 hex — has the hash
  asked for again, ONE question (`resolveTxHashOnce`), and is renamed the first time the
  indexer can name it;
- until then nothing is asked about a position, because the identifier form has no answer
  in it, and the row stays exactly as it is. It counts as a payment still arriving, and
  the next read of Home is what places it.

The one fallback that does exist is about the SCHEMA and not the value:
`resolveTxCommitmentWindowByHashOnce` re-asks under `{ identifier: … }` only when a
deployment's schema refuses the `hash` field outright (GraphQL rejects an unknown field
for the whole query rather than answering without it), so a deployment that serves only
the other spelling still gets an answer. The live run never needed it. Until 2026/09/17
the client's default reader for this was `resolveTxCommitmentWindowOnce`, the identifier
form — handed a hash. It could not answer, and a withdrawal's change coin was therefore
placed only by the next read of Home rather than by the spend itself; both now ask by
hash.

**The candidate rule.** A withdrawal's transaction carries two shielded outputs — the
payee's note and the account's change — so the indexer's commitment window gives two
positions and nothing distinguishes them client-side. The candidates are stored in the
order the window gives them (`mtIndexCandidates`, head = the current guess); the next
spend tries the head; a failure naming the merkle path, a witness, or an unsatisfiable
constraint retries with the next candidate; the one that proves is settled. An incorrect
position cannot be proved, so nothing is submitted and nothing is spent (INV-5), which is
what makes the retry free. **There IS no stable output order** — four live transactions
against the same contract put the contract's coin first twice and second twice (§3b) —
so the head stays candidate 0 because it is the first, not because anything says it is
the change, and the retry is what decides. Nothing stores a guess as a fact.

A refusal can reach the retry from either of two places, and both must be read as the
same thing: the local runtime, when it cannot build a Merkle path for the position at
all, and the proving service, when the path it built rebuilds a different root. The
second arrives inside midnight-js's own wrapper, which is why
`isCustodyProofNotBuilt` walks the `cause` chain and matches the error's name in the
text (§3b, "Why a recoverable guess became a dead stop"). There is a third, and it took
a live run to find: the runtime does not always fail politely. A position past the last
leaf the contract's own Zswap state retains makes it TRAP, and all that arrives is
`RuntimeError: unreachable` — a name and one word (§3c).

**A settled coin has no candidate list, and that is the case the retry has to survive
(corrected 2026/09/18).** Reconciliation keeps the winning position and drops the
candidates, which is right: a coin whose position the chain has agreed needs no list. But
if the chain later has the coin somewhere else, the one position left is the wrong one and
there is nothing to advance to — the retry fires and finds an empty list. `widenK1CoinCandidates`
therefore seeds a list from the coin's OWN position when it has none, and sweeps
`K1_CANDIDATE_SWEEP` either side of it. D1 sat in exactly that state live and could not
send at all until this was in. Seeding rather than sweeping directly is what keeps the
widening idempotent — the contiguous prefix of a one-position list is that position, so a
second call recomputes the same neighbours and adds nothing — which matters because a
spend's loop is `advance ?? widen` and a widening that kept finding more would never
terminate.

### 3a.1 The passkey arm through the same engine, live — 2026/09/18

Recorded in full in `scratchpad/live-proxy/RUN-sends.md`. What it adds to §3a
and §3c is that **the arm is not a second engine**: `spendShieldedK1` and its
two doors, the retry, the store and the backfill are one code path, and the arm
chooses the gated half of a circuit name and how the authorisation is built and
nothing else.

**Where the arm diverges, and it is two lines.** The circuit is
`withdraw_shielded_with_${arm}` or `withdraw_shielded_to_contract_with_${arm}`;
the authorisation is built either by the vendor over a socket (k256, four
trailing arguments ending in the envelope) or synchronously from the passkey's
derived scalar (jubjub, five, ending in `grind_nonce`). `deposit_shielded` is
permissionless and therefore the SAME circuit whichever arm the sender is on —
which is why a passkey Passport pays a social sign-in's Passport and the
reverse, and why the recipient's arm never enters the sender's decision.

**The four measurements, on a passkey Passport (`jjp9h5apyr7fe6.night`,
account `098b18f2…dbee`) made and named live the same afternoon:**

| | transaction | block | proof | window |
|---|---|---|---|---|
| Direct transfer to `dynone1.night`, 1 mUSD | `f865d6c942f7e5738b92480b4740de7d293b4c80755a0b042293614d624e752f` | 519005 | **58.6 s** (`…_to_contract_with_jubjub` + `deposit_shielded`, one request, 6353 bytes in) | `[3842, 3844)` |
| The change backfill | `a8f0c2c22429fb3586b88dfbb30255df76cab11e92a58d6c7c29c85f8c38c9aa` | 519019 | **56.1 s** (`append_inbox_with_jubjub`) | `[3844, 3844)` — none, which is right |
| To a shielded address, 1 mUSD | `47e1d1c1a0699479b2595d8cb34dd895bce31b01c89e4548a33828cb938435f3` | 519072 | **59.7 s** (`withdraw_shielded_with_jubjub`) | `[3844, 3845)` |
| Being paid, from a social sign-in's Passport | `07e80bc7ecd8e21d4ec4b64f7c62f16e6d974c62a1ff574615c17349d0825323` | 518986 | 126.5 s | `[3841, 3842)` |

Every one SUCCESS. Both composed transactions carry BOTH calls under a single
hash, read off the indexer rather than off the client.

**A jubjub proof is half a k256 one.** 58.6 s against 126.5 s for the same
composed pair on the same box and the same proof server, minutes apart. The
gated jubjub circuits verify a Schnorr signature over the embedded curve; the
k256 ones verify ECDSA over a foreign one, which is the expensive half of the
account custody contract and always was.

**The retry fired on this arm, and the failure was the proof service's.** The
address send's first attempt drew a `400` from `/prover-v3/prove` for the change
coin's stored position (3842); the phase said nothing had been submitted, the
next candidate (3843) was tried, and it proved. So the mechanism §3c rebuilt on
the wording-to-phase argument works on an arm it had never run on. It also shows
the mechanism's one cost plainly: the client cannot distinguish a service that
refuses a position from a service that is unwell, so a transient proving failure
also burns a candidate. Safe (nothing is submitted either way) and cheap (the
list is short), but worth naming.

**And an ordinary wallet finds what a passkey's contract created.** The
throwaway recipient of the address send — no Passport, no account contract —
synced from genesis and holds the coin as a spendable coin, under its own nonce,
alongside the one an earlier k256 run gave it. `additionalCoinEncPublicKeyMappings`
is what makes that true, and it is now shown on both arms.

**What the run did NOT settle.** The sponsor's `/fund-account` still refuses an
account custody account with `not-an-account` (§7a; the sibling sponsor PR is the
fix), so a passkey Passport is still funded by being paid rather than by an
opening balance. And the account's NIGHT still moves in the two legs of §3b,
the second of which goes through the sender's own wallet — so the passkey arm
refuses that one payment in a sentence rather than taking a route the ruling of
2026/09/18 forbids.

### 3b. What the live stagenet run of 2026/09/18 settled, and what it did not

Recorded in full in `scratchpad/live-proxy/RUN.md`.

**A two-output delivery is the ORDINARY case, not an edge one.** A passkey Passport
paid a Dynamic Passport 60 mUSD by name (tx
`8f68bef238d1ea91d7315d99e91e3e8da090286ca905532ffdccc6c3c60c254b`, block 508123) and
the indexer's window for it was `[3772, 3774)` — two outputs, because the payer sent
part of what it held and its own change rides in the same transaction. So the inbox
walk had to keep candidates rather than report them: with `'report'` the recipient's
mUSD row read **0** for money that had demonstrably arrived. The walk now reconciles
with `candidates: 'store'`, and a colour that already holds something keeps it —
candidates go in the held slot or nowhere, which the reconciliation says with `stored`.

**What the indexer answers, exactly.** `indexer.stagenet.shielded.tools/api/v4`
answers a commitment window at `offset: { hash: … }` — the CHAIN hash. It does not
answer at `offset: { identifier: … }`, which is what midnight-js returns and what a
sponsored transaction's identifier is superseded away from, so a coin filed under an
identifier can never settle; the client renames the row to the hash once
`resolveHash` has it. BOTH field spellings work — `startIndex`/`endIndex` and
`zswapStartIndex`/`zswapEndIndex` both return `3772 / 3774` — so the unprefixed pair
the client asks for first is enough and the fallback was not needed.

**There is no stable change-coin output order, and the store must not assume one.**
Seven live transactions, each with two shielded outputs, and the position the
contract's own coin took inside the indexer's window:

| Transaction | Window | The contract's coin | Which output |
|---|---|---|---|
| `8f68bef2…254b` (a passkey Passport's `deposit_shielded` into D1) | `[3772, 3774)` | 3773 | second |
| `ea677f52…9384` (D1's `withdraw_shielded_with_k256`, block 509111) | `[3795, 3797)` | 3795 | **first** |
| `ffe8e5e7…e967` (D1's second withdrawal, block 509155) | `[3799, 3801)` | 3800 | second |
| `acb6bd27…eb19` (D1 → D2, block 509189) | `[3803, 3805)` | 3803 | **first** |
| `3a1ff153…82cf` (D1 → `pkone2`, 5 mUSD, block 510575) | `[3806, 3808)` | 3807 | second |
| `6443f552…3274` (D1 → D2, 4 mUSD, block 510695) | `[3810, 3812)` | 3810 | **first** |
| `3ac9fd63…11eb` (D1 → `pkone2`, 2 mUSD, block 510758) | `[3813, 3815)` | 3814 | second |

Three first and four second, from the same circuit against the same contract
across a thousand blocks. The order is a property of how Zswap assembled that offer, not of the
circuit, so no default order is correct and none is written as one. The head
stays the first position the window gave, the rest stay beside it as
candidates, and the RETRY is what decides — which is the reference's own rule
(MIP-0012 INV-5: a wrong qualified description is an unsatisfiable witness, so
nothing is submitted and nothing is lost).

**The position is a fact the chain will tell you, if you ask the right thing
for it.** `queryZSwapAndContractState(<address>)` returns the contract's OWN
Zswap chain state, and that tree retains exactly this contract's leaves
uncollapsed:

```
coin_coms: MerkleTree(root = Some(58eaa3de…5448)) {
    0..=3772: <collapsed>,
    3773: (c27caec4…2da4, Some(ContractAddress(0ffd70ad…2746))),
    3774..=3794: <collapsed>,
    3795: (58e84983…51c0, Some(ContractAddress(0ffd70ad…2746))),
    3796..=3799: <collapsed>,
    3800: (c77579d1…2bdd, Some(ContractAddress(0ffd70ad…2746))),
    3801..=3802: <collapsed>,
    3803: (84f92d26…0068, Some(ContractAddress(0ffd70ad…2746))),
}
```

Every one of those four positions is in the table above. Nothing in this PR
reads it — `ledger-v9` exposes the leaves only through `toString`, and a store
that parses a debug format is a store that breaks on the next release — but it
is where a later PR should get the position from, and it is why the retry is a
backstop rather than the mechanism.

**The blocker of 2026/09/17 was a WRONG POSITION, not the proof server.** The
earlier write-up read the proof server's `400` as a body limit on the 235 MB
prover key. It was not. The server's own log says:

```
ERROR midnight_zkir::ir_vm: Public transcript input mismatch idx=13
  expected=Some(e5ab485c63577d557a595ae679003ac8e9599f5864457f7e66510471b31d9f3e)
  computed=Some(1bff900ba21710e6750348a1529f5907432fe8475651d0e28a30605e1058f924)
```

(The `7379905…` recorded the night before is the same line about the same
quantity at a different block: the root moves every time a leaf is added, which
is why it decodes to nothing in particular.)

`expected` is the ROOT of the contract's own Zswap tree, which the client's
public transcript declares; `computed` is the root the circuit rebuilds from
the coin commitment and the Merkle path at the position the `held_coin` witness
names. The store's head was 3772 and the coin was at 3773, so the two roots
differ and the constraint system is unsatisfiable. With the position corrected
the SAME circuit proved on the SAME server in 62.6 s, and the node accepted the
transaction (block 509111).

The proof server is not a variable here. The same captured
`/prove-account-custody` body, replayed against local `9.0.0-rc.3`, `9.0.0-rc.6`
and `9.0.0-rc.7`, was refused with byte-identical `expected`/`computed` values;
`10.0.0-alpha.1` refuses the wire format outright (`proof-preimage-versioned[v2]`)
and cannot serve a `ledger-v9` 1.0.0-rc.3 client at all. A 235 MB prover key
uploads and proves; there is no body limit and no version skew, and there is
nothing here for whoever owns the proof server to do.

**Why a recoverable guess became a dead stop.** `withdrawShieldedK1` already
retried the next candidate, and it never fired, because midnight-js does not
rethrow what a provider threw: `submitTx` builds a NEW plain `Error` whose
message is its own preamble with our error's `name: message` appended and no
`cause` set —

```
Error: Unexpected error submitting scoped transaction '<unnamed>': \
  CustodyProofNotBuilt: That payment could not be completed just now. …
```

— so `isCustodyProofNotBuilt`, which read `cause.name`, said "not that error"
about exactly that error. It now walks the `cause` chain and matches the name
in the text, which is the only thing that survives the hop. The other arm of
the retry was fine: when the position is one the local runtime cannot build a
path for, it says so before any proving happens, and the retry fired on the
first try (live, D1's third spend).

**A wrong position arrives in THREE shapes, and only two of them should retry.**
Measured by seeding a wrong head deliberately and driving the same send:

| The head is | What happens | Retried? |
|---|---|---|
| a leaf the contract's tree does not retain (3804, past the last one) | the on-chain runtime TRAPS while executing the call: `Unexpected error executing scoped transaction '<unnamed>': RuntimeError: unreachable`, naming nothing | yes — `spendPositionMayBeWrong` matches `RuntimeError`, the WebAssembly trap marker |
| inside a collapsed range (3772, where the coin was at 3773) | a path is built, the proof server rebuilds a different root and declines: `400`, `Public transcript input mismatch` | yes — `isCustodyProofNotBuilt`, through midnight-js's wrapper |
| another retained leaf of this contract (3800, a coin already spent) | the prover neither proves nor declines: the sponsor's 180-second deadline passes and the caller is told the service is not answering | **no**, deliberately — a timeout is not evidence about a position, and retrying one costs three minutes per candidate |

The third is why the retry is a backstop and the contract's own Zswap state is
the answer: a position that is wrong in that particular way costs three minutes
and still tells nobody anything.

**The re-run of 2026/09/18 04:00–04:27 UTC — both fixes, watched live.**
Recorded in full in `scratchpad/live-proxy/RUN.md` ("The re-run of 2026/09/18").
Four more payments on the same two Passports, with the coin store sampled every
second from the click to the last screen:

| What | Result |
|---|---|
| D1 → `pkone2.night`, 5 mUSD | withdraw `3a1ff153…82cf` block 510575, deposit `31eafb55…8654` block 510583; 106 s, proof 29.0 s, first candidate |
| D1 → `dyntwo1.night`, 4 mUSD | head 3806 refused, **retried onto 3807**; withdraw `6443f552…3274` block 510695, deposit `b93dde47…18a0` block 510701; 107 s, proof 17.0 s |
| D1 → `pkone2.night`, 2 mUSD, **tab closed mid-payment** | withdraw `3ac9fd63…11eb` block 510758, proof 18.8 s; the offer on re-open told the truth and **Finish** delivered it — deposit `8693cb7b…5aea2` block 510828, 41 s |

- **The by-hash reader places the change immediately.** In both completed
  spends the change was in `awaiting` under midnight-js's identifier one second
  and in `coins` with a position the next — `3806` with `[3806, 3807]` beside
  it, then `3810` with `[3810, 3811]` — with no read of Home in between. That
  is what §3a's last paragraph is about: before this, the default reader asked
  `{ identifier: … }`, which this indexer cannot answer, and the coin waited for
  the next Home open.
- **The awaiting row is named by its transaction.** Each row was stored as a
  one-element list under its colour carrying its own `txId`, renamed to the
  chain's hash by `renameK1AwaitingTx`, and settled by that hash. Two rows in
  one colour at the same time was not producible live, because settling now
  takes a second; that case stays on its unit drill.
- **The middle shape of a wrong position is now a live result, not a unit
  test.** The 5 mUSD spend's change was stored at 3806 and the chain retains
  3807, so the next spend was refused by the proof server with
  `Public transcript input mismatch idx=13 expected=Some(a7d2d427…1445)
  computed=Some(cde320b0…484f)`, the client logged `retrying the spend against
  candidate position 1 of this coin`, and the second candidate proved. One
  refusal, one retry, one proof, nothing submitted on the wrong position.
- **Two defects, both fixed.** `custodyActionHistoryQuery` selected
  `transactionResult` on the `Transaction` interface rather than inside
  `... on RegularTransaction`, so the v4 endpoint refused the whole query and
  every delivery came back `'unavailable'`: Home said "One payment is still
  arriving" about money it had already spent. Fixed. And `finishStoppedSend`
  read the wallet's notes ONCE, so pressing **Finish** before the wallet had
  synced the note failed in under a second (45 s after a re-open it failed,
  three minutes later the same press completed): **Finish** now waits for the
  note exactly as the send path does — `awaitCustodyStoppedNote`, the same
  `SETTLE_WATCH_MS` window and the same line on screen — and a window that
  closes says so in one sentence naming the button, with nothing written and
  nothing sent.

**The mUSD send, end to end, three times.**

| What | Result |
|---|---|
| D1 → `pkone2.night`, 20 mUSD | withdraw `ea677f52…9384` block 509111, deposit `00b4688d…bae0` block 509121; 161 s, proof 62.6 s |
| D1 → `pkone2.night`, 15 mUSD **from the change coin** | withdraw `ffe8e5e7…e967` block 509155; 94 s, proof 26.0 s |
| D1 → `dyntwo1.night`, 10 mUSD (Dynamic → Dynamic) | withdraw `acb6bd27…eb19` block 509189; 125 s, proof 27.3 s |

D2's Home then read `dyntwo1.night · 0.0004 NIGHT · 10 MUSD`, opened from its
own sealed inbox entry — a Dynamic Passport paying another Dynamic Passport a
shielded token, and the recipient reading it out of the contract's public inbox
with its own key.

**What landed AFTER this run, and is unit-drilled only.** Two repairs from the spot
review of the same day are not in anything above, and step R3's record of the candidate
rotation is the OLD behaviour: the list was consumed and the coin left on the last guess.
Since then the list is rotated through and never discarded, the head is put back on the
coin by any exit from the retry loop that is not a retry (`restartK1CoinCandidates`), and
the sponsor's prove route tells a proof server's VERDICT (`400`/`422`, an allowlist) from
a proof server or gateway that never judged the transaction (`503 prover-unavailable`) —
so a restarted prover or a Caddy `404` no longer spends an approval per candidate. Every
one of those paths is drilled in unit tests; none of them has been seen live, and the next
live run is what would settle them.

**What DID work end to end.** Setup and activation for two Dynamic Passports, a
`.night` name for each, being paid mUSD by a passkey Passport and showing it as
balance, being paid NIGHT, and paying another Dynamic Passport NIGHT
(`withdraw_unshielded_with_k256` + `deposit_unshielded`, tx
`c60fd191cc11881379a5b28098affd71e97a569a13f497bc677e99687f823873`, block 508648).

**A state the design did not name: described, held, unspendable.** The change coin arrives
as the circuit's JS return value (`callResult.private.result`, extracted by that name and
never the privacy-sensitive object around it) and carries no `mt_index`, because the
position is allocated by the transaction being submitted at that moment. That description
exists nowhere else in the world. So the store has an `awaiting` slot: the change is
written there in the SAME write that records the spend, before anything is asked of the
indexer, and `settleK1AwaitingCoin` files it into `coins` whenever the answer arrives — a
second later, after a reload, or tomorrow. An awaiting coin is never handed to the witness
and never counted as balance; it is arriving, which is what it is.

**More than one coin per colour.** The contract holds any number and the witness names
one, so the second and later coins of a colour are queued behind the held one. Balance
shown is held + queued; what one payment can draw on is the held coin alone, and the
refusal for the difference says that in a sentence rather than claiming the holder is
poorer than they are.

**Three legs, and where the value is.** `planCustodyShieldedSend` is leg 1
`withdraw_shielded_with_k256` to this Passport's own coin public key for EXACTLY the
amount (the change comes back described, so there is no whole-coin workaround and no third
transaction putting the difference back — unlike the passkey path, which needs both
because of node error 239); leg 2 the note identified by nonce; leg 3 `deposit_shielded`
into the recipient — the note alone into a prototype account, the note and an entry sealed
to a LIVE-read `enc_key` into another custody account, submitted through
`custodyPermissionlessCallAt`, which opens the recipient's address with none of this
Passport's own store served to it. A leg 3 that fails deposits the note back into the
sender's own account, sealed to the sender's own key; if that fails too,
`custodyShieldedSendOutcome` says the value is held at the sender's own receiving address
rather than claiming it came back. The record that survives a closed tab
(`CUSTODY_SHIELDED_SEND_KEY`) carries the colour, the amount, the recipient, and the note
— one per account, because the app makes one payment at a time.

**Proving.** The gated circuits (235 MB keys) go to the sponsor's own proving route; the
deposits (0.4 MB and 11 MB) prove on the ordinary v3 route `createContractProviders`
already builds, so a payment does not queue behind a 235 MB proof.

### 3c. The one-transaction send, as built — 2026/09/18

**§3b's "Three legs, and where the value is" is superseded by this section.** The
three-leg shape is gone from the code: `waitForNote`, `deliverNote`,
`findStoppedNote`, `awaitCustodyStoppedNote`, `depositShieldedIntoCustody`,
`custodyPermissionlessCallAt` and the Finish button are deleted, and the stages
`awaiting-note`, `depositing`, `returning`, `unconfirmed` and `stranded` with
them. A shielded payment is now ONE transaction, and the live evidence is in
`scratchpad/live-proxy/RUN-direct.md`.

#### Two doors, one engine

`spendShieldedK1` is the engine and takes the whole payment; two thin functions
are the doors, and the difference between them is decided once, on the shape of
what the person typed:

- **`withdrawShieldedK1`** — an `mn_shield-addr…` was typed. ONE call,
  `withdraw_shielded_with_k256`, carrying
  `additionalCoinEncPublicKeyMappings: Map(coinPkHex → encPkHex)` built from
  `decodeShieldedRecipient`. That mapping is the whole of why an ordinary wallet
  can find the coin: without it the output exists and its ciphertext is
  addressed to nobody the recipient scans for.
- **`withdrawShieldedToContractK1`** — a `.night` name was typed and resolved to
  another account. TWO calls in one transaction (below).

Only a shielded amount may go to an address: the account's unshielded holdings
are a mirror the contract keeps, and nothing at a shielded address can write one.

#### The composed transaction, exactly

Per candidate position, in `spendShieldedK1`:

1. `createUnprovenCallTx` on the SENDER for
   `withdraw_shielded_to_contract_with_k256`, with the recipient contract as the
   payee and `privateStateId` set — this Passport's own store.
2. `directSpendFromResult(spend.private.result)` → `[sent, change]`. **`sent === null`
   throws before anything is submitted.** A coin nobody can describe stops the
   payment instead of arriving unspendable.
3. `sealCustodyInboxEntry(recipientEncKeyHex, sent)` — the entry the recipient
   decrypts, sealed to a key read live off the chain.
4. `createUnprovenCallTx` on the RECIPIENT for `deposit_shielded`, **with no
   `privateStateId`**. This is deliberate and load-bearing: a connection
   addressed at somebody else's account must never be served this Passport's
   coin store.
5. `graftIntent` — `txA.addIntent({tag:'random'}, [...txB.intents.values()][0])`, and
   **the result is checked**: the returned transaction must carry one intent more
   than the one handed in, or the payment is refused before anything is
   submitted. It used to fall back to `?? txA` on a build that returned nothing,
   which is the defensive read the deploy waves make of `addDeploy` — but the two
   are not alike. A deploy that loses its addition fails loudly at the node; a
   spend that loses its graft is a VALID transaction that takes the sender's
   money and pays nobody, because the withdrawal half is intact and the claim
   half is simply absent. See question 2 under "Open questions for Nicolas".
   **Never merge.** `mergeUnsubmittedCallTxData` is midnight-js's multi-call path
   and it is a MERGE, which is wrong here; it is reached only from `scoped()` and
   `submitCallTx`, both of which this code bypasses. The graft is at the ledger
   level, the same move `custody-payments.ts` makes.
6. `submitTx(providers, { unprovenTx: composed, circuitId: [both] })`.

**`submitTx` does not compose anything.** Read from `dist/index.js`: `submitTx` →
`submitTxCore` = `proveTx` → `balanceTx` → `submitTx`, with no merge step, and
the `circuitId` it is handed is never read. It is passed as an array only so the
proof provider can name both circuits to the sponsor; the composition is already
done by step 5.

#### Proving: one request, every circuit the transaction calls

`POST /prove-account-custody` takes `circuits: […]` (a single `circuit:` string
is still answered, so nothing that predates this breaks). The sponsor validates
and stage-checks **every** name and refuses more than four. It then hands the
whole transaction to ONE `httpClientProofProvider.proveTx`, which walks the
transaction's own calls and fetches each circuit's key — so two circuits are
proved in one request rather than two.

**Live:** `withdraw_shielded_to_contract_with_k256 + deposit_shielded`, 6477
bytes in, proved in **131.3 s**, 28827 bytes out.

**The 2 MiB cap is not a constraint.** Measured on the wire from the proxy's own
captures: the address door 5163 bytes, the composed door **6477 bytes — 0.31 %
of 2 MiB**, the change backfill 2374 bytes. There is three orders of magnitude of
room, so nothing in this design needs to be shaped around the limit.

**Nothing proves in the tab.** Every account-custody proof leaves the browser:
the small keys on the ordinary v3 route, the 235 MB gated keys on the sponsor's
own route. The sponsor therefore sees the coin and the amount of every gated
call. That is a recorded decision, not an oversight — the alternative is a 235 MB
key download per payment — and it is the reason the sponsor is a trusted
component and is said so here rather than in a footnote.

#### The recipient's position: the reported window first, then a sweep

A withdrawal's change comes back described but WITHOUT `mt_index`, because the
position is allocated by the transaction being submitted at that moment. So the
client asks the indexer for the transaction's window and tries the positions in
it. The rule, in `widenK1CoinCandidates`:

**The plain `[startIndex, endIndex)` window is tried first, in full. Only when it
is exhausted is a ±4 sweep appended, once.** The sweep reads the ORIGINAL window
as its base, never the list it is extending — sweeping from the whole list widens
around its own additions for ever, and a unit drill in `k1CoinStore.test.ts`
catches exactly that. `K1_CANDIDATE_SWEEP = 4`, and the whole thing is
idempotent: running it twice adds nothing.

Seven live two-output transactions in `RUN.md` split three-first / four-second,
and this run adds more. **There is still no stable output order**, which is why
the window is walked rather than indexed into.

#### What decides a retry: the proof boundary, not the wording

A wrong position does not produce a wrong Merkle path. It traps the runtime
while the circuit executes, and the trap says only `RuntimeError: unreachable` —
no position, no witness, no words. For a while the predicate that decides a
retry required midnight-js's `scoped()` wrapper text beside that word, which
this build removed when it started composing its own transaction; the predicate
was therefore always false and the one failure the retry exists for was the one
it could not see. D1 met it live on 2026/09/18 and could not send at all.

Widening the match was not available: `RuntimeError` marks every WebAssembly
trap there is, and `submitTx` proves, balances and submits behind one call, so a
trap read as a position's trap could ask for a second approval on a transaction
already on its way. **A retry is safe exactly while the transaction is still in
this tab's hands, and that line is the proof coming back** — after it, `submitTx`
goes on to balance and submit.

So the proof provider reports that moment (`onProved`), `spendShieldedK1` tracks
which side of it each attempt is on, and only the near side is retried. Phase
decides whether a retry is SAFE; the wording now only decides whether it is
WORTH it, and may therefore match the bare trap. The drills fix the line in
place with the same words on both sides of it — retried before the proof,
refused after — because that is the property, and no wording can express it.

#### The change backfill

After the send is reported — non-blocking, never in the payment's path — the
change coin's description is written into the sender's OWN inbox by
`appendChangeToInboxK1`, so a Passport restored on another device can find it by
walking the inbox rather than needing a store it does not have. Live:
`append_inbox_with_k256`, proved in 56.6 s, SUCCESS.

**It costs a second approval.** `append_inbox` is gated, so the person is asked
to sign twice for one payment. Whether that is acceptable, or whether the entry
should be batched into a later transaction, is an open question for Nicolas.

#### Open questions for Nicolas

1. **The change backfill's second approval**, above: acceptable, or batched into
   a later transaction?
2. **Can the claim's segment fail while the withdrawal's succeeds?** The
   composed transaction carries two calls: the sender's gated
   `withdraw_shielded_to_contract_with_<arm>` and the recipient's
   permissionless `deposit_shielded`, grafted in as an intent in a RANDOM
   segment. A transaction has a guaranteed part and fallible parts, and a
   fallible segment can fail on its own — that is what `FailFallible` means. If
   the segment carrying the claim can fail while the segment carrying the
   withdrawal succeeds, the outcome is a shielded output owned by the
   recipient's contract that their `deposit_shielded` never claimed and that
   no inbox entry describes: money that has left the sender, does not appear in
   the recipient's balance, and that nobody holds a description of. The client
   cannot tell today — it reads one status for the whole transaction, and
   `SucceedEntirely` is the only one it books a spend on, so the case would
   reach it as a refusal and a restored store even though value HAD moved.
   What we need from the contract side is whether the composition makes that
   outcome reachable at all (one segment, or two?), and if it is, whether the
   claim should be placed in the guaranteed part instead so the two cannot come
   apart. Until it is answered the client treats anything but `SucceedEntirely`
   as "nothing moved", which is right for a whole-transaction failure and would
   be wrong for a split one.

#### What a reopened Passport is owed

Stages are `sending` and `done`, and `nextCustodyShieldedSendStep` returns
`'report'` or `'nothing'` — **there is no `'finish'`**. A send is one transaction,
so there is no leg for a button to run, and a button offering to "finish" one
would be a button offering to pay twice. What is owed is a sentence and a
Dismiss, and the sentence points at the balance on the same screen.

**The stage does not decide the sentence on its own; `sendTxId` does.** Most of
what goes wrong with a payment goes wrong before a transaction exists — the
approval is dismissed, the proving service does not answer, the position cannot
be proved — and in all of those the coin is untouched. So the id is written on
the `confirm` phase, the first moment a transaction exists, and the outcome
reads its absence as *"Nothing was sent, and it is all still in your Passport."*
and its presence as *"either it reached them or nothing left your Passport"*.
Hedging about money that demonstrably never moved is a worse answer than the
truth, and until 2026/09/18 the field was declared, defaulted, read back — and
never written, so the hedge was all anybody got.

#### On §6, "Restorable on another device"

The backfill is a real part of the answer to §6's hard half and should be read
into it: the inbox now carries the sender's own change, not only what others
deposited, so walking the inbox from ordinal 0 reconstructs more of the store
than it could before. **It does not close §6.** The viewing key is still private
and Dynamic still exports nothing it can be derived from, so "restorable" still
means "can receive" until that is solved. What changed is the size of what a
viewing key would recover, not whether one can be had.

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
