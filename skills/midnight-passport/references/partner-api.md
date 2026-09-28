# Partner API: giving a Passport user an item

Source: `docs/demo/partner-api.md` (revised 2026/09/14) and
`examples/passport-balancer/src/server.ts` at v5.0. Stagenet only. This is the
one partner route; it works for Passports made on v5.0 as well as older ones.

## Contents

- Base URL, auth, and where to call it from
- `POST /gift-nft`: the three recipient forms, the items
- The response, and what `200` means
- Errors, rate limits, timing
- Paying NIGHT or mUSD by name (not available)
- Resolving a `.night` name yourself
- A backend handler to copy

## Base URL, auth, and where to call it from

```
https://67-205-177-162.sslip.io/balancer
```

- Call it **from your backend**, server to server. The service's committed
  CORS allow-list names only Passport's own origins (the older doc says a
  browser may call it; the configuration says otherwise), and a browser call
  would expose any key you hold.
- `X-Passport-Key: <key>` is required only where the operator configured a
  client key; a `401 unauthorised` means ask the Passport team for one. Keep it
  in a server-side secret, never in a `VITE_*`/`NEXT_PUBLIC_*` variable.
- Health: `GET /wallet-status` (`available: true` means it can pay a fee now)
  and `GET /status`. Both are unauthenticated and not rate-limited.

## `POST /gift-nft`

JSON body with **exactly one** recipient field (two are refused, never
resolved by precedence):

| Field | Form | Notes |
| --- | --- | --- |
| `name` | `"alice"` or `"alice.night"` | Label 1–32 chars: lowercase letters, digits, interior hyphens. Case and whitespace normalised. Resolved to the account. |
| `account` | 64 hex, the account contract address | What `profile.passportContract.address` gives you. `0x` and upper case accepted. Preferred when you have it. |
| `address` | `mn_shield-addr_stagenet1…` | For a Midnight wallet with no Passport. `mn_addr…` (unshielded) is refused. |

Optional: `item` (default `"genesis-pass"`), `amount` (1–100, **only** with
`address` and `otrix-loyalty`), `network` (if present, must be `"stagenet"`).

| `item` | Name | Colour (raw token type) | How often |
| --- | --- | --- | --- |
| `genesis-pass` (default) | Midnight Genesis Pass | `815183a74a98593bf16344ef6e920313f9c57ccb2feef3f9fe944ba5c4079e26` | once per recipient, ever; a repeat is `200` with `alreadyGiven: true` |
| `otrix-loyalty` | Otrix Loyalty Reward (`OTRIX`) | `d086a9e29154d03f507a589c89ea61a453f444c2881b8d0d88192f2965fa2cea` | once per request; a person may earn several |

Those are the only items. An unknown `item` is `400 unknown-item`. A new
partner item is a catalogue entry the Passport team adds; ask for one. An item
is a shielded token (a colour and an amount, no on-chain metadata); Passport
draws it from its own registry keyed on the colour.

```bash
curl -sS -X POST https://67-205-177-162.sslip.io/balancer/gift-nft \
  -H 'content-type: application/json' \
  -d '{"name":"alice.night","item":"otrix-loyalty"}'
```

## The response

`200` with, among others: `recipient` (`{ kind: 'account' | 'shielded-address', value }`),
`domain` (when asked by name), `account`, `item`, `symbol`, `name` (the item's
name, not the `.night` name), `colourHex`, `amount` (string), `mintTx`,
`depositTx` or `transferTx`, **`txHash`** (the transaction that delivered it;
read this one), `block` (or `null`), `held`, `alreadyGiven`, `at`.

- By `name`/`account`: `200` means the service saw the credit arrive before
  answering. `held` is present for an older Passport and **absent for a v5.0
  Passport** (its holdings are private); absence is not a failure.
- By `address`: `200` means the transfer was finalised by the node; there is no
  read-back.
- Explorer link for `txHash`: strip any `0x`, then
  `https://explorer.1am.xyz/tx/<64 hex>?network=stagenet`.

## Errors

Every error body is `{ "error": "<code>", "message": "<sentence you may show>" }`.

| Status | `error` | Do |
| --- | --- | --- |
| 400 | `invalid-request`, `invalid-account`, `invalid-name`, `invalid-address`, `unshielded-address`, `unknown-item`, `amount-not-allowed`, `invalid-amount`, `wrong-network` | fix the request; do not retry as is |
| 400 | `name-target-not-account` | the name points at a wallet, not a Passport account; ask for a shielded address |
| 400 | `recipient-not-sealable`, `account-not-activated` | the Passport is not fully set up; ask the user to finish, then retry. Nothing was spent |
| 401 | `unauthorised` | send `X-Passport-Key` |
| 404 | `name-not-registered`, `name-unbound` | no such Passport name (or not pointed yet) |
| 409 | `gift-in-flight` | the same item for the same recipient is already on its way; wait for the first request |
| 429 | `rate-limited`, `queue-full`, `PENDING_TRANSACTION` | wait `Retry-After` seconds or `retryAfterMs`, then retry |
| 501/503 | `account-custody-build-required`, `prover-unavailable`, `gift-unsupported`, `shielded-transfer-unsupported` | operator-side; nothing was spent; retrying will not help until the operator acts |
| 503 | `indexer-unreachable`, `name-resolution-unavailable`, `gift-failed` | retry later |
| 504 | `mint-not-spendable` | **not lost**; retry later, and the retry uses the coin already minted |
| 504 | `credit-not-seen` | both transactions were submitted (hashes in `message`); **do not** blindly retry `otrix-loyalty`, which would give a second; check first |

