/**
 * The inbox — how a custody Passport is told what shielded coin it just
 * received, and how it reads that back.
 *
 * WHY THIS EXISTS (2026/09/16)
 * ----------------------------
 * The reference account contract's shielded deposit takes two arguments:
 *
 *     circuit deposit_shielded(coin: CoinInfo, entry: Bytes<192>)
 *
 * The coin goes into the contract's own Zswap balance. The `entry` is 192
 * opaque bytes the contract stores in an append-only map and never reads: the
 * DEPOSITOR encrypts the coin's description to the account's advertised
 * `enc_key`, and the account's owner — and nobody else — can decrypt it later.
 *
 * That second argument is not decoration. The qualified description of a
 * shielded coin (nonce, colour, value, and its position in the commitment
 * tree) is what the `held_coin` witness must answer with before the account can
 * spend, and the chain carries none of it. A deposit made without a readable
 * entry is a coin that has demonstrably arrived and that nobody — not the
 * owner, not the depositor, not this repository — can ever move again. That is
 * why `../identity/custodyContractClient.ts` and the sponsor both REFUSED shielded
 * deposits into custody accounts rather than send a placeholder, and this module is
 * what lets them stop refusing.
 *
 * THE ENTRY IS THE WIRE FORMAT AND THE WIRE FORMAT IS THE REFERENCE'S
 * ------------------------------------------------------------------
 * Two programs that never meet have to agree on these bytes: whoever seals an
 * entry (a depositor — the sponsor, another Passport, a partner) and whoever
 * opens it (the owner's client, possibly a year later, possibly a different
 * implementation). So nothing here is invented. The layout, the key schedule,
 * the info string, and the skip rules are the reference's
 * `contract/src/wallet/inbox.ts` (MIP-0012 §6.4), and the fixtures in
 * `custodyInbox.test.ts` were produced by running THAT code, not this one.
 *
 *   | offset | length | field                                     |
 *   |--------|--------|-------------------------------------------|
 *   | 0      | 1      | version = 0x01                            |
 *   | 1      | 1      | suite   = 0x01 (X25519+HKDF-SHA256+GCM)   |
 *   | 2      | 32     | ephemeral X25519 public key               |
 *   | 34     | 12     | AEAD nonce                                |
 *   | 46     | 16     | AEAD tag                                  |
 *   | 62     | 80     | ciphertext                                |
 *   | 142    | 50     | zero padding                              |
 *
 * The 80-byte plaintext is coin nonce (32) ‖ colour (32) ‖ value as an
 * unsigned 128-bit big-endian integer (16). The AEAD key is
 * HKDF-SHA256(ikm = X25519(ephemeral secret, enc_key), salt = empty,
 * info = "midnight:custody:inbox:v1", L = 32), and the associated data is the
 * first two container bytes, so a reader that accepted a rewritten version or
 * suite byte would fail authentication rather than mis-parse.
 *
 * WHY THE PADDING IS PART OF THE FORMAT. Every entry is the same 192 bytes
 * whatever it contains, so an observer counting bytes on chain learns nothing
 * about the coin. Writers zero it; readers ignore it. A writer that put
 * something there would be the only writer that did, and that is itself a
 * signal.
 *
 * WHY THE PRIMITIVES ARE SPLIT THE WAY THEY ARE
 * ---------------------------------------------
 * The reference is a Node program and uses `node:crypto` throughout. This one
 * runs in a browser, so:
 *
 *   - X25519 comes from `@noble/curves` (already a pinned dependency at 2.4.0,
 *     used nowhere else in this module's neighbourhood but present for the
 *     k256 arm). `crypto.subtle` can do X25519 in current Chrome and Safari
 *     and could not in the browsers this demo has been walked on, and a key
 *     agreement that works on the laptop and not the phone is the worst of the
 *     available failures.
 *   - HKDF-SHA256 and AES-256-GCM come from `crypto.subtle`, which has had both
 *     everywhere for years.
 *
 * NO NEW DEPENDENCY WAS ADDED. The split is why the sealing and opening
 * functions are async — `crypto.subtle` is — and the pure codec below is not,
 * which is what lets the byte layout be tested without any crypto at all.
 *
 * The two implementations (this one and the sponsor's
 * `examples/passport-balancer/src/custodyInbox.ts`, which does use `node:crypto`)
 * are cross-tested against the same committed fixtures precisely because they
 * do not share a line of code.
 */

