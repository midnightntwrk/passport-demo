# Midnight Passport Builder

Describe an application, generate its React interface and Compact contract with
OpenRouter, compile and repair it, then deploy it to **Midnight stage-net**.
Every app includes the maintained Passport onboarding and transaction runtime.
Passport sign-in protects each user’s workspace. This first release supports public-state applications.
Coding uses `openai/gpt-6-luna-pro:nitro`; image assets use `meta/muse-image`.
Both routes were verified against OpenRouter on 2026/09/28. Generation
guidance includes idea-specific layouts, responsive typography and spacing,
keyboard access, and clear preview, approval, submitted, and error states.
Generation uses compiler-verified registry and lifecycle patterns as syntax
references, adapting records and actions to the requested idea. Repairs preserve
the requested behaviour instead of replacing it with a counter.
The OpenRouter credential is read only from the service environment.

The workflow follows [LlamaCoder](https://github.com/Nutlope/llamacoder) and the
local `1am-build` reference. Their network implementation is **not reused**:
the chain worker uses this repository's ledger-9 stage-net stack. There is no
preview, preprod, or mainnet fallback.

Production checks the deployed Passport capability manifest before starting a build.
A configured wallet URL alone is not evidence that approvals work. Essential
unsupported product features stop generation instead of becoming mocked substitutes.

The generation harness includes the Passport agent skill from PR #118, pinned
at `00711e045ef641a13f7f67b9f22144379cf41039` and checked against its SHA-256.
The local capability overlay documents this branch's contract transaction extension;
stock Passport v5.0 does not provide it. The Passport changes must be released
through the repository's staging and production promotion workflow before the
public builder's sign-in and arbitrary Compact approvals can work end to end.

Generated apps can request up to two raster images and render them through
`@midnight-passport/assets`. Images are generated alongside Compact compilation,
cached by model/prompt/composition, and retained on the persistent volume. An
interrupted paid request is not repeated automatically; the UI uses a placeholder
if an image is unavailable. No API credentials or provider URLs enter generated code.

The runtime saves a transaction identifier before opening Passport. Closing the
popup, losing a reply, or reloading the app preserves an unresolved request and
blocks another write until confirmation or explicit user review. Only indexed
execution establishes success. Daily generation allowances and the registry survive
service restarts; provider failures do not consume compiler-repair attempts.

## Run locally

From this directory, with Node 22.16 or later:

```sh
npm install
cp .env.example .env
# Set OPENROUTER_API_KEY in .env; keep it out of the browser.
compact update 0.34.0
npm run dev
```

Open `http://localhost:5188`. The API runs on `http://localhost:5189`.
Passport sign-in is required by default. Set `BUILDER_DEV_MODE=true` in `.env`
to bypass it explicitly on loopback hosts during local development. Production
refuses to start with this flag enabled.
The API’s counter template can exercise compilation without calling a model. Generated
apps and their contracts are real; unavailable services produce visible errors.

The default Passport origin is `https://midnightpassport.com`, shared by sign-in
and contract approvals so users keep the same account and passkey. To develop
Passport itself, run it at `http://localhost:5175` on stage-net and set
`PASSPORT_ORIGIN` and any `PASSPORT_AUTH_ORIGIN` override to that same origin.
A passkey for another origin does not automatically work locally. Production
refuses mismatched sign-in and transaction origins.

## What works

1. Sign in with Midnight Passport, then describe the app you want to build.
   OpenRouter returns only the files that need changing. The service resolves a
   complete `contract.compact`, `src/App.tsx`, and `src/styles.css` from the
   selected starter or the existing app; omitted files are preserved.
2. Watch the actual Compact, React, and CSS source arrive in the live code view.
   Incoming text is read-only until the full response validates. The service
   then bundles React and compiles Compact **with proving keys**, in parallel. Up to
   two repair attempts use actual compiler errors.
3. Review the source or preview. Save edits and recompile. Compilation pins
   the source hash, compiler version, circuit metadata, and every artefact hash.
4. Deployment follows automatically. The service proves the deployment, asks the stage-net
   sponsor to balance it, persists the transaction, and submits it to stage-net.
   Submitted and indexed confirmation are recorded separately. A ledger query
   verifies readiness; the builder then loads the confirmed deployment with its
   address inside the workspace. Frontend-only changes reuse a verified matching
   contract and retain its records. Contract changes create a separate deployment;
   older published URLs remain available and data is not automatically migrated.
5. Connect Passport in the app. Passport handles profile consent and onboarding. Contract
   actions are proved by the service, then decoded, checked, approved, signed,
   balanced, and submitted on Passport's own surface. The runtime checks indexed
   execution and refreshes ledger data after confirmation. Signing remains an
   explicit user action; writes are never automatically resent.

For two-field directories and catalogues, the model can select `base: "crud"`.
This supplies a tested records Map and create/update/delete circuits. A small
`CrudApp` configuration supplies forms, public ledger reads, Passport connection,
transaction states, and shared styling. Both text fields support up to 32 UTF-8
bytes; anyone may modify records. Custom schemas and lifecycle rules still need
their own compatible contract and interface. Existing apps cannot select a new
base implicitly, so a styling edit cannot reset their contract.

The exact maintained CRUD source also reuses verified compiler artefacts from
the persistent volume. Concurrent builds share compilation, then receive separate
copies; app metadata, maintenance keys, and deployment journals remain separate.
Changed contracts compile normally. Generation logs record the actual response
size in UTF-8 bytes and the number of supplied or reused files; these are not
estimates of billable model tokens.

`@midnight-passport/ui` provides the maintained `CrudApp`, `AppShell`, `Button`,
`Field`, and `Status` components. Shared styles are bundled with that module;
generated CSS can be empty or contain only custom rules. These helpers are
optional, and existing custom app styling remains unchanged.

The first release supports witness-free contracts with an empty constructor
and public-state circuits taking integers, booleans, or fixed-length bytes.
No token movement, user secrets, private witnesses, multi-contract calls, or
contract-specific identity proofs are generated. A profile is not proof of
on-chain authorship. Public polls permit repeat votes unless the contract
explicitly enforces something stronger. Unsupported ideas are identified in
the generated app description rather than represented as working features.

Public ledgers can contain keyed Maps, Sets, Lists, named structs, and enums. The
runtime serialises Maps as `{entries: [[key, value]], size: string, truncated:
boolean}` and Sets/Lists as `{values: [value], size: string, truncated: boolean}`,
returning at most 200 entries per collection. Integers become decimal strings,
bytes become hex strings, and enums become numeric variant indices. Nested
collection-valued Maps cannot currently be enumerated. Generated apps must
show truncation and must not treat a caller-supplied identifier as ownership.

## Services and persistence

One Railway project can contain the builder and a persistent volume. The
builder provides web UI, API, bounded compiler/chain child processes, app
hosting, and registry. Existing stage-net prover and sponsor are configured
upstream services. They are checked when operations run; configured does not
mean healthy or unlimited capacity.

- `GET /health` — process health.
- `GET /api/config` — public configuration, without credentials.
- `/api/auth/{start,finish,session,logout}` — signed Passport sign-in and revocable sessions.
- `/api/projects` — Passport session and ownership protected projects, revisions,
  compilation, deployment, and exports.
- `GET /api/projects/:id/generation` — authenticated NDJSON source stream: a full
  snapshot on connect, coalesced file patches, heartbeats, errors, and explicit end.
  Disconnecting the viewer leaves the build running. Reconnects receive the latest
  snapshot. Streamed drafts are never executed or compiled before full validation.
- `GET /api/registry` — confirmed applications in a public registry feed.
- `/apps/:id?deployment=:deploymentId` — immutable published build.
- `/api/runtime/:id/{prepare,ledger}` — bounded public application operations.
- `/api/runtime/:id/transaction?deployment=:id&txId=:identifier` — indexed
  execution status checked against the immutable deployment's address/circuits.
  Unavailable indexing remains an explicit error, not an invented transaction
  failure. The maintained host tracks only its own Passport submissions.

`BUILDER_DATA_DIR` contains SQLite in WAL mode, immutable build directories,
binary proving artefacts, a preview-link signing key, deployment journals, and
`auth.sqlite` for sign-in challenges, replay protection, and hashed session tokens.
Mount it at `/data` on Railway and run **one replica**. Set `RAILWAY_RUN_UID=0`
for the volume initialisation entrypoint; it fixes ownership and immediately drops
the API, compiler, and workers to uid 1000. The image defaults to the unprivileged
`node` user. This handles [Railway volume ownership](https://docs.railway.com/volumes#permissions)
without running the service as root. Back up the whole volume,
including SQLite WAL files, or use SQLite's backup mechanism. Each deployment
also persists its maintenance key privately; no user wallet seed is required.
An interrupted deployment is reconciled from its saved transaction rather than
creating another contract. Do not delete a pending journal to force a retry.

Generated React code executes only in an opaque-origin iframe with a restrictive
CSP. It cannot read the builder token, make network calls, import arbitrary
packages, or execute server-side code. A maintained host uses the real
`@midnight-passport/connect` SDK and validates messages from its exact frame.
The compiler and chain workers receive only their necessary configuration.

Sign-in verifies Passport’s signed redirect response against a short-lived,
browser-bound challenge, the actual builder origin, freshness, and a one-time
nonce. The verified signing key fingerprint determines project ownership;
profile names and claimed contract addresses grant no permissions. Seven-day
HttpOnly sessions persist across reloads and can be revoked by signing out.
The signed callback fragment is scrubbed from browser history immediately.

Normal users need no operator token. An optional `BUILDER_ACCESS_TOKEN` grants
an already signed-in operator access to legacy/shared projects. The token never
bypasses Passport sign-in in production. Existing projects without an owner
require this operator access; their deployed applications remain public.
This release does not implement per-user billing or a distributed job queue. Do not scale replicas against the
same SQLite volume. Public proof endpoints have per-app/IP limits and a global
concurrency limit, but a public launch needs a service budget policy.

## Railway

The running project has two services:

- [Builder](https://builder.midnightpassport.com) — web, API, compiler,
  chain workers, application hosting, and persistent registry at `/data`.
- [Legacy isolated signer](https://passport-signer-production.up.railway.app) —
  retained for isolated testing; the public builder uses normal Passport.

The [Railway builder domain](https://builder-production-14ef.up.railway.app)
remains available as a working fallback.

Builder sign-in, generated-app connections, and contract approvals all use
`https://midnightpassport.com`. This branch adds the
`org.midnight.passport.contract-tx/v1` approval receiver to Passport; it requires
the normal Passport release process before becoming available at that origin. Users reuse their
existing account and passkey. Production refuses different sign-in and
transaction origins. Blockchain operations use the existing stage-net prover
and sponsor.
The optional operator token is kept in the gitignored local
`data/railway-access.json` and Railway variables; it is never embedded in an app.

Use the repository root as Docker context and
`examples/passport-builder/Dockerfile` as the Dockerfile. The image compiles the
local SDK and frontend and installs Compact 0.34.0. Set `NODE_ENV=production`,
`BUILDER_DATA_DIR=/data`, `BUILDER_DEV_MODE=false`, `OPENROUTER_API_KEY`,
stage-net URLs from `.env.example`, `PASSPORT_AUTH_ORIGIN`, and the updated
`PASSPORT_ORIGIN`. Optionally set a random `BUILDER_ACCESS_TOKEN` of at least 32
characters for operator access. Mount a volume at `/data`; use `/health` for health checks.
`BUILDER_PUBLIC_URL` is the HTTPS Railway domain. `BUILDER_ALLOWED_ORIGINS`
adds comma-separated trusted domains, including `https://builder.midnightpassport.com`.
Callbacks and generated app URLs use the domain serving each request, so the
custom domain and Railway fallback both work with their own sign-in audience.

The custom domain is live on the builder service (port 3001). DNS, valid HTTPS,
and the configuration, auth-session, and public-registry endpoints were verified
on 2026/09/14. These records in the `midnightpassport.com` DNS zone are retained
for reference:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `builder` | `7ccd5ck7.up.railway.app` |
| TXT | `_railway-verify.builder` | `railway-verify=2ac13c1a1dd7a18af51427c51dbdc8254427d9d146586cf4f4956e5211b5285a` |

No secrets or local build data are copied into the image. The root
`.dockerignore` allows only this service, `packages/connect`, and the pinned Passport skill.

`node scripts/package-builder.mjs` produces a minimal upload directory.
Deploy the resulting directory with explicit Railway project, environment, and
service IDs, using that directory as the CLI working directory. Passport changes
follow [the canonical release workflow](../../docs/demo/deployment.md); do not
create a second Passport origin for normal users.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

The initial live drill on 2026/09/14 compiled with Compact 0.34.0, deployed a
counter at stage-net block `460294`, read `count = 0`, and generated an increment
proof accepted by Passport's transaction decoder. Address:
`477cc4f5f3724021f4bbb91065821f52eb2488fd20e54745b5d799190a5d6f4e`.
The real transaction fixture also tests swapped address/circuit, expiry,
excessive lifetime, and truncated bytes. A real user must still complete
Passport's passkey and consent steps; automated tests do not replace that.

The live Railway workflow was also verified with `~openai/gpt-sol-latest` on
2026/09/14. It generated revision 2 of
[Night Vote](https://builder.midnightpassport.com/apps/9c4c7cba-c6f5-4340-ac51-e90ea9763ad6?deployment=dae9678a-554c-4934-abaf-87281a06fd20),
compiled `voteCleanup` and `voteGarden` with proving keys on its first attempt,
and deployed to stage-net block `460527`. The contract address is
`cb268c9e15f5690f36cd78e326d81f746800787d28289abe473656fd887e2ebd`;
transaction identifier
`006f88f5acf87980342589209bec349675300a4189a383d68e6e056944e735ab20`.
The confirmed application appears in `/api/registry`; the hosted runtime read
both on-chain counters and prepared a `voteCleanup` proof accepted by Passport's
actual transaction decoder. This check did not sign or submit a user's vote.
Run
`RUN_COMPACT_TEST=1 npm test` to include the real compiler and artefact integrity
check alongside the registry, HTTP concurrency, and runtime boundary tests.

The richer generation release was verified on 2026/09/14 with
[Stageboard](https://builder.midnightpassport.com/apps/3409141e-c278-4486-b6fa-cae3d7e9ac40?deployment=4da7b512-02ae-4993-b314-14e5c9f53bbb).
Sol generated an unchanged three-file app with a Map of task records, UTF-8
titles, priorities, and an enforced Open → InProgress → Done lifecycle. Its
`createTask`, `startTask`, and `completeTask` circuits compiled with proving keys
and deployed to stage-net at
`e8784a9522bfcac0a2257f1a919ff4d274980241bbef0f958660a72d88b0eec9`;
transaction identifier
`00aed8c1caec39a16fce44135350bc118725aa509b3c18bdf20121ae99d4562c9e`.
Twelve checks executed its generated circuits, covering independent records,
large IDs, priority limits, invalid transitions, and precise ledger decoding.
The live app reads its indexed Map; a parameterised `createTask` proof passed
Passport's actual decoder and rejected swapped circuit metadata. No task was
submitted by these checks: users add the first record through Passport.

Both reference contracts were also compiled with all proving keys and executed
against the runtime serializer. Set `CONTRACT_PATTERN_ARTEFACTS` to the verified
`<pattern-id>/{result.json,index.js}` output directory to include these two
semantic tests. Source and generated-code hashes are checked before execution.

The automatic publishing and shared CRUD release was verified on 2026/09/14
with [Field Kit](https://builder.midnightpassport.com/apps/b1934ff2-3610-4b7e-8e47-05f7d955d52d?deployment=4b6cb1ec-79d8-45c2-977b-1bcb7cd31fe9).
Sol returned 666 UTF-8 bytes containing the App configuration; the service
expanded the exact CRUD contract and empty CSS. Generation, compilation, sponsored
deployment, and the readiness query completed automatically in 33.1 seconds.
The contract is `14195559770be934e12aca2f8f9e7806d7be329621a09532d905bdb68c779f7f`.
A frontend-only publication reused verified compiler artefacts and completed in
3.5 seconds, retaining that address, the deployment transaction, and a real record.
The release passed 94 automated tests and the production build. Browser checks
covered CRUD forms, keyboard submission, pending confirmation, cancellation,
and the nested sandbox's restriction on external form submission. Real user
passkey approval is a separate manual check.

See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for LlamaCoder attribution.
