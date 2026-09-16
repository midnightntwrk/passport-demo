# Deploying the Passport demo

**The rule: only what is on `main` is deployed, a deploy is a published GitHub
release, and a release goes to STAGING.** Production is a separate, deliberate
promotion of a release that was confirmed on staging. Deploying by hand is
possible and is documented below, but it is not the normal path and it runs
none of the gates.

## What deploys, and where to

| | |
|---|---|
| Staging | <https://staging.midnightpassport.com> — every build lands here first, experiments included |
| Production | <https://midnightpassport.com> — the link stakeholders hold; only a build that passed every gate on staging |
| App | [`examples/passport-demo/`](../../examples/passport-demo/) |
| Vercel projects | `midnight-passport-staging` and `midnight-passport-app` (team Webisoft) |
| Workflow | [`.github/workflows/deploy-demo.yml`](../../.github/workflows/deploy-demo.yml) |
| Branch | `main`, and nothing else |
| Releases | `v<major>.<minor> - YYYY/MM/DD` on **this repository**, `midnightntwrk/passport-demo`. A fix moves the decimal, a feature the whole number |

Two triggers, and they are not interchangeable:

| Trigger | Where it goes |
|---|---|
| a published GitHub release | **staging** |
| `workflow_dispatch` with `target: production` and `release_tag` | **production** |
| `workflow_dispatch` with `target: staging` | staging |

The sibling services under `examples/` — `passport-balancer` and
`passport-funder` — are **not** part of this. They run on the droplet and are
shipped by rsync, as described in `examples/passport-balancer/README.md`. This
page is about the PWA on Vercel only. Sponsor changes are deployed to the
droplet **before** the build that needs them is promoted.

## The guards

The workflow refuses to run unless the commit being deployed is an **ancestor
of `origin/main`**, so a release cut from a feature branch cannot ship, however
it was tagged. It also refuses a ref that does not contain the demo, rather
than uploading an empty build over the live site.

A run that names `release_tag` **checks out that tag**, so a promotion builds
the immutable release rather than whatever the dispatch was started from. A
production promotion must additionally be dispatched *from* that tag — **Run
workflow → Use workflow from → Tags → `v<major>.<minor>`** — so the commit the run reports
is the commit it shipped.

The project ids are resolved before anything is built, from the pair belonging
to the target: a production deploy with `VERCEL_ORG_ID` or `VERCEL_PROJECT_ID`
unset fails by name rather than falling back to the staging project.

## Cutting a release

1. Land the change on `main` and let
   [`verify-demo.yml`](../../.github/workflows/verify-demo.yml) go green — on
   the pull request, and again on the merge.
2. Pack the ZK artefacts from a tree that has them (see below). The
   break-glass `scripts/tag-release.mjs` command does this automatically; use
   the following when creating the release directly:

   ```sh
   tar --zstd -cf passport-zk-artefacts.tar.zst \
     examples/passport-balancer/contracts-stagenet/managed/account/keys \
     examples/passport-balancer/contracts-stagenet/managed/account/zkir \
     examples/passport-balancer/contracts-stagenet/managed/midnames/keys \
     examples/passport-balancer/contracts-stagenet/managed/midnames/zkir
   ```

   **`account-k1` is not in that list, and a future release has to put it
   there.** The k1-arm build landed on 2026/09/16 with its `contract/` and
   `compiler/` halves tracked like every other build's, and with no artefacts
   in any bundle. Nothing in the app asks for the module yet, so nothing is
   broken by the gap: `prepare-zk-assets.mjs` stages the module, says the
   artefacts are absent, and serves nothing under `/zk/account-k1`;
   `verify-zk-artefacts.mjs` skips a contract that shipped neither `keys/` nor
   `zkir/`, by design. The moment a flow asks for that module, the bundle must
   carry `managed/account-k1/{keys,zkir}` and this pin must move to the release
   that does.

   **Measure before you add it.** `managed/account-k1/keys` is **3.2 GB** —
   thirty circuits against the account build's twelve, with the k256 arm's
   circuits far larger — where the whole bundle is 110 MB today. That is past
   what a Vercel deployment will accept, so adding it is a decision about where
   the artefacts are served from (`PASSPORT_ZK_ORIGIN`, `.vercelignore`) and not
   a line in a `tar` command.