import { x25519 } from '@noble/curves/ed25519.js';

import { bytesToHex } from './custodyContractSigning.js';
import { hexToBytes } from './custodyContractPlan.js';
import {
  reconcileK1CoinFromChain,
  type K1Account,
  type K1CommitmentWindowReader,
  type K1Reconciliation,
} from './k1CoinStore.js';

/* -------------------------------------------------------------------------- */
/* The format                                                                 */
/* -------------------------------------------------------------------------- */

/** The container's fixed size. `Bytes<192>` in the contract, and never less. */
export const CUSTODY_INBOX_ENTRY_BYTES = 192;

/** Container version. A reader skips an entry carrying any other value. */
export const CUSTODY_INBOX_VERSION = 0x01;

/** Suite 1: X25519 ‖ HKDF-SHA256 ‖ AES-256-GCM. The only one defined. */
export const CUSTODY_INBOX_SUITE = 0x01;

/** The sealed coin description, before padding. */
export const CUSTODY_INBOX_PLAINTEXT_BYTES = 80;

/**
 * The HKDF info string, byte for byte.
 *
 * It is what separates this key schedule from every other one that might one
 * day share an X25519 shared secret with it. Changing a character makes every
 * entry ever written unreadable, which is why it is a constant with a name
 * rather than a literal at the call site.
 */
export const CUSTODY_INBOX_HKDF_INFO = 'midnight:custody:inbox:v1';

const EPHEMERAL_OFFSET = 2;
const NONCE_OFFSET = 34;
const TAG_OFFSET = 46;
const CIPHERTEXT_OFFSET = 62;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** `localStorage` key for the per-Dynamic-user account encryption secrets. */
export const CUSTODY_ENC_KEY_KEY = 'passport-account-custody-enc:v1';

/**
 * A coin description as it travels inside an entry — this app's vocabulary
 * (hex for bytes, `bigint` for numbers, `colour` spelled our way), matching
 * `./k1CoinStore.ts`'s {@link K1HeldCoin} minus the one field the entry
 * deliberately does not carry.
 *
 * NO `mtIndex`. The reference omits it and says why: the position a coin
 * occupies in the commitment tree is not known to the depositor at the moment
 * it seals the entry, it is a property of the transaction that has not been
 * included yet. The owner learns it from chain data instead — which is exactly
 * what `reconcileK1CoinFromChain` does, and why {@link readInboxCustody} takes a
 * commitment-window reader.
 */
export interface CustodyInboxCoin {
  readonly colour: string;
  readonly nonce: string;
  readonly value: bigint;
}

/**
 * An account's X25519 encryption keypair.
 *
 * The public half is what the contract advertises as `enc_key` and what any
 * depositor seals to. The secret half is the VIEWING CAPABILITY (MIP-0012 R9):
 * it decrypts every entry ever addressed to this account and nothing else. It
 * authorises no spend — a device signature does that — so losing it costs the
 * ability to learn about coins, not the coins themselves, provided their
 * descriptions were captured some other way. Nothing captures them another way
 * today, so in practice it is as precious as the coins.
 */
export interface CustodyEncKeyPair {
  readonly publicKeyHex: string;
  readonly secretKeyHex: string;
}

