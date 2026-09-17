# Building a client against Midnight Stagenet

Stagenet is a proof-server deployment backed by the upstream public Midnight
stagenet chain. It is **ledger 9**, unlike our other environments — that single
fact drives most of what follows.

## Endpoints

| | |
|---|---|
| API base | `https://api-stagenet.1am.xyz` |
| Node RPC (upstream) | `wss://rpc.stagenet.shielded.tools` |
| Indexer (upstream) | `https://indexer.stagenet.shielded.tools/api/v4/graphql` |
| Network id | `stagenet` |
| Address HRP | `mn_addr_stagenet`, dust: `mn_dust_stagenet` |

Reach the node and indexer **through the API, not directly** — the gateway
exposes them as an authenticated facade at `/rpc/midnight` and
`/api/v4/graphql`, which is what an API key grants you.

Live OpenAPI spec: `GET /docs/openapi.yaml` (Swagger UI at `/docs`).

## Chain versions

```
Ledger            9.1.0.0-rc.3      (events tagged midnight:event[v14])
Node              2.0.0-rc.4
Indexer           4.4.0-pre-alpha.16
Proof server      9.0.0-rc.5_experimental
Compact compiler  0.33.0-rc.2
Compact runtime   0.18.0-rc.1
Compact.js        2.5.5-rc.6
Midnight.js       5.0.0-beta.4
Wallet SDK        2.0.0-beta.2
```

## SDK versions — not optional

A ledger-8-era SDK cannot decode this chain. Events carry the serialization tag
`midnight:event[v14]`; ledger 8 tooling expects `event[v9]` and rejects every
event. Minimum versions, verified working:

```json
"@midnight-ntwrk/wallet-sdk":             "2.0.0-beta.2",
"@midnight-ntwrk/midnight-js-protocol":   "5.0.0-beta.4",
"@midnight-ntwrk/midnight-js-network-id": "5.0.0-beta.4"
```

Symptom if you get this wrong — a schema parse error whose raw payload begins
with hex `6d69646e696768743a6576656e745b7631345d` (`midnight:event[v14]`):

```
ParseError: Wallet.Sync … issue: Composite { actual: { type: 'ParamChange', raw: '6d69646e…' } }
```

## Required npm override

`wallet-sdk-facade@5.0.0-beta.2` imports `Clock` from
`@midnight-ntwrk/wallet-sdk-utilities` without declaring the dependency, and its
siblings all pin exactly `1.2.0`, which predates `Clock` (added in `1.2.1`).
Without this the process dies at startup:

```
SyntaxError: The requested module '@midnight-ntwrk/wallet-sdk-utilities'
does not provide an export named 'Clock'
```

```json
"overrides": {
  "@midnight-ntwrk/wallet-sdk-utilities": "1.2.1"
}
```

Upstream packaging bug in the beta — recheck if you move past `2.0.0-beta.2`.

## API changes from wallet-sdk 1.x / midnight-js 4.x

| what | change |
|---|---|
| `createKeystore` | takes `{ kind: 'schnorr', secret: Uint8Array }`, not a bare `Uint8Array` |
| signer callbacks | now `(data) => Promise<Signature>`; the keystore exposes `signDataAsync` alongside the sync `signData` |
| `addSignatures` | requires `SignatureEnabled[]` — wrap raw signatures: `new ledger.SignatureEnabled(sig)` |
| `ProvingProvider` | gained a required `lookupKey(keyLocation): Promise<ProvingKeyMaterial \| undefined>`. Return `undefined` if you prove remotely and hold no local key material — that keeps proving on the remote path. |

Ledger types come from `@midnight-ntwrk/midnight-js-protocol/ledger`, which
re-exports `@midnightntwrk/ledger-v9`.

## Sync-completeness trap

Do not gate readiness on `SyncProgress.isStrictlyComplete()`. It is
`isCompleteWithin(0n)` — it requires `appliedIndex` to exactly equal
`highestRelevantWalletIndex` at the instant of emission, which a chain producing
blocks almost never satisfies. Worse, if you combine it with an RxJS `filter` +
`timeout`, the timeout never fires (the stream keeps emitting values that fail
the filter), so you hang forever with no error.

Use the SDK's own default tolerance:

```ts
const synced = state.progress?.isCompleteWithin?.(50n) ?? false;
```

## Authentication

API key in a header. Anonymous access is allowed on many routes but rate
limited; an invalid key is treated as anonymous rather than rejected.

```
X-API-Key: pk_live_…
```

Keys are issued per tenant from the Django admin. Two things to request:

- `allow_chain_infra` — required for `/rpc/midnight`, `/api/v4/graphql`,
  `/api/v4/graphql/ws`. Without it those return 403.
- Rate limit appropriate to your use. Responses carry rate-limit headers.

Browser clients can instead use the session flow (`GET /auth/challenge` →
`POST /auth/verify` → cookie), and pass `?session_token=…` on WS routes. Auth
precedence: API key, then `session_token` query, then anonymous.

