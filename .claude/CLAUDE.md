# CLAUDE.md

You are an AGENT working on the Midnight Passport demo. You are assisting the engineers and researchers who build it — they are experts in their domain. Respond concisely.

## Project

**Midnight Passport — the demo**

This repository IS the Midnight Passport demo: the installable Passport client, the services it talks to, and the example applications that integrate with it. It is the repository the Midnight Foundation reviews and releases from, and `https://midnightpassport.com` is deployed from a published release here. It is not a planning workspace and it holds no plan documents — architecture, protocol drafts, and decision records live elsewhere.

Passport is the user-facing identity and wallet layer for the Midnight network: passkey onboarding, a wallet built in the browser tab from the WebAuthn PRF output, a `.night` name, and a shielded balance that can send and receive. Everything on screen is read from the chain or absent; nothing is simulated.

**Audience:** the Midnight Foundation, partner application developers, and the stakeholders who open the production link.

## Delivery rule (2026/09/15, non-negotiable)

One path, in this order, for every change — code, docs, sponsor, contracts — with no exceptions for size ("a one-line fix"), urgency ("the call is in an hour"), or who is asking (a partner, a stakeholder):

1. **Every change is a pull request** on `midnightntwrk/passport-demo`, the repository the Foundation reviews and releases from. No direct pushes to `main`. No deploy from a branch, a worktree, or a local build.
2. **Every pull request is reviewed and approved** before it is merged. The merge target is `main`.
3. **A release is cut from `main`** (`v<N> - YYYY/MM/DD`, with the ZK artefact bundle), and **that release is deployed to staging** (`https://staging.midnightpassport.com`). Staging never runs anything that is not a release cut from `main`.
4. **Staging is tested, and only when the change is confirmed working there is the same release deployed to production** (`https://midnightpassport.com`). The tests are the four gates below.

This is the sequence Hector set on 2026/09/15: open PRs → merge to `main` → release from `main` → deploy the release on staging → confirm on staging → deploy the same release on production.

Sponsor (droplet) changes take the same path: pull request → review → `main` → droplet. The droplet serves both environments, so a sponsor change is live for production the moment it is deployed; that is a reason for the review, not a reason to skip it.

If something is broken in production, the fix still enters at step 1. The only thing that may go to production without passing through staging is a rollback to the previous release.

**The old working repository (`midnightntwrk/passport`) is retired for pushes.** Its push URL is set to `DISABLED` and a `pre-push` hook refuses it, along with any direct push to `main`. Do not undo either. No release, tag, branch, or commit goes there.

## The two environments

Two environments, one direction of travel:

- **Production: `https://midnightpassport.com`** — the link stakeholders hold. It runs only a build that passed every gate on staging. Nothing is deployed there directly, ever, for any reason, including "it is a one-line fix".
- **Staging: `https://staging.midnightpassport.com`** (Vercel project `midnight-passport-staging`, team Webisoft) — every build lands here first, including experiments. Sponsor changes are deployed to the droplet before the build that needs them is promoted.

A build is promoted from staging to production only when all of these are true on staging:

1. `tsc`, the unit suites, `check-pwa`, and the mocked Playwright tier are green on the exact commit.
2. The live walk passes against staging: `RUN_LIVE=1 LIVE_URL=https://staging.midnightpassport.com npx playwright test e2e/stagenet.live.spec.ts --project=chromium`.
3. A **returning-browser** check passes: a browser or installed PWA that already held the previous build opens the new one and completes onboarding and a send. The automated walk is fresh-browser only and cannot see cache defects (2026/09/14: a year-long immutable cache on the contract manifest broke new-account setup for every returning reviewer while the walk passed).
4. A real-device walk on Android and iPhone of the three scoped flows: passkey onboarding, `.night` name, shielded balance with send and receive.