3. Cut the release from `main` and attach that file. The tag is
   `v<major>.<minor>` — see [How it is numbered](#how-it-is-numbered-hector-20260915)
   — and the next one is `v1.0`:

   ```sh
   gh release create v1.0 --target main \
     --title 'v1.0 - 2026/09/15' \
     --notes 'What changed.' \
     passport-zk-artefacts.tar.zst
   ```

Publishing the release runs the gates and deploys **to staging**. The run
summary carries the deployment URL.

### Why the release carries a 97 MB attachment

`vite build` stages prover keys and ZKIR from
`examples/passport-balancer/contracts-stagenet/managed/*/{keys,zkir}`. Those two
directories are gitignored; the `contract/` and `compiler/` halves beside them
are tracked. A fresh checkout therefore stops at `prepare:zk` with
"the account build is incomplete — keys/ is missing".

They cannot be rebuilt *here*, which is not the same as not being reproducible.
The manifests name compiler **0.33.0-rc.2** and `compact list` offers 0.31.1
then 0.34.0, so this page used to say a rebuild was impossible. Measured on
2026/09/10 it is not: compactc 0.34.0 reproduces every one of these verifier
keys bit-identically. Nothing in this pipeline installs `compact`, though, so
the bundle still travels with the release — see
[`scripts/fetch-zk-artefacts.mjs`](../../scripts/fetch-zk-artefacts.mjs), which
makes the same point at length.

So the bundle travels with the release, and every file in it is checked against
the tracked `contract-manifest.json` by
[`verify-zk-artefacts.mjs`](../../.github/workflows/scripts/verify-zk-artefacts.mjs)
before anything is built. Bundles are cached by manifest hash, so only the first
run after a contract rebuild pays the download.

The attachment is no longer only CI's. `scripts/fetch-zk-artefacts.mjs`
downloads the same asset, pinned by sha256 in
[`scripts/zk-artefacts.lock.json`](../../scripts/zk-artefacts.lock.json) — see
[How a build gets artefacts it cannot compile](#how-a-build-gets-artefacts-it-cannot-compile).
So a release without the bundle breaks every path, and the lock file has to be
moved forward in the same commit that lands new manifests.

**The pin is what every run that names no release uses**, including
`verify-demo.yml` on a pull request and a `workflow_dispatch` with a blank
`release_tag`. Nothing resolves to "whatever is Latest": until 2026/09/15 both
workflows ran a bare `gh release download`, so a pull request was built against
a bundle nothing in the tree named, and against a different one the moment
somebody published.

## Promoting a release to production

Nothing reaches <https://midnightpassport.com> directly, ever, for any reason,
including "it is a one-line fix". A release is promoted only when all of these
are true **on staging**:

1. `tsc`, the unit suites, `check-pwa`, and the mocked Playwright tier are
   green on the exact commit.
2. The live walk passes against staging:
   `npm run test:e2e:live --workspace passport-demo` (which is
   `RUN_LIVE=1 LIVE_URL=https://staging.midnightpassport.com playwright test e2e/stagenet.live.spec.ts`).
3. A **returning-browser** check: a browser or installed PWA that already held
   the previous build opens the new one and completes onboarding and a send.
   The automated walk is fresh-browser only and cannot see cache defects — on
   2026/09/14 a year-long immutable cache on the contract manifest broke
   new-account setup for every returning reviewer while the walk passed.
4. A real-device walk on Android and iPhone of the three scoped flows: passkey
   onboarding, `.night` name, shielded balance with send and receive.

Then, from the release tag:

```sh
gh workflow run deploy-demo.yml --ref v1.0 -f target=production -f release_tag=v1.0
```

Every promotion is mirrored as a release on `midnightntwrk/passport` at the
carried commit, with the ZK artefact bundle attached.

## Secrets

Five repository secrets, set by whoever administers this repository
(**Settings → Secrets and variables → Actions**):

| Secret | Target | Where it comes from |
|---|---|---|
| `VERCEL_TOKEN` | both | Vercel → Account Settings → Tokens, scoped to the team that owns both projects. Not in this repository, and never printed by the workflow. |
| `VERCEL_ORG_ID` | production | `orgId` in `examples/passport-demo/.vercel/project.json` on a copy linked to `midnight-passport-app`. |
| `VERCEL_PROJECT_ID` | production | `projectId` in the same file. |
| `VERCEL_STAGING_ORG_ID` | staging | `orgId` on a copy linked to `midnight-passport-staging`. |
| `VERCEL_STAGING_PROJECT_ID` | staging | `projectId` in the same file. |

The four ids are not sensitive — `.vercel/` is gitignored, so the CLI is told
which project this is through the environment instead. They are secrets only so
that all five deploy inputs are managed in one place.

**The workflow names the missing one and stops.** It checks the pair belonging
to the target it was asked for, before installing or building anything. It used
to select them with `${{ ... && secrets.A || secrets.B }}`, where an unset
production secret is falsey and the expression quietly yields the *staging*
value — so the one mistake this most needs to catch deployed the build to
staging a second time and reported it as production.

To require a human approval before each production deploy, add a `production`
environment under **Settings → Environments** with required reviewers and a
`environment: production` line to the deploy job.

## Endpoint lists, and the one that is not like the others

Four of the app's endpoint variables take a **comma-separated, ordered list**
rather than a single URL. A single URL is a list of one and behaves exactly as
it always did, so nothing has to change to keep a deployment as it is. The
values the workflow passes in live in
[`deploy-demo.yml`](../../.github/workflows/deploy-demo.yml); the full reasoning
for each is in [`examples/passport-demo/.env.example`](../../examples/passport-demo/.env.example).

| Variable | What a second entry buys | When the next entry is tried |
|---|---|---|
| `VITE_MIDNIGHT_PROVING_URL` | a second prover | any refusal or failure, per request |
| `VITE_SPONSOR_URL` | a second fee sponsor | any refusal or failure, per request |
| `VITE_INDEXER_URL` | a second indexer | at wallet open, and on a stall |
| `VITE_FUNDER_URL` | a standby Passport service | **only** when the first did not answer |

The order is the operator's. Nothing reorders the list, load-balances across it,
or remembers a winner between calls, so failover can be proved by writing the
list the other way round. A failover writes one `console.info` line naming the
endpoint index it moved to; no wording the reader sees changes, and no endpoint
name reaches a screen.

### `VITE_FUNDER_URL` — a refusal is an answer

`/register-alias` and `/fund-account` **spend**, and a standby Passport service
is a different wallet: its own NIGHT, its own DUST, and its own once-per-account
record of who it has funded. So this list is fallen through **only when the
service did not answer at all** — no socket, a timed-out round trip, or a
`502`/`503`/`504` whose body carries no service JSON, which is the page a
reverse proxy sends when the process behind it is down.

Everything else stops the walk, because it is the service speaking for itself: a
`2xx`, any `4xx` including `429`, a `500` (that came out of the service's own
process, which may therefore have acted before it fell over), and a `503`
carrying a JSON code such as `wallet-syncing`, `INSUFFICIENT_DUST`, or `PAUSED`.
The reader is shown that refusal exactly as they are shown one service's refusal
today. A standby asked behind a refusal would register the same name from a
second wallet — surfacing as `name-taken` for a name that is in fact theirs — or
grant the activation a second time.

**One double grant remains possible and cannot be closed from the browser:** the
first service acted and its answer was lost coming back. That is bounded rather
than prevented, by checks that were already in place — the per-contract funding
marker read before every attempt and after every backoff wait, the service's own
`already-funded` answer counting as a success, the hold that stops a grant while
a name is unclaimed, and the account contract's own balance mirror, which makes
a second grant visible and spendable rather than lost. Two services can over-fund
one demo account; they cannot under-fund one or leave a Passport without a name.

`GET /status` is a read, so the sponsorship probe and the stablecoin colour
simply take the first service that answers.

### `VITE_INDEXER_URL` — chosen at open, replaced on a stall

The indexer is not chosen per request. The wallet SDK is handed one indexer
connection when a wallet is opened and holds it for that wallet's life, so:

- **at open**, each endpoint is asked a one-block-height query with a
  four-second ceiling and the wallet is built against the first that answers. A
  list of one skips the probe.
- **on a stall** — a dropped connection, or a sync percentage that has not moved
  for ninety seconds — the wallet is **rebuilt** against the next endpoint from
  the seed already stored, which is the same rebuild a silent session restore
  performs. It resumes from the saved sync snapshot rather than walking the chain
  again. The list is rotated rather than truncated, so a restarted primary is
  picked up again without a redeploy, and rebuilds in one session are capped at
  the length of the list.

`VITE_INDEXER_WS_URL`, where it is set, follows the HTTP list position by
position rather than being a list in its own right — an indexer is one host
reached two ways. An override shorter than the HTTP list covers the endpoints it
reaches and the rest derive theirs, so adding a second indexer is a one-variable
change.

## Rolling back

Roll back in Vercel; do not deploy an older commit.

```sh
cd examples/passport-demo
vercel ls midnight-passport-app          # find the last good deployment URL
vercel promote <deployment-url>          # make it production again
```

Or in the dashboard: **midnight-passport-app → Deployments → … → Promote to
Production**. Then fix forward on `main`, cut a new release, confirm it on
staging, and promote that; a Vercel rollback is not a state `main` knows about.

## Deploying by hand

One command reaches a site without GitHub Actions. It runs **no gates** — no
typecheck, no tests, no PWA check, no end-to-end run — and it ships whatever is
in the working tree, including uncommitted changes. That is precisely the
incoherence between `main` and what is live that this page exists to end, so if
you use it, say so in the pull request or the channel and cut a release from
`main` afterwards so the two agree again.

### Only prebuilt deploys are supported

**`vercel --prod` from the repository root — a remote build — does not work,
and this page used to say it did.** The Vercel project's `buildCommand` was
`npm run vercel-build` in `examples/passport-demo/package.json`, which ran
`cd ../.. && npm run build:passport:remote`; there has never been a
`build:passport:remote` script in the root `package.json`, so any remote build
stopped at `Missing script`. Both have been removed (2026/09/15) rather than
left as an instruction that cannot be followed.

Everything that deploys today is **prebuilt**: the workflow and
`deploy:passport:manual` both build locally, assemble a Build Output API
directory with `scripts/build-vercel-output.mjs`, and upload it with
`vercel deploy --prebuilt`. A prebuilt upload has no build step for the project
settings to apply to. Restoring the remote path means adding the root script
the workflow's own build steps describe (`prepare:zk`, `build`,
`build-vercel-output`) and putting `buildCommand` back in the same change.

The Vercel projects still carry the settings below, which matter to anything
that does build remotely and to the reader trying to understand the project:

| Setting | Value | Why |
|---|---|---|
| Root Directory | `examples/passport-demo` | Where the app and its `vercel.json` live. |
| Include source files outside of the Root Directory | on | The build reaches `examples/passport-balancer`, `demo-backend`, `packages/connect`, and the root lockfile — none of which are under the app. |
| Automatically expose System Environment Variables | **off** | See below. It has to be off, and the reason is the service worker. |

**Why system environment variables are off.** With it on, Vercel injects
`VITE_VERCEL_DEPLOYMENT_ID`, `VITE_VERCEL_URL`, and a dozen more into the build,
and because this app reads `import.meta.env` as an object in several places,
Vite inlines the whole record into the main chunk. Two of those values are
unique per deployment, so `main-*.js` — a content hash — changed on every build,
and with it the service-worker `BUILD_ID`, which is a digest of the emitted
asset filenames. That is exactly the "a rebuild with no source change stamps the
same id" property `stampServiceWorkerBuildId` in
[`vite.config.ts`](../../examples/passport-demo/vite.config.ts) exists to hold:
without it every deploy installs a new worker on every client whether or not the
client changed. Nothing in the app reads a `VITE_VERCEL_*` value, and turning
the setting off also stops the project and deployment ids being compiled into a
public bundle. Measured both ways on 2026/09/08: with it on, two consecutive
builds of one tree gave `187b9233…` and `9103d568…`; with it off, both gave
`bfad1f8e87ebcfb2` and identical asset hashes.

`examples/passport-demo/vercel.json` names the rest: `installCommand`
(`cd ../.. && npm ci`) and `outputDirectory` (`dist`). The root `.vercelignore`
decides what is uploaded — a deny list, so a new workspace is included by
default, and it deliberately withholds every generated ZK tree so that what
ships does not depend on what a laptop happens to have built. Its rules are
.gitignore syntax, where a bare name matches at every level, so anything meant
to name one directory at the root is written with a leading slash.

The `VITE_*` values a remote build would compile in come from the **project's
Environment Variables**, not from this repository — a builder cannot see
`package.json`'s script line or `deploy-demo.yml`'s `env:` block. `vercel env ls`
reads them back; they are the same five values as those two copies, and all
three change together.

#### How a build gets artefacts it cannot compile

`node scripts/fetch-zk-artefacts.mjs` runs first. It downloads the
`passport-zk-artefacts.tar.zst` asset named by
[`scripts/zk-artefacts.lock.json`](../../scripts/zk-artefacts.lock.json), which
pins the release tag, the sha256, and the byte length; the repository is public,
so the download needs no token. Nothing is extracted until the digest matches.
It then runs the same
[`verify-zk-artefacts.mjs`](../../.github/workflows/scripts/verify-zk-artefacts.mjs)
the workflow does, so every file is checked against the tracked
`compiler/contract-manifest.json` before a build starts. It is idempotent: a
tree that already matches the manifests is left alone and nothing is downloaded.

**Compiling instead was ruled out, and not because a builder is limited.** The
manifests name compactc **0.33.0-rc.2**, and no such release exists in
`midnightntwrk/compact` — the published set goes 0.31.1 then 0.34.0, and the
`compact` CLI's own artefact list offers no 0.33.x for any of `x86_macos`,
`aarch64_macos`, `x86_linux`, or `aarch64_linux` (re-checked against the GitHub
releases API on 2026/09/08). A different compiler is a different verifier key,
and the contract deployed on stagenet knows only the key it was deployed with.

**The integrity check is not optional and does not stop at the build.**
midnight-js 5 verifies every artefact the PWA fetches against
`compiler/contract-manifest.json`, and its integrity mode defaults to `require`
— fail-closed. A PWA that shipped an unverified tree would throw
`ZkArtifactIntegrityError` on the first prove rather than quietly proving with
the wrong key. So the pin is the supply chain, the manifests are the
correctness, and the browser checks the same manifests again at run time.

**When the contracts are rebuilt**, attach the new bundle to the release and
update `tag`, `sha256`, and `bytes` in `scripts/zk-artefacts.lock.json` in the
same commit that lands the new manifests. A stale pin fails at the manifest
check, loudly, before anything is built.

### `npm run deploy:passport:manual` — the fallback

Builds locally and uploads the finished output with `vercel deploy --prebuilt`,
which is the only way anything has ever reached a site from a laptop here. Use
it when the workflow cannot get the artefacts — the pinned release asset is
gone, the upstream parameter bucket is down — or when what you are shipping is
not a tree any release describes.

```sh
npm run deploy:passport:manual
```

It fetches and verifies the pinned artefacts first (so it works on a fresh
clone), builds, assembles a Build Output API directory with
`scripts/build-vercel-output.mjs`, uploads it from `examples/passport-demo`, and
ends by cutting the release tag. That directory needs its own one-off link:

```sh
cd examples/passport-demo
vercel link --scope dominion-webisoft --project midnight-passport-app --yes
rm -f .env.local .gitignore     # both written by `link`; neither is wanted here
```

The prebuilt upload is unaffected by the Root Directory setting — there is no
build step for it to apply to — and `scripts/build-vercel-output.mjs` reads only
`headers` and `rewrites` out of `vercel.json`, so the build settings added there
change nothing about what it emits. Both were confirmed by preview deployment on
2026/09/08.

## Every deploy is backed by a release

Every production deploy must be backed by a GitHub release (Hector, 2026/09/03: "nothing fancy, just the release tag"). **Releases are cut on this repository, `midnightntwrk/passport-demo`** — the one the Foundation watches — and mirrored onto `midnightntwrk/passport` at the carried commit. `deploy:passport:manual` ends by running `scripts/tag-release.mjs`, which reads the service-worker build id from `examples/passport-demo/dist/sw.js`, refuses a dirty tree, verifies and packages the pinned ZK artefacts, and creates the release targeting the deployed commit; pass `--repo` for the mirror. A published release without that bundle is invalid: GitHub makes published releases immutable, so it must be superseded by a new release that includes the artefact.

### How it is numbered (Hector, 2026/09/15)

The release is tagged `v<major>.<minor>`, and **the next release is `v1.0`** — the count starts again, deliberately. After that:

- **a patch or a bug fix moves the decimal**: v1.0 → v1.1 → v1.2 (`--kind fix`, the default);
- **a new feature moves the whole number, and the decimal resets**: v1.2 → v2.0 (`--kind feature`).

The title is `v<major>.<minor> - YYYY/MM/DD` (UTC). The number is derived from both sources of truth — the tag refs (`git ls-remote --tags`) and the releases (`gh release list`) — so a tag pushed without a release, or a release whose tag was deleted, still counts.

**The undotted `v1`–`v16` are history and are ignored.** They stay where they are and the builds they carry are still downloadable, but only `v<major>.<minor>` names take part in deriving the next number, which is what makes the next release `v1.0` rather than `v17.0`. They decide exactly one thing: with no dotted release yet, the release the notes delta is taken against is `v16`, so `v1.0`'s body is what has changed since `v16` rather than the whole cumulative file.

The body opens with the build id, the commit, and the production URL, then carries the entries of `RELEASE-NOTES.md`'s "## Fixed" section that were not already there at the previous release (`PASSPORT_RELEASE_NOTES` appends a gate summary).

**It is not a pre-release** (changed 2026/09/07). It used to be, and that was the bug: GitHub never shows a pre-release as "Latest", so a reviewer reading the repository front page saw a three-day-old release and concluded nothing had shipped since. The naming rule is Hector's, from the same review that it replaced.

It is idempotent for a **commit and build**: re-running the same release is reported rather than released twice. A later gate-only commit may carry identical PWA bytes after an immutable release failed before deployment, and it receives a replacement release instead of being trapped behind the old build id. It verifies that a same-commit release has the ZK bundle; if it does not, it stops rather than claiming the immutable release was repaired. `--dry-run` prints the tag it would create and the `gh` command, without creating anything. The derivation of the number and the title is unit-tested — `npm run test:release-naming`.

Options, for releasing something other than "what was just built here":

| Option | What it is for |
| --- | --- |
| `--repo <owner/name>` | The repository to release in. Default `midnightntwrk/passport-demo`, this one (or `PASSPORT_RELEASE_REPO`). Pass `midnightntwrk/passport` for the mirror, so the same deploy is released the same way in both places. |
| `--commit <sha>` | The commit the release points at. Default HEAD. The carried commit has a different sha in `passport-demo`, and an older deploy is no longer at HEAD. Naming it also makes the notes come from THAT commit's `RELEASE-NOTES.md`, so the release says what that build shipped rather than what has been fixed since. |
| `--build-id <id>` | The service-worker build id, when `dist/` has moved on — mirroring into `passport-demo`, or filling in a release after the fact. Default: read from the stamped `dist/sw.js`. |
| `--kind fix\|feature` | What this release carries, and so which part of the number moves. `fix` (the default) takes the decimal up one; `feature` takes the whole number up one and resets the decimal. Neither applies to `v1.0`, which is the first release of the scheme either way. |

The mirror of a deploy into `passport-demo` is run from a **checkout of `passport-demo`**, after the carry — the carried commit only exists there, and the script resolves `--commit` against the repository it is run in (which is also where it reads that commit's `RELEASE-NOTES.md`). The carry brings the script itself along, so it is already present:

```sh
cd <a clean checkout of midnightntwrk/passport-demo, at the carried branch>
node scripts/tag-release.mjs --repo midnightntwrk/passport-demo \
  --commit <the carried commit> --build-id <the deployed build id>
```

Only deploys get releases. A build that was never uploaded does not get one, however tempting the round number.
