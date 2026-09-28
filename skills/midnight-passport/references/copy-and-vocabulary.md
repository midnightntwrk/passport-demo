# Copy and vocabulary

For anything a user or a partner reads.

## Style

- British English ("colour", "authorise"), the Oxford comma, dates as
  `YYYY/MM/DD`, unless the host project already uses another convention.
- Sentence case for buttons and headings. Plain sentences; no exclamation
  marks, no "oops", no apologies.
- Every failure sentence says what happened to the user's data or money.

## Words

| Say | Not |
| --- | --- |
| Midnight Passport, Passport | the wallet, the extension, the provider |
| the Passport connect package, `@midnight-passport/connect` | the SDK, the Passport SDK |
| Continue with Passport | Connect wallet, Log in with wallet |
| your `.night` name | your domain, your ENS, your handle |
| item | NFT (fine when the partner uses it) |
| network fee covered | free, gasless, no fees |
| approve, decline | sign, reject |
| account | contract, smart contract, wallet address |
| sent | confirmed, final, complete (for a `submitted` payment) |

Avoid in user copy: wallet address, DUST, contract, registry, indexer,
resolver, sponsor, seed phrase, private key, gas.

## Money

- Atomic NIGHT on the wire (1 NIGHT = 1,000,000); show NIGHT to the user with
  the right decimals (`formatNight`).
- "Network fee covered" only for `sponsored === true` on `submitted`.
- `submitted` is "sent", not "confirmed".

## Honesty lines

- The user decides inside Passport; your app asks.
- Everything runs on Midnight stagenet; nothing here is mainnet.
- Passport is a demo: not audited, and not the final product.
