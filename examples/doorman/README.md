# Doorman

A door that is not part of Passport.

Doorman is a small Vite app served on its **own origin** — it is never mounted
inside the Passport shell — and it is the reference integration for
`@midnight-passport/connect`. It does three things, in order:

1. **Detects** whether a Passport is there at all.
2. **Asks who is at the door** — `displayName` and the passport reference —
   which Passport answers only after the visitor has consented.
3. **Asks for one payment** — the entry fee, sent to Doorman's own account —
   which Passport answers from its own consent sheet.

Doorman never sees an approval, never holds anything of the visitor's, and
never learns anything the visitor did not agree to share. Everything it knows,
it was told across the wire protocol.

## Running it

```
npm install                # from the repository root, once
npm run dev -w doorman     # or: cd examples/doorman && npm run dev
```

Doorman is a root workspace, so `npm install` at the root links it and `-w
doorman` reaches it by name. It adds nothing to the root lockfile beyond that
link: every dependency it names — React, Vite, TypeScript, and the React
plugin — is already resolved at the root at a version its ranges accept, so it
takes them from the root `node_modules` rather than installing its own copies.
Its `package.json` lists them so the versions it was written against are on the
record.

It comes up on `http://localhost:5184`, deliberately a different origin from
the Passport shell on `http://localhost:5175`. (It pinned 5180 until
2026/09/15, which `passport-docs` pins too — with `strictPort` on both, the
second of the two to start failed to bind.) Point it elsewhere with a
`.env.local`:

```
VITE_PASSPORT_ORIGIN=http://localhost:5175
VITE_DOORMAN_ACCOUNT=…
```

Never point it at a live sponsor.

## How the package is resolved

Doorman imports `@midnight-passport/connect`, and nothing else from this
repository. The name resolves through the **workspace link** at
`node_modules/@midnight-passport/connect`, which points at `packages/connect`.

That package publishes `dist/`, and nothing in this tree builds it — the shared
`dist/` is off limits here — so both TypeScript (`tsconfig.json` `paths`) and
Vite (`vite.config.ts` `resolve.alias`) are pointed at the package's sources
instead. Doorman does not declare `@midnight-passport/connect` as a dependency;
it reads the workspace link that is already there.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Serves Doorman on `localhost:5184`. |
| `npm run typecheck` | `tsc --noEmit` over `src/`. |

There is no build script. Doorman is a reference, not a deliverable.

## Where to read next

`docs/demo/integrating.md` is the written version of this app: the three entry
points, the three calls, the redirect channel, and the four things Passport
will refuse to do.
