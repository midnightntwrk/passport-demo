/**
 * A STAND-IN SIGN-IN, so the Dynamic-only path can be walked without Dynamic.
 *
 * WHY IT HAS TO EXIST
 * -------------------
 * Every other screen in this app is drilled by `e2e/` against a production
 * build with a real ceremony behind it — a CDP virtual authenticator answers
 * WebAuthn, and nothing in `src` knows it is being tested. There is no
 * equivalent for a social sign-in. Dynamic's overlay is a cross-origin iframe
 * served by `app.dynamicauth.com`, its `settings`/`nonce` calls are refused by
 * CORS from any origin not in the dashboard's allow-list, and the MPC rounds
 * that produce a signature run inside that iframe. A spec cannot drive it, and
 * a spec that tried would be graded on whether a third party was up.
 *
 * So the seam is filled here instead: this module publishes a signed-in session
 * into the same module-level store `src/lib/dynamic.tsx`'s bridge writes to, and
 * from that point on every line the app runs is the shipped one. What is
 * replaced is the vendor, and nothing else — not a screen, not a decision, not
 * a contract call.
 *
 * WHY IT CANNOT REACH A SHIPPED BUILD
 * -----------------------------------
 * `main.tsx` gates the `import()` on `import.meta.env.VITE_DYNAMIC_WALK === '1'`
 * WRITTEN OUT, not called. Vite substitutes the variable with a literal at build
 * time, so with it unset Rollup reads `if (undefined === '1')`, deletes the
 * branch, and deletes this module and its chunk with it. That is the same
 * mechanism, and the same reasoning, as the `VITE_DYNAMIC_ENVIRONMENT_ID` gate
 * three lines above it — measured on 2026/09/14, where writing the condition as
 * a function call shipped 7 MB nothing would ever have fetched.
 *
 * The variable is set for `playwright.config.ts`'s preview build and nowhere
 * else. Even there the seam does nothing until a URL carries
 * `?dynamicwalk=<address>`, so the other specs — which do not — run against a
 * build whose sign-in seam is `disabled`, exactly as today.
 *
 * WHY THE SIGNATURE IS REAL
 * -------------------------
 * The key below is a fixed test scalar and the signature it makes is a genuine
 * secp256k1 one over the digest it is given. A stub that returned 65 bytes of
 * anything would fail inside `recoverSecp256k1Point` — the first thing the flow
 * does with it — and the walk would then be measuring the stub rather than the
 * app. With a real signature the point recovers, the device entry derives, and
 * the run reaches the first real service boundary, which is where an honest
 * mocked walk should stop.
 */

import {
  publishDynamicActions,
  publishDynamicSession,
  type DynamicActions,
} from './dynamicSession.js';

/** The query parameter, and the address it carries. */
export const DYNAMIC_WALK_PARAM = 'dynamicwalk';

/**
 * A fixed secp256k1 scalar. Not a secret, not derived from anything, and
 * present only in a build that sets `VITE_DYNAMIC_WALK`.
 */
const WALK_SCALAR = BigInt(
  '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
);

/** The address a walk signs as, when the URL does not name one. */
export const DYNAMIC_WALK_ADDRESS = '0x00a329c0648769a73afac7f9381e08fb43dbea72';

/** What the walk says it signed in with. */
export const DYNAMIC_WALK_PROVIDER = 'Google';
export const DYNAMIC_WALK_HANDLE = 'walker';

/**
 * Whether a URL is asking for the stand-in, and which address it wants.
 *
 * A bare `?dynamicwalk` (or `?dynamicwalk=1`) takes the default address, so a
 * spec that does not care about the address does not have to write one out.
 * Anything else is used verbatim, which is how a spec drives two different
 * users through the same build.
 */
export function dynamicWalkAddress(search: string): string | null {
  const value = new URLSearchParams(search).get(DYNAMIC_WALK_PARAM);
  if (value === null) return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed === '1' ||
    trimmed === DYNAMIC_WALK_SIGNED_OUT ||
    trimmed === DYNAMIC_WALK_AWAY
  ) {
    return DYNAMIC_WALK_ADDRESS;
  }
  return trimmed;
}

/**
 * The value that seeds a session which is AVAILABLE but not signed in.
 *
 * IT IS THE ONLY WAY TO WALK THE TWO SCREENS THIS BUILD ADDED (2026/09/22).
 * Both of them exist for somebody who has not signed in yet — the landing's "I
 * already have a Passport", and the way-back step after the name — and both are
 * absent from a build whose seam reports `disabled`. Seeding a session that is
 * already signed in skips straight past them.
 *
 * So `?dynamicwalk=out` publishes `signed-out`, with an `openAuthFlow` that
 * publishes the signed-in session the overlay would have published. That is the
 * same substitution the rest of this module makes and no more: what is replaced
 * is the vendor's overlay, and every line the app runs on either side of it —
 * which screen it renders, when it picks the add back up, what it signs — is
 * the shipped one.
 */
export const DYNAMIC_WALK_SIGNED_OUT = 'out';

/**
 * The value that seeds a signed-out session whose overlay NEVER COMES BACK to
 * this load (2026/09/25).
 *
 * `?dynamicwalk=away` publishes `signed-out` like `out`, but its
 * `openAuthFlow` publishes nothing: the reader has left for the provider's
 * sign-in and this page is about to be reloaded — by a redirect, or by the
 * provider's own error view, which is what Android Chrome met live. A spec
 * presses the offer here and then loads the page again with `?dynamicwalk=1`,
 * which is the sign-in coming back on a fresh load.
 */
