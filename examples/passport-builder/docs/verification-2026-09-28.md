# Stage-net verification — 2026/09/28

The builder uses `openai/gpt-6-luna-pro:nitro` for code and `meta/muse-image`
for raster assets. Both were exercised against the configured OpenRouter account.
Credentials remain server-side.

## Generated application

[Night Garden](https://builder.midnightpassport.com/apps/01a3fc1e-9467-4c1e-a06c-b10d6d17a385)
was generated from a seed-exchange brief, with a four-circuit Compact contract,
React interface, and one Muse illustration. After transport and repair-context
fixes, one generation completed without a repair, compiled, generated the image,
deployed, and queried the public ledger in 116 seconds.

- Contract: `82fa7422cba3dcb2dae22ba8053ff62decc70b84b71b4598bd611b9cf49697dc`
- Deployment identifier: `003e52f8d25304d6b1e4659ab55e600eb2e897a24eba48da57265246bd053980cd`
- Compact: 0.34.0; source hash `50af4d082868309ec65ade23f982357f27cfd319dc86a89b62d665036af87475`
- Circuits: `createOffer`, `reserveOffer`, `completeOffer`, `removeOffer`
- Muse asset hash: `338001b0ec8f81637afbd0c0bdb753db7b655e7090fda277a3bf55e6bea9196f`

A visual review found a contrast issue between light cards and the shared dark
shell. A CSS-only revision corrected the colours, reused the cached image and
existing contract, and retained its state. Generation guidance now explicitly
documents the shared theme tokens and foreground/background pairing.

## Actual chain writes

These were explicit operator calls to the permissionless test contract, with no
asset transfers. Each prepared transaction passed Passport's ledger inspection,
was sponsored by the stage-net service, and was checked for indexed `SUCCESS`
and the expected address/circuit. They do **not** establish that a user's passkey
ceremony or the canonical Passport site's approval flow has passed.

| Action | Block | Transaction identifier | Observed ledger |
| --- | --- | --- | --- |
| Create | 663276 | `00b20ce7f5782e9d441ead734326b330db0f3550c5acde45b1ec3d99edc2b0e023` | Offer present, status 0 |
| Reserve | 663291 | `0047d267de871653cbd370d63f4c95cf42aaaf8739fb28b7604e9fb85c10cd26c2` | Same offer, status 1 |
| Complete | 663298 | `006bb27465835040326e2b8779fdea33351d868aaadf176bab3caa814d44b57a6d` | Same offer, status 2 |
| Remove | 663314 | `0051d8f9aca7a1265da6d34c9efd7d249d40b60c32fd3fb23d318ac664e78b843d` | Offer absent, empty map |

The complete call encountered an indexer outage after submission. Reconciliation
used its saved identifier and confirmed the original transaction without another
submission.

The old Field Kit test record was also deleted successfully after the sponsor
fee-selection fix, at block 663220, identifier
`002b6c68d7223b9aca96c8c2b3988e143e17acc7a66753df2a7e2b112220453c00`.
A fresh ledger query returned an empty records map.

## Automated checks and remaining release boundary

- Builder: 111 tests passed; four opt-in real-compiler tests skipped. The live
  application above exercised compilation, proving, deployment, and reads.
- Passport: 3,427 tests passed; the explicit pure-helper coverage denominator
  passed at 100%. Typecheck, production build, and all 84 PWA checks passed.
- Connect SDK: 173 tests passed, including receiver remount recovery.
- Sponsor: 895 passed, one skipped; typecheck passed.
- Browser: signed-out builder gate, published app rendering, generated image,
  and real public ledger reads checked.
- Release artefacts: the v5.0 archive passed its pinned SHA-256 and size checks;
  all 182 files across account, account-custody, and midnames matched the tracked
  manifests. The production build and 84 PWA checks passed with this bundle.
  Required contract checks prevent an older warm cache from omitting custody.

The builder and sponsor changes are deployed. Production build requests now
require the deployed Passport capability manifest; an unavailable approval receiver
blocks generation before spending tokens. Existing apps retain public ledger reads
and explicitly show the pending Passport release instead of claiming usable writes. The canonical Passport site needs
this branch's custody profile bridge and `contract-tx/v1` approval receiver.
The repository requires main → release → staging → promotion, including live,
returning-browser, and real-device checks. Those release/device checks and a
user-approved dApp call remain necessary before claiming production end-to-end
readiness. The supported app scope is public-state, witness-free, permissionless
contracts without asset transfers; essential unsupported capabilities stop
publication instead of producing a fake substitute.