/** The four variable fields of a container, unpacked. Padding is not one. */
export interface CustodyInboxEntryParts {
  readonly ephemeralPublicKey: Uint8Array;
  readonly nonce: Uint8Array;
  readonly tag: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/* -------------------------------------------------------------------------- */
/* Hex, the way this module needs it                                          */
/* -------------------------------------------------------------------------- */

/**
 * A 32-byte value as lowercase hex, or null.
 *
 * `./custodyContractPlan.ts`'s {@link hexToBytes} accepts any even-length string and
 * is right to, because it decodes transactions. A colour, a nonce, and a key
 * are each exactly 32 bytes, and a caller that handed over 31 would otherwise
 * get an entry that seals cleanly and opens as nonsense.
 */
function normalised32(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? hex.toLowerCase() : null;
}

/** The largest value the 16-byte field can carry, inclusive. */
const MAX_VALUE = (1n << 128n) - 1n;

/* -------------------------------------------------------------------------- */
/* The pure codec                                                             */
/* -------------------------------------------------------------------------- */

/** A coin, checked once, in the only form the rest of this module handles. */
interface CheckedCoin {
  readonly nonce: string;
  readonly colour: string;
  readonly value: bigint;
}

/**
 * A coin as an entry can carry it, or a refusal.
 *
 * Throws rather than truncating or repairing, and does it in ONE place so that
 * the depositor helper below and the plaintext encoder cannot drift into
 * disagreeing about what a coin is. A truncated value is an entry that says the
 * coin is worth less than it is, and an owner who under-spends it for ever.
 */
function requireCoin(coin: CustodyInboxCoin): CheckedCoin {
  const nonce = normalised32(coin.nonce);
  if (nonce === null) throw new Error(`Not a coin nonce: ${JSON.stringify(coin.nonce)}.`);
  const colour = normalised32(coin.colour);
  if (colour === null) throw new Error(`Not a colour: ${JSON.stringify(coin.colour)}.`);
  if (typeof coin.value !== 'bigint' || coin.value < 0n || coin.value > MAX_VALUE) {
    throw new Error(`Not a coin value a 128-bit field can carry: ${String(coin.value)}.`);
  }
  return { nonce, colour, value: coin.value };
}

/**
 * The 80-byte plaintext: nonce ‖ colour ‖ value, big-endian.
 *
 * Big-endian because the reference is, and for no other reason.
 */
export function encodeCustodyInboxPlaintext(coin: CustodyInboxCoin): Uint8Array {
  const checked = requireCoin(coin);
  const out = new Uint8Array(CUSTODY_INBOX_PLAINTEXT_BYTES);
  out.set(hexToBytes(checked.nonce), 0);
  out.set(hexToBytes(checked.colour), 32);
  let remaining = checked.value;
  for (let index = 15; index >= 0; index -= 1) {
    out[64 + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/** The inverse. Returns null on anything that is not 80 bytes. */
export function decodeCustodyInboxPlaintext(plaintext: Uint8Array): CustodyInboxCoin | null {
  if (plaintext.length !== CUSTODY_INBOX_PLAINTEXT_BYTES) return null;
  let value = 0n;
  for (let index = 0; index < 16; index += 1) value = (value << 8n) | BigInt(plaintext[64 + index]);
  return {
    nonce: bytesToHex(plaintext.subarray(0, 32)),
    colour: bytesToHex(plaintext.subarray(32, 64)),
    value,
  };
}

/**
 * The container, assembled. The padding is allocated zero and left that way.
 *
 * Every field's length is checked here rather than trusted, because this is the
 * last place the bytes are still separate things: past this point a short nonce
 * is indistinguishable from a long ephemeral key.
 */
export function packCustodyInboxEntry(parts: CustodyInboxEntryParts): Uint8Array {
  requireLength('an ephemeral public key', parts.ephemeralPublicKey, KEY_BYTES);
  requireLength('an AEAD nonce', parts.nonce, NONCE_BYTES);
  requireLength('an AEAD tag', parts.tag, TAG_BYTES);
  requireLength('a ciphertext', parts.ciphertext, CUSTODY_INBOX_PLAINTEXT_BYTES);

  const entry = new Uint8Array(CUSTODY_INBOX_ENTRY_BYTES);
  entry[0] = CUSTODY_INBOX_VERSION;
  entry[1] = CUSTODY_INBOX_SUITE;
  entry.set(parts.ephemeralPublicKey, EPHEMERAL_OFFSET);
  entry.set(parts.nonce, NONCE_OFFSET);
  entry.set(parts.tag, TAG_OFFSET);
  entry.set(parts.ciphertext, CIPHERTEXT_OFFSET);
  return entry;
}

function requireLength(what: string, bytes: Uint8Array, length: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new Error(`An inbox entry needs ${what} of ${length} bytes, not ${String(bytes?.length)}.`);
  }
}

/**
 * The container, taken apart — or null when it is one this reader must SKIP.
 *
 * Skipping, not failing, is the normative behaviour (§6.4, §6.5): an inbox is
 * writable by anyone who can reach the contract, so it will contain entries
 * addressed to other keys, entries from future suites, and entries written to
 * waste a reader's time. A walk that threw on the first of those would be a
 * walk any passer-by could stop.
 */
export function unpackCustodyInboxEntry(entry: Uint8Array): CustodyInboxEntryParts | null {
  if (!(entry instanceof Uint8Array) || entry.length !== CUSTODY_INBOX_ENTRY_BYTES) return null;
  if (entry[0] !== CUSTODY_INBOX_VERSION || entry[1] !== CUSTODY_INBOX_SUITE) return null;
  return {
    ephemeralPublicKey: entry.slice(EPHEMERAL_OFFSET, EPHEMERAL_OFFSET + KEY_BYTES),
    nonce: entry.slice(NONCE_OFFSET, NONCE_OFFSET + NONCE_BYTES),
    tag: entry.slice(TAG_OFFSET, TAG_OFFSET + TAG_BYTES),
    ciphertext: entry.slice(CIPHERTEXT_OFFSET, CIPHERTEXT_OFFSET + CUSTODY_INBOX_PLAINTEXT_BYTES),
  };
}

/* -------------------------------------------------------------------------- */
/* Keys                                                                       */
/* -------------------------------------------------------------------------- */

/** What the crypto here needs that is not an argument. Injected for drills. */
export interface CustodyInboxDeps {
  randomBytes(length: number): Uint8Array;
  subtle(): SubtleCrypto;
}

export function defaultCustodyInboxDeps(): CustodyInboxDeps {
  return {
    randomBytes: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
    subtle: () => globalThis.crypto.subtle,
  };
}

/**
 * A fresh account encryption keypair.
 *
 * The secret is 32 random bytes; X25519 clamps them itself, so there is no
 * rejection loop and no key that is weaker than another.
 */
export function generateCustodyEncKeyPair(deps: CustodyInboxDeps = defaultCustodyInboxDeps()): CustodyEncKeyPair {
  const secretKey = deps.randomBytes(KEY_BYTES);
  return {
    secretKeyHex: bytesToHex(secretKey),
    publicKeyHex: bytesToHex(x25519.getPublicKey(secretKey)),
  };
}

/** The public half of a secret already held. */
export function custodyEncPublicKey(secretKeyHex: string): string {
  const secret = normalised32(secretKeyHex);
  if (secret === null) throw new Error('An account encryption secret is 32 bytes.');
  return bytesToHex(x25519.getPublicKey(hexToBytes(secret)));
}

/**
 * The slot one account's viewing secret is stored in.
 *
 * Lower-cased on the user and the salt, because both arrive as hex from places
 * that disagree about case, and two spellings of one account must not become
 * two keys — which would be the same "advertised a key nobody held" defect in
 * a different disguise.
 */
export function custodyEncKeySlot(user: string, scope: CustodyEncAccountScope): string {
  return `${user.toLowerCase()}|${scope.network}|${scope.accountId.toLowerCase()}`;
}

/** The storage this module reads and writes. `./custodyContractClient.ts`'s shape. */
export interface CustodyInboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Which account's viewing key is being asked for.
 *
 * THE ACCOUNT IS NAMED BY ITS SALT, NOT ITS ADDRESS, and it has to be: the key
 * is a CONSTRUCTOR ARGUMENT, so it is chosen before the contract has an address
 * at all. The boot salt is the one thing that exists at that moment, is unique
 * to this account, and survives a reload — it is in the progress record, which
 * is what makes resuming a half-built deploy hand back the same key.
 */
export interface CustodyEncAccountScope {
  /** `stagenet`, `devnet`. A key from one network is not a key on another. */
  readonly network: string;
  /** The account's boot salt, as hex. Its identity before it has an address. */
  readonly accountId: string;
}

/**
 * The encryption keypair one account advertises, made once and remembered —
 * the same shape, and the same storage discipline, as `custodyWalletSeed(deps,
 * user)` next door.
 *
 * IT IS REMEMBERED AND THE WALLET SEED IS NOT INTERCHANGEABLE WITH IT. The
 * wallet seed may be lost at the cost of a resync, because this wallet only
 * assembles transactions. This secret may not: every coin the account has ever
 * been sent was sealed to its public half, and a new one makes the whole inbox
 * unreadable. The previous milestone generated the public half with
 * `deps.randomBytes(32)` and threw the secret away — the account advertised a
 * key nobody, including its owner, held — which is precisely the defect this
 * replaces.
 *
 * PER ACCOUNT AND PER NETWORK, NOT PER USER. Keying it by the Dynamic user
 * alone made one secret the viewing key of every account that user ever
 * deployed, on every network: a stagenet account and a devnet account
 * advertising the same public half, and a second account made after starting
 * again sharing a secret with the abandoned first. That is a linkability the
 * whole inbox exists to avoid — a depositor seals to a key, and two accounts
 * advertising one key are visibly one person — and it is also a blast radius,
 * because one leaked secret opens every inbox rather than one.
 */
export function custodyEncKeyPair(
  storage: CustodyInboxStorage,
  user: string,
  scope: CustodyEncAccountScope,
  deps: CustodyInboxDeps = defaultCustodyInboxDeps(),
  /**
   * A viewing secret DERIVED from the account's own authenticator, used in
   * place of a fresh random one when this slot is still empty.
   *
   * The passkey arm passes it (`PASSPORT_ENC_LABEL` in `passportContract.ts`);
   * the Dynamic arm does not, and keeps the random secret it has always had.
   * The derivation's whole point is that it survives a reinstall, so a passkey
   * Passport that comes back on a new phone re-derives the key its inbox was
   * sealed to instead of advertising one nobody held.
   *
   * IT NEVER REPLACES A SECRET ALREADY IN THE SLOT. A key that is already
   * stored is a key some depositor has already sealed to, and overwriting it
   * would make exactly the entries this parameter exists to recover
   * unreadable. A derived key that disagrees with a stored one is a deploy
   * that has already happened under the stored one, so the stored one wins and
   * the derivation is what repairs an EMPTY slot, not a disagreeing one.
   */
  derivedSecretKeyHex?: string,
): CustodyEncKeyPair {
  let secrets: Record<string, string> = {};
  try {
    const raw = storage.getItem(CUSTODY_ENC_KEY_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        secrets = parsed as Record<string, string>;
      }
    }
  } catch {
    secrets = {};
  }

  const slot = custodyEncKeySlot(user, scope);
  const existing = normalised32(secrets[slot]);
  if (existing !== null) {
    return { secretKeyHex: existing, publicKeyHex: custodyEncPublicKey(existing) };
  }

  const derived = normalised32(derivedSecretKeyHex);
  const fresh =
    derived === null
      ? generateCustodyEncKeyPair(deps)
      : { secretKeyHex: derived, publicKeyHex: custodyEncPublicKey(derived) };
  secrets[slot] = fresh.secretKeyHex;
  try {
    storage.setItem(CUSTODY_ENC_KEY_KEY, JSON.stringify(secrets));
  } catch (cause) {
    /* A key that could not be written is a key that will be different next
       visit, and an inbox that will not open. It is worth a loud line, and it
       is NOT worth throwing: the deposit about to be made is still readable in
       this session, and refusing here would lose it outright. */
    console.warn('[account-custody] could not remember this Passport’s viewing key', cause);
  }
  return fresh;
}

/* -------------------------------------------------------------------------- */
/* Sealing and opening                                                        */
/* -------------------------------------------------------------------------- */

async function aeadKey(subtle: SubtleCrypto, shared: Uint8Array): Promise<CryptoKey> {
  const ikm = await subtle.importKey('raw', toBuffer(shared), 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      /* An EMPTY salt, which RFC 5869 defines as a string of HashLen zeros.
         `crypto.subtle` requires the parameter and treats a zero-length
         `Uint8Array` as the RFC's default, which is what `hkdfSync` with
         `Buffer.alloc(0)` does on the reference side. The fixtures are the
         proof that those two readings agree. */
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(CUSTODY_INBOX_HKDF_INFO),
    },
    ikm,
    KEY_BYTES * 8,
  );
  return subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** `crypto.subtle` wants an ArrayBuffer view it owns; a subarray is not one. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

const ASSOCIATED_DATA = new Uint8Array([CUSTODY_INBOX_VERSION, CUSTODY_INBOX_SUITE]);

/**
 * Seal a coin description to an account's advertised `enc_key`.
 *
 * This is what a DEPOSITOR does, and the depositor is usually not the owner:
 * the sponsor paying in an opening balance, another Passport making a transfer,
 * a partner sending a gift. None of them can read the entry back afterwards —
 * the ephemeral secret is discarded here and never leaves this function — which
 * is the property that makes the inbox a private channel rather than a public
 * ledger of who paid whom.
 *
 * A fresh ephemeral key per entry, so two deposits to the same account share no
 * ciphertext structure and cannot be linked by anyone watching the contract.
 */
export async function sealCustodyInboxEntry(
  recipientEncKeyHex: string,
  coin: CustodyInboxCoin,
  deps: CustodyInboxDeps = defaultCustodyInboxDeps(),
): Promise<Uint8Array> {
  const recipient = normalised32(recipientEncKeyHex);
  if (recipient === null) {
    throw new Error('An inbox entry is sealed to a 32-byte account encryption key.');
  }
  const plaintext = encodeCustodyInboxPlaintext(coin);
  const ephemeral = generateCustodyEncKeyPair(deps);
  const shared = x25519.getSharedSecret(hexToBytes(ephemeral.secretKeyHex), hexToBytes(recipient));
  const subtle = deps.subtle();
  const key = await aeadKey(subtle, shared);
  const nonce = deps.randomBytes(NONCE_BYTES);
  const sealed = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: toBuffer(nonce), additionalData: toBuffer(ASSOCIATED_DATA), tagLength: TAG_BYTES * 8 },
      key,
      toBuffer(plaintext),
    ),
  );
  /* WebCrypto returns ciphertext ‖ tag; the container keeps them apart, and at
     different offsets from each other, so they are separated here. */
  return packCustodyInboxEntry({
    ephemeralPublicKey: hexToBytes(ephemeral.publicKeyHex),
    nonce,
    tag: sealed.subarray(CUSTODY_INBOX_PLAINTEXT_BYTES),
    ciphertext: sealed.subarray(0, CUSTODY_INBOX_PLAINTEXT_BYTES),
  });
}

