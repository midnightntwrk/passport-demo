/**
 * ASKING THE SAME NAME TWICE — what `/register-alias` answers the second time.
 *
 * THE DEFECT THIS CLOSES (staging, 2026/09/15)
 * --------------------------------------------
 * At 17:12:00 a Passport asked for `stagehbtest`. The sponsor registered it and
 * read the binding back at 17:12:50 — `stagehbtest.night → bcf6d98e…`, which is
 * that very Passport's account-custody contract. At 17:12:51 the SAME Passport
 * asked for `stagehbtest` again: the first answer never reached the browser (a
 * reload, a dropped socket — it does not matter which, and it will happen
 * again). Gate 3 read the registry, found the name taken, and refused
 * `name-taken`, which the app rendered as "stagehbtest.night has already been
 * taken — choose another name" for a name that was by then this person's own.
 *
 * They then typed `stagehbtest2`. The availability field said it was free, and
 * it was. Gate 5 refused it `already-sponsored`, because the ledger had a row
 * for this contract. Net: a Passport holding a registered name, and an app
 * convinced it had none.
 *
 * WHAT THIS MODULE DECIDES
 * ------------------------
 * Both refusals are correct about the world and wrong about the caller. The
 * gates ask "is this name free?" and "has this Passport been served?" when the
 * question that decides the answer is "is the thing being asked for already
 * DONE, and done for the very Passport asking?". A registration that is already
 * this Passport's is not a conflict — it is the requested outcome, arrived at
 * earlier — so the route answers it with the success body of a fresh
 * registration and spends nothing.
 *
 * WHAT IT MUST NEVER DECIDE
 * -------------------------
 * That a name is ours because we could not read the registry. Every branch
 * below is driven by a {@link RegistryReading} that distinguishes "the name
 * points at this contract", "the name points elsewhere", "the name is not
 * registered at all", and "the registry was not asked, or would not answer".
 * Only the first is ownership. The last falls back on the sponsor's own ledger,
 * which is a record of what THIS service did, and on nothing else.
 */

import type { AliasEntry } from './ledgers.js';
import type { AliasRegistration, ResolvedDomainTarget } from './midnames.js';

/**
 * What the registry said about the label, in the three shapes the answer can
 * take. `unread` is deliberately not merged into `absent`: a question that
 * could not be put is not an answer of no, and treating it as one is how a
 * flaky indexer would start telling people their name is free.
 */
export type RegistryReading =
  /** The label resolves, through this leaf, to this target. */
  | { kind: 'resolved'; resolverAddress: string; target: ResolvedDomainTarget }
  /** The registry answered, and the label is not in it. */
  | { kind: 'absent' }
  /** The registry was not asked, or would not answer. Never read as "no". */
  | { kind: 'unread' };

/**
 * Whether a resolved target IS the account-custody contract that is asking.
 *
 * A name pointing at a shielded key or a bare wallet address is somebody else's
 * arrangement whatever else is true, so only `contract` can ever match. The
 * comparison is on the raw 64 hex of both sides, lower-cased, because one comes
 * out of the ledger decoder and the other out of the request.
 */
export function targetIsPassport(
  target: ResolvedDomainTarget,
  contractAddress: string,
): boolean {
  if (target.kind !== 'contract') return false;
  return target.hex.toLowerCase() === contractAddress.toLowerCase();
}

/** Everything about the request that an answer has to name back. */
export interface ExistingRegistrationContext {
  /** Normalised label, no `.night`. */
  label: string;
  /** `<label>.night`. */
  domain: string;
  network: string;
  tldAddress: string;
  /** Raw 64-hex account-custody contract the caller is asking for. */
  contractAddress: string;
  /** The caller's own Midnames owner key, as hex — echoed, not re-read. */
  ownerKeyHex: string;
  /** When this answer was made, for a registration whose moment is unrecorded. */
  now: string;
}

