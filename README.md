# Midnight Passport demo

Passport is the user-facing identity and wallet layer for the Midnight
network. Onboarding is a passkey ceremony in the browser tab: the WebAuthn PRF
output becomes a 32-byte Midnight seed, the wallet is built in the browser, and
claiming a `.night` name deploys the account-custody contract that name
resolves to. There is no third-party wallet vendor in the flow.

This repository holds that demo, the services it talks to, and the example
applications that integrate with it. It is the repository the Midnight
Foundation reviews and releases from; `https://midnightpassport.com` is
deployed from a published release by `.github/workflows/deploy-demo.yml`.

Read [`WHAT-THIS-IS.md`](WHAT-THIS-IS.md) for what this demo is and is not.

## Run it

```sh
npm install
npm run passport:demo
```

Open `http://localhost:5175`. The port is pinned in the source with
`strictPort`, and the dev build redirects any other origin to it: Passport
frames apps by URL, and a handshake against a moving origin fails silently. Do
not substitute `127.0.0.1`. `npm run demo` is an alias for the same thing.

Every setting is optional — the defaults run against stagenet. Copy
`examples/passport-demo/.env.example` to `.env.local` to change any of them.
[`docs/demo/runbook.md`](docs/demo/runbook.md) is the full walk-through,
including the companion services and which of them you actually need.

## Layout

| Path | What it is | Port |
|---|---|---|
| `examples/passport-demo/` | Passport itself: the installable PWA, the wallet, the whole user-facing flow. | 5175 |
| `demo-backend/` | The demo backend with connectors — encrypted private-state store, WebAuthn PRF key provider, and the profile and transaction wire protocols. | — |
| `packages/connect/` | The client library an integrating application imports to ask Passport for a profile or a payment. | — |
| `examples/passport-balancer/` | The fee sponsor and name-registration service, plus the stagenet contract build everything else is verified against. | — |
| `examples/passport-funder/` | Self-hosted onboarding service: registers `.night` names and drips activation-sized NIGHT. | 8799 |
| `examples/raffle-demo/` | Example dApp: profile handshake plus a payment Passport signs. In the Apps grid by default. | 5177 |
| `examples/passport-app-template/` | The starter a third-party developer copies. | 5178 |
| `examples/clubcoin-mock/` | The URL-callback (redirect) connector example, for phones. | 5181 |
| `examples/passport-profile-client/` | The original separate-origin consent client, "Atlas". | 5176 |
| `examples/passport-app-hub/` | Public listing site for apps that integrate the bridge. | 5179 |
| `examples/passport-docs/` | The documentation site. | 5180 |
| `docs/demo/` | The runbook, the deployment procedure, the partner API, and the drill write-ups. | — |

Not every directory under `examples/` is a workspace of the root
`package.json`; the ones that are not install and run standalone, each from its
own lockfile. See the `//workspaces` note in `package.json`.

## Gates

`.github/workflows/verify-demo.yml` runs the typecheck, the unit suites, the
PWA checks, and the mocked Playwright tier on every pull request that touches
the demo. `.github/workflows/deploy-demo.yml` runs the same gates again before
it ships a release. Neither can be skipped for a deploy.

The promotion rule — pull request, review, `main`, release, staging, then
production — is in [`.claude/CLAUDE.md`](.claude/CLAUDE.md) and
[`docs/demo/deployment.md`](docs/demo/deployment.md).
