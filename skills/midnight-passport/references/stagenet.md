# Building on stagenet with Passport

Sources at v5.0: `examples/passport-demo/src/lib/networks.ts`,
`lib/localWallet.ts`, `lib/colour.ts`, `lib/activation.ts`,
`.github/workflows/deploy-demo.yml`, `docs/demo/stagenet-client.md`, and the
v5.0 release notes.

## Contents

- Where Passport runs
- Identity values an app receives
- Network settings
- Address kinds
- Assets: NIGHT and mUSD
- Fees, proving, and funding
- Explorer links
- Recovery, and why the account is the key
- Pitfalls

## Where Passport runs

| What | Origin |
| --- | --- |
| Production | `https://midnightpassport.com` |
| Internal development build | `https://midnight-passport-dev.vercel.app` |
| From the repository (`npm install && npm run passport:demo`) | `http://localhost:5175` (pinned; use `localhost`, not `127.0.0.1`) |

Every one of them is on Midnight **stagenet**. Mainnet is blocked in Passport.
Passport cannot be framed (`frame-ancestors 'none'`); it frames apps, not the
other way round.

## Identity values an app receives

| Field | v5.0 Passport | Older Passport |
| --- | --- | --- |
| `displayName` | the name without suffix, e.g. `alice` | `alice.night` |
| `passportContract.address` | 64 lower-case hex, no `0x` (the account contract) | same form |
| `passportContract.network` | `stagenet` | `stagenet` |

Normalise the name before showing it (`name.endsWith('.night') ? name : name + '.night'`)
and key users on `passportContract.address` (see "Recovery" below).

## Network settings (what the demo uses)

| Setting | Value |
| --- | --- |
| Network id | `stagenet` |
| Node RPC | `wss://rpc.stagenet.shielded.tools` |
| Indexer (GraphQL) | `https://indexer.stagenet.shielded.tools/api/v4/graphql` |
| 1AM gateway (authenticated facade over node and indexer, API key) | `https://api-stagenet.1am.xyz` |
| `.night` registry contract | `29be1e64846cff4600c5297fa54b27d4c9296b3ccc2cdba190eaba1d64c5f116` |
| Faucet | `https://faucet.stagenet.shielded.tools` (captcha-gated; no automated drip) |
| Explorer | `https://explorer.1am.xyz` with `?network=stagenet` |

An app that only uses the connect package needs none of these except the
explorer: Passport does the proving, signing, and submission.

## Address kinds

| Kind | Looks like | Use |
| --- | --- | --- |
| Unshielded address | `mn_addr_stagenet1…` | recipient of `requestPayment` (NIGHT) |
| Shielded address | `mn_shield-addr_stagenet1…` | recipient of `/gift-nft` `address` for a non-Passport wallet |
| DUST address | `mn_dust_stagenet1…` | fees; never needed by an app |
| Account contract | 64 hex | a Passport's identity; what a `.night` name resolves to; `/gift-nft` `account` |

Passport never shares its wallet addresses with apps, by design: money belongs
at the account, and an app that paid a wallet address would pay somewhere the
account cannot spend from. Do not ask the user to paste one.

## Assets: NIGHT and mUSD

| Asset | Kind | Units |
| --- | --- | --- |
| NIGHT | unshielded, native | 6 decimals: 1 NIGHT = 1,000,000 atomic |
| mUSD (demo stablecoin) | shielded, colour `1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6` | whole units (0 decimals) |

A new Passport's opening grant is **100 mUSD and 0.002 NIGHT**, deposited into
its account by the Passport service. There is nothing to claim from a faucet
for a normal user. An app cannot request an mUSD payment (`transactions.md`).

## Fees, proving, and funding

- Fees are **sponsored**: the Passport service pays the network fee (DUST), so
  users need no DUST. A `submitted` payment reports `sponsored: true` when so.
- Proofs are made **server-side** by a proof service, not in the user's tab.
- **No wallet sync:** a v5.0 Passport does not scan the chain on the device,
  so it opens fast. Apps see no difference.
- Every transaction the user makes is approved with a **passkey prompt**.

## Explorer links

`https://explorer.1am.xyz/tx/<64-hex hash>?network=stagenet`. Link only a
64-hex value (strip `0x`); a 66-hex submission identifier does not resolve, so
show it as text.

## Recovery, and why the account is the key

A user who loses their device recovers their Passport through a Google or email
sign-in (Dynamic); the viewing key that lets Passport read the account's private
history is kept in that sign-in's metadata. Recovery adds the new device to the
**same account**, so the same `.night` name and `passportContract.address`
come back. Key your users on the account address, not on anything
device-specific. Your app never takes part in recovery.

## Pitfalls

- **A name is not an address.** `alice.night` resolves to an account contract,
  not to a payment address; do not put it (or the account hex) in
  `recipientAddress`.
- **Shielded vs unshielded.** `requestPayment` takes only `mn_addr_…`;
  `/gift-nft` `address` takes only `mn_shield-addr_…`. Each refuses the other.
- **Network in the address.** A `preview`/`preprod` address is refused on
  stagenet (`network-mismatch`, `wrong-network`).
- **Passkeys are per domain.** A Passport made on one origin does not exist on
  another; test with one Passport per origin.
- **Holdings are private.** A v5.0 Passport's balances are not public state;
  do not try to read them from the indexer, and do not expect `held` in a gift
  response.
- **Amounts are integers.** Atomic NIGHT as a string or `bigint`; never a
  float, never a JSON number.