Every promotion is backed by a `v<N> - YYYY/MM/DD` release on **midnightntwrk/passport-demo** at the carried commit (the repository the Foundation watches), with the ZK artefact bundle attached, and mirrored on midnightntwrk/passport. Lockfiles are never regenerated from scratch: rebuild from the previous lock and diff the resolutions.

## Repository layout

- `examples/passport-demo/` — Passport itself. The installable PWA, the wallet, the whole user-facing flow. Dev server on **5175**, pinned with `strictPort`. Started with `npm run passport:demo` from the root (`npm run demo` is an alias).
- `examples/passport-balancer/` — the fee sponsor and name-registration service, and `contracts-stagenet/`, the stagenet contract build whose artefacts the demo ships. Runs on the droplet. Not a workspace of the root `package.json`.
- `packages/connect/` — the client library an integrating application imports to ask Passport for a profile or a payment.
- `demo-backend/` — the demo backend with connectors: encrypted private-state store, WebAuthn PRF key provider, and the profile and transaction wire protocols. File-linked, not published.
- `examples/passport-funder/` — self-hosted onboarding service. Registers `.night` names and drips activation-sized NIGHT. Port 8799.
- The partner and example applications — `examples/raffle-demo` (5177), `examples/passport-app-template` (5178), `examples/clubcoin-mock` (5181, the URL-callback connector), `examples/passport-profile-client` (5176), `examples/passport-app-hub` (5179), `examples/passport-docs` (5180).
- `docs/demo/` — the runbook, the deployment procedure, the partner API, and the drill write-ups. `docs/demo/runbook.md` is the walk-through; `docs/demo/deployment.md` is the release and deploy procedure.
- `scripts/` — the release and build tooling the workflows call: `tag-release.mjs`, `release-naming.mjs`, `build-vercel-output.mjs`, `fetch-zk-artefacts.mjs`.
- `.github/workflows/` — `verify-demo.yml` (the pull-request gates) and `deploy-demo.yml` (release → staging → production).

Not every directory under `examples/` is a workspace of the root `package.json`. The ones that are not install and run standalone from their own lockfiles; the `//workspaces` note in `package.json` says which and why.

## Key conventions

- British English. Oxford comma. Date format `YYYY/MM/DD`.
- Prefer "colour" not "color", "centre" not "center".
- **On-screen vocabulary.** The words below are how the machinery works, not what a person is doing, and none of them belongs in the interface a reviewer sees: *wallet address*, *DUST*, *contract*, *registry*, *indexer*, *resolver*, *sponsor*, *SDK*. Say what the person gets — a name, a balance, "sent", "ready". The same rule governs how we describe the demo in prose: it is a demo backend with connectors, integrations are *connectors* built case by case, and nothing here is an SDK. See `WHAT-THIS-IS.md`.
- Every dependency version at the root is exact and is resolution control rather than code — read the `//dependencies` note in `package.json` before touching one.
- Commits are signed (`.envrc` sets `commit.gpgSign` and points `core.hooksPath` at `.githooks`).

## What not to do

- **Do not deploy anything, to either environment, outside the Delivery rule above.** Not a one-line fix, not for a call in an hour, not for a partner.
- Do not push to `main`, and do not push anything to `midnightntwrk/passport` — it is retired for pushes, as the Delivery rule above sets out.
- Do not regenerate a lockfile from scratch. Rebuild it from the previous lock and diff the resolutions.
- Do not add a second copy of any Midnight package to the root resolution. `npm ls @midnight-ntwrk/compact-runtime` must report exactly one copy at the root with the demo deduped onto it.
- Do not commit the ZK artefacts (`keys/`, `zkir/`, `public/zk/`). They are ~97 MB, they ship as a release asset, and the workflows fetch and verify them against the tracked manifests.
- Do not treat a passing automated walk as a passing review: it is fresh-browser only. A returning browser and a real device are separate gates, and gate 3 exists because a cache defect passed everything else.
- Do not put anything on screen that is not read from the chain. A queued name is never shown as registered; a balance is read or absent, never substituted.