**Rate limit:** 3 requests per minute, burst 3, per calling IP, shared with the
service's other sponsored routes. Ask the Passport team, with your server's
address, if you need more. **Timing:** one to three minutes per gift (mint,
wait until spendable, deliver, read back); set your HTTP timeout to at least
five minutes and do not fire a second request while the first is in flight.

## Paying NIGHT or mUSD by name from a backend

There is no partner route for it. `/gift-nft` delivers catalogue items only.
The service's `/fund-account` (a fixed, once-per-Passport opening grant) and
`/swap` are Passport's own routes, not partner APIs. Do not call them.

## Resolving a `.night` name yourself

Usually unnecessary: send `{ "name": … }`. There is no public resolver HTTP
API. The walk the service makes (stagenet): read the `.night` registry contract
`29be1e64846cff4600c5297fa54b27d4c9296b3ccc2cdba190eaba1d64c5f116` from the
indexer `https://indexer.stagenet.shielded.tools/api/v4/graphql`; look up the
label (`alice`, UTF-8, left-aligned in 32 bytes, **padded with `0xff`**) in
`domains` to get the resolver contract; read that resolver's `DOMAIN_TARGET`,
an `Either<ContractAddress, Either<ZswapCoinPublicKey, UserAddress>>`, by its
tag. For a Passport it is the account contract address (use it as `account`,
never as a payment address). All zeros means unresolved.

## A backend handler to copy (Node 18+, Express)

Two rules shape it. A gift takes minutes, so answer the player at once and
deliver in the background. And `otrix-loyalty` is given on **every** request,
so the "one per quest" guarantee is yours: record the reward before sending,
and never re-send one whose outcome is unknown (your timeout, a dropped
connection, `409`, `504 credit-not-seen`).

```ts
import express from 'express';

const PARTNER_BASE = process.env.PASSPORT_PARTNER_URL ?? 'https://67-205-177-162.sslip.io/balancer';
const PARTNER_KEY = process.env.PASSPORT_PARTNER_KEY; // only if the Passport team issued one

type Recipient = { name: string } | { account: string };
type Outcome =
  | { kind: 'delivered'; txHash: string }
  | { kind: 'retry-later'; afterMs: number; message: string } // 429, 503 transient, 504 mint-not-spendable
  | { kind: 'rejected'; error: string; message: string }      // 4xx: fix the request or the recipient
  | { kind: 'unconfirmed'; message: string };                 // may have landed: check before any re-send

export async function giftItem(recipient: Recipient, item: 'genesis-pass' | 'otrix-loyalty'): Promise<Outcome> {
  let response: Response;
  try {
    response = await fetch(`${PARTNER_BASE}/gift-nft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(PARTNER_KEY ? { 'x-passport-key': PARTNER_KEY } : {}) },
      body: JSON.stringify({ ...recipient, item }),
      signal: AbortSignal.timeout(5 * 60_000), // a gift takes one to three minutes
    });
  } catch {
    return { kind: 'unconfirmed', message: 'No answer from the gift service; the item may still arrive.' };
  }
  const body = await response.json().catch(() => ({}));
  const error = String(body.error ?? '');
  const message = String(body.message ?? 'The gift was not delivered.');
  if (response.ok) return { kind: 'delivered', txHash: String(body.txHash ?? '').replace(/^0x/, '') };
  if (response.status === 409 || error === 'credit-not-seen') return { kind: 'unconfirmed', message };
  const retryable = response.status === 429 || error === 'mint-not-spendable' ||
    ['indexer-unreachable', 'name-resolution-unavailable', 'gift-failed'].includes(error);
  if (retryable) {
    const afterMs = typeof body.retryAfterMs === 'number' ? body.retryAfterMs : Number(response.headers.get('retry-after') ?? 30) * 1000;
    return { kind: 'retry-later', afterMs, message };
  }
  return { kind: 'rejected', error: error || String(response.status), message };
}

// Replace with a database table keyed on player + quest (UNIQUE), so a restart or a double submit cannot give twice.
const rewards = new Map<string, { status: 'sending' | Outcome['kind']; txHash?: string; message?: string }>();

const app = express();
app.use(express.json());

app.post('/quests/:questId/complete', (req, res) => {
  const player = res.locals.player as { id: string; passportAccount?: string; nightName?: string } | undefined; // from your session
  if (!player) return res.status(401).json({ message: 'Sign in first.' });
  const recipient: Recipient | null = player.passportAccount
    ? { account: player.passportAccount }                    // preferred: what Passport shared at sign-in
    : player.nightName ? { name: player.nightName } : null;
  if (!recipient) return res.status(422).json({ message: 'Link your Passport to receive rewards.' });

  const key = `${player.id}:${req.params.questId}`;
  const existing = rewards.get(key);
  if (existing) return res.status(existing.status === 'delivered' ? 200 : 202).json(existing);
  rewards.set(key, { status: 'sending' });

  void giftItem(recipient, 'otrix-loyalty').then((outcome) => {
    // retry-later: schedule another attempt after outcome.afterMs (one sender at a time; 3 requests a minute).
    // unconfirmed: never re-send by itself; check the hashes in the message on the explorer first.
    rewards.set(key, outcome.kind === 'delivered'
      ? { status: 'delivered', txHash: outcome.txHash }
      : { status: outcome.kind, message: outcome.message });
  });
  return res.status(202).json({ status: 'sending' });
});

app.get('/quests/:questId/reward', (req, res) => {
  const player = res.locals.player as { id: string } | undefined;
  res.json(rewards.get(`${player?.id}:${req.params.questId}`) ?? { status: 'none' });
});
```

Take the recipient from your own session, never from the request body.
Prefer `{ account }` when the user signed in through Passport and shared
`passportContract`: it skips name resolution and cannot hit a name that
points somewhere else. A v5.0 Passport shares its name as `alice`; either form
is accepted.