## Endpoints you will actually use

| endpoint | method | auth | body/response |
|---|---|---|---|
| `/health` | GET | none | JSON — includes chainData snapshot state |
| `/prove` | POST | key (optional) | binary proof preimage → binary proof |
| `/prove-and-balance` | POST | key | prove + dust-sponsor a tx |
| `/balance-only` | POST | key | dust-sponsor an already-proven tx |
| `/wallet-status` | GET | key | JSON — sponsorship wallet readiness |
| `/chain-data/status` | GET | none | JSON — snapshot readiness and event ids |
| `/chain-data/v2/dust` | POST | session | binary dust state for a `dustPublicKey` |
| `/chain-data/v2/shielded` | POST | session | binary shielded state |
| `/chain-data/unshielded` | GET | none | binary |
| `/chain-data/{dust,shielded}/spent` | POST | none | JSON — nullifier spend check |
| `/contract`, `/activities` | POST | none | binary |
| `/rpc/midnight` | POST / GET WS | key + `allow_chain_infra` | JSON-RPC / WS |
| `/api/v4/graphql` | POST | key + `allow_chain_infra` | GraphQL |
| `/api/v4/graphql/ws` | GET WS | key + `allow_chain_infra` | GraphQL subscriptions |

`/prove` takes a binary serialized proof preimage, not JSON. Posting JSON gets
you:

```
deserialize: expected header tag 'midnight:(proof-preimage-versioned,option(proving-data),option(fr-bls)):'
```

## Smoke test

```bash
KEY=pk_live_…
BASE=https://api-stagenet.1am.xyz

# confirm you are on stagenet and not another network
curl -s -X POST "$BASE/rpc/midnight" -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"system_chain","params":[]}'
# → {"jsonrpc":"2.0","id":1,"result":"Midnight Stagenet"}

# indexer through the facade
curl -s -X POST "$BASE/api/v4/graphql" -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ block { height hash } }"}'

# chain-data snapshots must be ready:true with lastEventId tracking the tip
curl -s -H "X-API-Key: $KEY" "$BASE/chain-data/status" \
  | jq '{dust:.["dust.bin"], shielded:.["shielded.bin"]}'

# dust sponsorship available
curl -s -H "X-API-Key: $KEY" "$BASE/wallet-status" \
  | jq '{available, state:.wallets[0].syncState}'
# → {"available":1,"state":"ready"}
```

If `/wallet-status` reports `available: 0` with
`unavailableCause: "INSUFFICIENT_DUST"`, the shared sponsorship wallet needs
funding — sponsored flows will fail until then. Everything else still works.

## Funding

Stagenet has no faucet we are aware of. If your client needs funded accounts,
you need a NIGHT source on this network; dust is then generated by registering
NIGHT UTXOs for dust generation. Ask the infra team rather than assuming a
faucet URL exists.

## Notes

- TLS on the API is terminated by the gateway behind a TCP-passthrough load
  balancer, fronted by Cloudflare. Standard HTTPS clients are fine.
- The admin and Grafana hosts are HTTP-only and IP-restricted; they are not part
  of the client surface.
- Stagenet is an experimental environment running release-candidate components.
  Expect chain resets and breaking SDK changes; do not treat any state here as
  durable.

## Where Passport itself diverges from this guide

Recorded 2026/08/31 against this repository, so the difference is visible rather
than surprising. None of it contradicts the guide; Passport predates parts of
the gateway and reaches some of it directly.

- **Passport talks to the upstream indexer directly**, at
  `https://indexer.stagenet.shielded.tools/api/v4/graphql`
  (`examples/passport-demo/src/identity/midnames.ts`), rather than through the
  gateway facade. Moving it behind `/api/v4/graphql` would put an API key and a
  rate limit in front of every read, which is the guide's recommendation and a
  reasonable thing to do; it has not been done.
- **Sponsorship is our own balancer**, not the gateway's `/prove-and-balance`
  and `/balance-only`. It speaks the same shape — `/wallet-status` with
  `available` and a wallet `syncState` — because it was built against this
  contract. It runs beside the demo's own proof server.
- **Versions run slightly ahead of the minimums above**: `midnight-js-contracts`
  and `midnight-js-network-id` at `5.0.0-beta.6` rather than `5.0.0-beta.4`,
  and `@midnightntwrk/ledger-v9` at `1.0.0-rc.3`. `wallet-sdk` and
  `compact-runtime` match exactly.
- **The `wallet-sdk-utilities` override is already in place** at the workspace
  root, pinned to `1.2.1` for precisely the reason given above — independent
  confirmation that the packaging bug is real.
- **The compiler is a hard constraint here.** The account-custody contract
  deployed on stagenet was built with Compact `0.33.0-rc.2`, and that version is
  no longer installable, so its prover keys cannot be regenerated — they travel
  with a release as an asset. Recompiling with a different version yields
  different verifier keys and a contract the deployed one will not match.