/**
 * Open an entry with the account's viewing secret, or null.
 *
 * NULL FOR EVERY KIND OF NO, and that is the §6.5 rule rather than laziness:
 * an entry addressed to somebody else and an entry deliberately malformed to
 * stop a walk are the same event from here, and the only safe response to both
 * is to move to the next index. The one thing a reader must never do is decide
 * the inbox is broken.
 */
export async function openCustodyInboxEntry(
  encSecretKeyHex: string,
  entry: Uint8Array,
  deps: CustodyInboxDeps = defaultCustodyInboxDeps(),
): Promise<CustodyInboxCoin | null> {
  const secret = normalised32(encSecretKeyHex);
  if (secret === null) return null;
  const parts = unpackCustodyInboxEntry(entry);
  if (parts === null) return null;
  try {
    const shared = x25519.getSharedSecret(hexToBytes(secret), parts.ephemeralPublicKey);
    const subtle = deps.subtle();
    const key = await aeadKey(subtle, shared);
    const sealed = new Uint8Array(CUSTODY_INBOX_PLAINTEXT_BYTES + TAG_BYTES);
    sealed.set(parts.ciphertext, 0);
    sealed.set(parts.tag, CUSTODY_INBOX_PLAINTEXT_BYTES);
    const plaintext = new Uint8Array(
      await subtle.decrypt(
        { name: 'AES-GCM', iv: toBuffer(parts.nonce), additionalData: toBuffer(ASSOCIATED_DATA), tagLength: TAG_BYTES * 8 },
        key,
        toBuffer(sealed),
      ),
    );
    return decodeCustodyInboxPlaintext(plaintext);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The walk                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The part of the contract's public state a walk reads.
 *
 * An interface rather than the ledger type, for the reason `./k1CoinStore.ts`
 * injects its commitment-window reader: this module stays testable without a
 * chain, a WASM ledger, or a compiled build, and the one place that has all
 * three adapts to it in four lines.
 */
export interface CustodyInboxReader {
  /** `inbox_count` — one past the highest index ever written. */
  count(): bigint;
  /** `inbox[index]`, or null where the map has no entry at that index. */
  entryAt(index: bigint): Uint8Array | null;
}

/** One entry a walk could read, with where it sat. */
export interface CustodyWalkedCoin extends CustodyInboxCoin {
  readonly inboxIndex: bigint;
}

/** What a walk did with each coin it recovered. */
export interface CustodyWalkOutcome {
  readonly coin: CustodyWalkedCoin;
  readonly reconciliation: K1Reconciliation;
}

/** What a walk found, and what became of it. */
export interface CustodyWalkResult {
  /** Every entry this secret could open, in inbox order. */
  readonly coins: readonly CustodyWalkedCoin[];
  /** Per coin, whether a position was learned and the coin stored. */
  readonly outcomes: readonly CustodyWalkOutcome[];
  /** Entries passed over: someone else's, a future suite, or malformed. */
  readonly skipped: number;
}

/**
 * Walk an account's inbox and fill its coin store.
 *
 * This is MIP-0012 §6.5's discovery procedure and the reason total loss of a
 * client is survivable: an account that has kept nothing but its viewing secret
 * can replay its own inbox from the contract's public state and recover the
 * description of every coin it was ever sent.
 *
 * TWO HALVES, AND ONLY THE FIRST IS IN THE ENTRY. Decrypting gives nonce,
 * colour, and value. It does not give the coin's position in the commitment
 * tree, which the depositor did not know when it sealed. So each recovered coin
 * goes through `reconcileK1CoinFromChain`, which asks the indexer where the
 * depositing transaction's outputs landed — and a coin whose position cannot be
 * settled is left OUT of the store rather than stored with a guess, because a
 * store holding a confident wrong position is worse than one holding nothing:
 * the wrong one fails at proving time every time and looks like a broken
 * account.
 *
 * `txIdFor` is how a caller says which transaction produced the entry at an
 * index. Where it answers null the coin is reported and not stored, which is
 * the honest outcome for an entry whose transaction this client never saw.
 *
 * ONE KEY OR SEVERAL (2026/09/26). A Passport brought back on a new device
 * points its account at the new device's key, and every note delivered before
 * that is sealed to the key on the device that is gone. When the sign-in it
 * came back through gives that earlier key back (`./signInViewingKeys.ts`,
 * `./viewingKeys.ts`), the walk is
 * handed every key the account has had and tries each on each entry, in the
 * order given — the current key first, because it opens most of them. A note
 * sealed to one key fails authentication under every other, so a key that
 * opens nothing costs one agreement per entry and changes no result.
 */
export async function readInboxCustody(
  account: K1Account,
  encSecretKeyHex: string | readonly string[],
  reader: CustodyInboxReader,
  options: {
    txIdFor(index: bigint, coin: CustodyInboxCoin): string | null;
    windows: K1CommitmentWindowReader;
    /**
     * What to do with a delivery whose transaction had several shielded
     * outputs — passed straight through to {@link reconcileK1CoinFromChain}.
     *
     * `'report'` stays the default. `'store'` is what the screen asks for: a
     * payer sending part of what it holds makes a two-output transaction, which
     * is the ordinary case, and reporting those would leave every such payment
     * unshowable for ever.
     *
     * Under `'store'` the coin is placed whatever the colour was holding — the
     * held slot when it was empty, the queue behind the existing coin when it
     * was not, carrying its candidate positions with it (2026/09/21). It used
     * to be dropped in the second case, which is the case a Passport paid
     * while still holding its opening grant is always in.
     */
    candidates?: 'report' | 'store';
    deps?: CustodyInboxDeps;
  },
): Promise<CustodyWalkResult> {
  const deps = options.deps ?? defaultCustodyInboxDeps();
  const secrets = typeof encSecretKeyHex === 'string' ? [encSecretKeyHex] : encSecretKeyHex;
  const coins: CustodyWalkedCoin[] = [];
  const outcomes: CustodyWalkOutcome[] = [];
  let skipped = 0;

  const count = reader.count();
  for (let index = 0n; index < count; index += 1n) {
    const entry = reader.entryAt(index);
    if (entry === null) {
      skipped += 1;
      continue;
    }
    let opened: CustodyInboxCoin | null = null;
    for (const secret of secrets) {
      opened = await openCustodyInboxEntry(secret, entry, deps);
      if (opened !== null) break;
    }
    if (opened === null) {
      skipped += 1;
      continue;
    }
    const coin: CustodyWalkedCoin = { ...opened, inboxIndex: index };
    coins.push(coin);

    const txId = options.txIdFor(index, opened);
    if (txId === null) {
      outcomes.push({
        coin,
        reconciliation: {
          outcome: 'unavailable',
          reason: `Nothing here knows which transaction wrote inbox entry ${index}.`,
        },
      });
      continue;
    }
    outcomes.push({
      coin,
      reconciliation: await reconcileK1CoinFromChain(
        account,
        { colour: coin.colour, nonce: coin.nonce, value: coin.value, txId },
        options.windows,
        { candidates: options.candidates ?? 'report' },
      ),
    });
  }

  return { coins, outcomes, skipped };
}

/* -------------------------------------------------------------------------- */
/* Paying into another custody account                                             */
/* -------------------------------------------------------------------------- */

/** The two arguments `deposit_shielded` takes, built and ready to submit. */
export interface CustodyShieldedDeposit {
  /** The coin, in the shape the contract's `CoinInfo` argument wants. */
  readonly coin: { readonly nonce: Uint8Array; readonly color: Uint8Array; readonly value: bigint };
  /** The sealed 192-byte container. */
  readonly entry: Uint8Array;
}

/**
 * Build a shielded deposit into ANOTHER custody account — the transfer case.
 *
 * The recipient's `enc_key` is read from ITS contract's public state and never
 * from anything this client remembers about it. That is the whole security
 * argument: an account rotates its key with `rotate_enc_key_with_k256`, and a
 * depositor sealing to a cached key would write an entry the recipient can no
 * longer open, with a coin inside it that is then gone. Callers pass the value
 * they just read; they must not pass one they read yesterday.
 *
 * The caller owns submission. This function does no chain work at all, which is
 * why it is testable and why the sponsor can use the same reasoning with a
 * different implementation.
 */
export async function depositShieldedCustody(
  recipientEncKeyHex: string,
  coin: CustodyInboxCoin,
  deps: CustodyInboxDeps = defaultCustodyInboxDeps(),
): Promise<CustodyShieldedDeposit> {
  const checked = requireCoin(coin);
  const entry = await sealCustodyInboxEntry(recipientEncKeyHex, coin, deps);
  return {
    coin: {
      nonce: hexToBytes(checked.nonce),
      color: hexToBytes(checked.colour),
      value: checked.value,
    },
    entry,
  };
}