/**
 * The registration this request is asking for, where it has ALREADY happened
 * for this very Passport — or `null` where it has not, in which case the
 * caller's own refusal stands untouched.
 *
 * The two grounds, and they are not interchangeable:
 *
 *   - THE REGISTRY. `resolved` naming this contract is proof, and it is proof
 *     no matter what this service's ledger remembers. A name resolving
 *     anywhere else is refused even if the ledger claims it, because the chain
 *     outranks a JSON file every time.
 *   - THE SPONSOR'S LEDGER, and only where the registry was not asked or would
 *     not answer. A row keyed on this contract carrying this label says this
 *     service registered this name for this Passport, which is the same fact
 *     arrived at from the other side. It is what makes gate 5 — "one sponsored
 *     name per Passport" — answer the name it already sponsored rather than
 *     refuse it.
 *
 * Transaction ids come from the ledger row when there is one. When there is not
 * — the registry says the name is this Passport's and this service has no
 * memory of putting it there — they are EMPTY rather than invented, and the
 * client reads that as a registration it must not claim to have witnessed. See
 * `identity/sponsoredAlias.ts` in `examples/passport-demo`.
 */
export function existingRegistration(input: {
  context: ExistingRegistrationContext;
  reading: RegistryReading;
  /** This contract's row in the sponsor's alias ledger, where it has one. */
  entry: AliasEntry | null;
}): AliasRegistration | null {
  const { context, reading, entry } = input;
  /* The row for THIS label, or none. A row for a different one is this
     Passport's other name and says nothing about the one being asked for. */
  const ours = entry !== null && entry.alias === context.label ? entry : null;
  if (reading.kind === 'absent') return null;
  let resolverAddress: string;
  if (reading.kind === 'resolved') {
    if (!targetIsPassport(reading.target, context.contractAddress)) return null;
    /* The leaf the REGISTRY names — what a caller will actually resolve
       against, whatever this service happens to remember. */
    resolverAddress = reading.resolverAddress;
  } else {
    /* The registry was not asked, or would not answer. This service's own
       record of registering the name is then the only ground there is, and
       without one there is nothing to answer with. */
    if (!ours) return null;
    resolverAddress = ours.resolverAddress;
  }
  return {
    alias: context.label,
    domain: context.domain,
    network: context.network,
    tldAddress: context.tldAddress,
    resolverAddress,
    /* Read back, not watched. An id this service did not record is absent
       rather than fabricated — a caller can tell the difference and the
       demo's own record keeping depends on being able to. */
    resolverDeployTx: ours ? ours.resolverDeployTx : '',
    registerTx: ours ? ours.registerTx : '',
    /* The ledger records no blocks; nothing here is watching a chain. */
    resolverDeployBlock: null,
    registerBlock: null,
    target: { kind: 'contract', address: context.contractAddress },
    ownerKey: context.ownerKeyHex,
    /* Nothing was spent answering this request. The cost of the registration
       that DID happen is the ledger row's, where there is one. */
    costAtomic: ours ? BigInt(ours.costAtomic) : 0n,
    registeredAt: ours ? ours.at : context.now,
    /* A leaf off the shelf is a fact about a deploy this answer did not make. */
    fromPool: false,
  };
}

/**
 * The body `/register-alias` answers 200 with — ONE builder, so the answer to
 * "it is registered" cannot drift from the answer to "I have just registered
 * it". A client that could tell the two apart by shape would have to, and then
 * the shape would be the contract rather than the fact.
 *
 * `alreadyRegistered` is the one field that differs, and it is present on every
 * answer rather than only on the idempotent one — a flag that appears and
 * disappears is a second shape wearing the first one's name.
 */
export function aliasSuccessBody(
  registration: AliasRegistration,
  alreadyRegistered: boolean,
): Record<string, unknown> {
  return {
    alias: registration.alias,
    domain: registration.domain,
    network: registration.network,
    tldAddress: registration.tldAddress,
    resolverAddress: registration.resolverAddress,
    resolverDeployTx: registration.resolverDeployTx,
    registerTx: registration.registerTx,
    resolverDeployBlock: registration.resolverDeployBlock,
    registerBlock: registration.registerBlock,
    target: registration.target,
    ownerKey: registration.ownerKey,
    costAtomic: registration.costAtomic.toString(),
    registeredAt: registration.registeredAt,
    fromPool: registration.fromPool,
    alreadyRegistered,
  };
}