export const DYNAMIC_WALK_AWAY = 'away';

/** Whether this URL wants a signed-out seed, either kind. */
export function dynamicWalkStartsSignedOut(search: string): boolean {
  const value = new URLSearchParams(search).get(DYNAMIC_WALK_PARAM)?.trim();
  return value === DYNAMIC_WALK_SIGNED_OUT || value === DYNAMIC_WALK_AWAY;
}

/** Whether this URL's overlay takes the reader away and never publishes. */
function dynamicWalkOverlayLeaves(search: string): boolean {
  return new URLSearchParams(search).get(DYNAMIC_WALK_PARAM)?.trim() === DYNAMIC_WALK_AWAY;
}

/**
 * Publishes a signed-in session, if this URL asked for one.
 *
 * Returns whether it did, so the caller can say nothing rather than guess.
 */
export function seedDynamicWalk(search: string): boolean {
  const address = dynamicWalkAddress(search);
  if (address === null) return false;

  const signedIn = {
    status: 'signed-in' as const,
    provider: DYNAMIC_WALK_PROVIDER,
    handle: DYNAMIC_WALK_HANDLE,
    evmAddress: address,
  };

  const actions: DynamicActions = {
    /* The overlay, stood in for: it publishes what a completed sign-in would
       publish, and the app picks the flow back up exactly as it does live. */
    openAuthFlow: dynamicWalkOverlayLeaves(search)
      ? () => undefined
      : () => publishDynamicSession(signedIn),
    /* The EIP-191 path, refused with the sentence the real bridge refuses an
       externally connected wallet with. Nothing on this path uses it — the k256
       arm cannot verify a keccak of a prefixed string — and a stand-in that
       answered it would be offering a capability the product does not have. */
    signMessage: () =>
      Promise.reject(new Error('This sign-in cannot approve Passport actions yet.')),
    signRaw: (digestHex: string) => signWalkDigest(digestHex, address),
    signOut: () => {
      publishDynamicSession({
        status: 'signed-out',
        provider: null,
        handle: null,
        evmAddress: null,
      });
      return Promise.resolve();
    },
  };

  publishDynamicActions(actions);
  publishDynamicSession(
    dynamicWalkStartsSignedOut(search)
      ? { status: 'signed-out', provider: null, handle: null, evmAddress: null }
      : signedIn,
  );
  return true;
}

/**
 * The scalar this walk signs with, for the address it signed in as.
 *
 * ONE KEY PER ADDRESS, and the reason is a live one. A Passport's device is the
 * point recovered from this signature, so a fixed scalar gives every walk
 * address the SAME device key — and a run that has one such Passport pay
 * another would then be a key paying itself, which proves nothing about two
 * holders. The default address keeps {@link WALK_SCALAR} unchanged so the
 * Passport the mocked walks are seeded against still signs as itself; any other
 * address gets the scalar offset by its own bytes, which is deterministic (a
 * spec re-running the same address gets the same Passport back) and stays well
 * inside the curve order.
 */
function walkScalarFor(address: string): bigint {
  if (address.toLowerCase() === DYNAMIC_WALK_ADDRESS) return WALK_SCALAR;
  let offset = 0n;
  for (const character of address.toLowerCase()) {
    offset = (offset * 131n + BigInt(character.charCodeAt(0))) % 0xffff_ffff_ffff_ffffn;
  }
  return WALK_SCALAR ^ offset;
}

/**
 * A real ECDSA signature over the digest, in the shape Dynamic returns:
 * `0x` + `r‖s‖v`, with `v` as 27 or 28.
 *
 * `@noble/curves` through an `import()`, exactly as `custodyRecover.ts` reaches it,
 * so the curve stays out of the entry chunk here too.
 */
async function signWalkDigest(digestHex: string, address: string): Promise<string> {
  const { secp256k1 } = await import('@noble/curves/secp256k1.js');
  const digest = Uint8Array.from(
    digestHex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
  /* `prehash: false` is load-bearing. The default hashes the message before
     signing, and this argument is ALREADY the digest — the envelope has been
     applied and SHA-256 taken. Signing a second hash of it produces a
     signature that verifies against nothing, and the failure surfaces three
     files away inside point recovery. Checked against
     `recoverSecp256k1Point` on 2026/09/16.
     `format: 'recovered'` returns 65 bytes with the recovery byte FIRST;
     Dynamic returns it last, as `v`, so the two halves are swapped below. */
  const recovered = secp256k1.sign(digest, scalarBytes(walkScalarFor(address)), {
    prehash: false,
    format: 'recovered',
  });
  const v = (27 + recovered[0]).toString(16).padStart(2, '0');
  const rs = Array.from(recovered.slice(1)).reduce(hexReducer, '');
  return `0x${rs}${v}`;
}

/** The scalar as the 32 big-endian bytes the curve takes. */
function scalarBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let rest = value;
  for (let index = 31; index >= 0; index -= 1) {
    bytes[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

/** Bytes to lower-case hex, one byte at a time. */
function hexReducer(accumulated: string, byte: number): string {
  return accumulated + byte.toString(16).padStart(2, '0');
}
