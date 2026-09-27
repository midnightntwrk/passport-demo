/**
 * The two WebAssembly runtimes, loaded ONE AT A TIME, before anything else
 * imports them.
 *
 * WHY (Safari, 2026/09/23). The contract runtime (`@midnight-ntwrk/compact-runtime`,
 * whose on-chain WASM is initialised with a top-level `await`) and the ledger
 * (`@midnightntwrk/ledger-v9`, likewise) are ASYNC modules. When several
 * dynamic imports that share one of them start together — the setup's warm-up
 * fetches the contract module, the ledger, midnight-js, and the compiled
 * contract at once — Safari can evaluate a dependent module before the async
 * one has finished. The compiled contract's `checkRuntimeVersion` then reads a
 * constant that does not exist yet:
 *
 *     ReferenceError: Cannot access uninitialized variable.
 *
 * and because a module that failed to evaluate stays failed, every later press
 * of "Create my Passport" fails the same way ("Something went wrong"). Chrome
 * orders the evaluation correctly and never showed it.
 *
 * Once both have finished evaluating, any number of concurrent imports that
 * reach them are safe, so the screens that use them are loaded behind this.
 *
 * THE LEDGER LEFT THE ENTRY CHUNK (2026/09/25)
 * --------------------------------------------
 * Until then the ledger was a STATIC dependency of `main.tsx` — through the
 * wallet SDK's address codec, which the Send sheet and the approval ladder
 * imported — so it had always finished evaluating before any `import()` could
 * reach it, and only the contract runtime could race. It also meant the landing
 * could not mount until its 10 MB binary had arrived: 4.8 s on fast 4G and
 * 25.0 s on slow 4G on a Pixel 7 profile with the CPU slowed four-fold, against
 * 0.7 s and 1.9 s without it. Those two callers now read addresses through
 * `./midnightAddress.ts`, nothing on the first render path reaches either
 * runtime, and this gate is how BOTH are first evaluated.
 *
 * That makes the rule wider than it was, and this is how it is kept:
 *
 *   - `main.tsx` calls {@link warmRuntimesWhenIdle} once the landing is on
 *     screen, so the download runs while the person reads it and makes a
 *     passkey, instead of in front of it;
 *   - the two places a wallet is opened — `openLocalWalletWithSeed` and the
 *     session restore in `App.tsx` — await {@link runtimesReady} before they
 *     import `./localWallet.ts`;
 *   - every other import of a module that reaches a runtime either runs with a
 *     wallet already open (so after one of those two) or is reached only from
 *     behind this gate: `CustodyPassport` (and the two custody arms in
 *     `./custodyArms.tsx`, which only it calls into), `RecoverWithProvider`,
 *     and the claim's warm-up.
 *
 * A new `import()` of `./localWallet.ts`, `../identity/*`, or a Midnight
 * package from the entry graph that can run BEFORE a wallet is open belongs
 * behind {@link runtimesReady} too.
 */
let ready: Promise<void> | null = null;

export function runtimesReady(): Promise<void> {
  ready ??= (async () => {
    await import('@midnight-ntwrk/compact-runtime');
    await import('@midnightntwrk/ledger-v9');
  })().catch((cause: unknown) => {
    /* Never a new failure: the screen loads as it did before this existed. */
    console.warn('[runtime] the runtimes could not be loaded ahead of the screen', cause);
  });
  return ready;
}

/**
 * Starts {@link runtimesReady} when the page is next idle — after the landing
 * has painted and taken its first input handlers, not in front of them.
 *
 * `requestIdleCallback` where there is one, with a one-second ceiling so a
 * phone that is never idle still starts the download promptly; a short timer
 * where there is not, which today means Safari.
 */
export function warmRuntimesWhenIdle(): void {
  const start = () => void runtimesReady();
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 1_000 });
  } else {
    window.setTimeout(start, 200);
  }
}
