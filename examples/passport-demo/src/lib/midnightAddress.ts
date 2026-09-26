/**
 * Reading a Midnight bech32m address WITHOUT the wallet SDK, for the two
 * validators that sit on the first render path.
 *
 * WHY THIS EXISTS (2026/09/25)
 * ----------------------------
 * The Send sheet's recipient check (`screens/SendSheet.tsx`) and the approval
 * ladder shared by both transaction surfaces (`lib/txApproval.ts`) used to
 * import `MidnightBech32m`, `UnshieldedAddress`, `ShieldedAddress`, and
 * `mainnet` from `@midnight-ntwrk/wallet-sdk/address-format`. That module
 * statically imports `@midnightntwrk/ledger-v9` for one class
 * (`EncryptionSecretKey`, used by a codec neither caller touches), and the
 * ledger initialises by top-level awaiting a 10 MB WebAssembly binary. Both
 * callers are reached statically from `main.tsx`, so the entry chunk could not
 * evaluate — and React could not mount the landing — until that binary had
 * been downloaded and instantiated. Measured on a Pixel 7 profile with the CPU
 * slowed four-fold: the "Sign up" button became clickable 4.8 s after
 * navigation on fast 4G and 25.0 s on slow 4G, each time just after the
 * WebAssembly finished. Without it, 0.7 s and 1.9 s.
 *
 * Both callers are synchronous — the Send sheet's inside a `useMemo`, as the
 * person types — so deferring the SDK would have changed when a verdict
 * appears. The codec itself is small and pure, so this is it, and nothing
 * else: the four names those two files used, with the SDK's behaviour.
 *
 * WHAT IT IS NOT
 * --------------
 * It is a VERDICT for a screen, never the bytes a payment is made to. Every
 * send decodes the address again with the SDK's own codec in
 * `identity/accountCustody.ts`, which is loaded when the payment is made. So a
 * disagreement between the two could only ever make a screen accept an address
 * the send then refuses, or refuse one it would have accepted — and
 * `midnightAddress.test.ts` holds them to the same answer on every address the
 * SDK can produce and on each way an address can be malformed.
 *
 * WHY IT DOES NOT USE `@scure/base`, which is what the SDK decodes with. This
 * app does not declare it: the copy the SDK uses is 2.3.0, pinned for the
 * address-format packages alone in the root `package.json`, and the copy an
 * import from here would resolve to is whichever one npm hoisted — 2.4.0
 * today, whose `decodeToBytes` reimposes bech32's 90-character limit and
 * refuses every 133-character shielded address. That is the v11 regression in
 * `RELEASE-NOTES.md`. BIP-350's decoder is forty lines, so it is written out
 * here rather than borrowed from a package this app cannot pin.
 */

/** The SDK's own spelling: `mainnet` is the network with no segment in the prefix. */
export const mainnet: unique symbol = Symbol('Mainnet')

type NetworkSegment = string | typeof mainnet

/** What a codec needs to know: the address type it reads, and how to read its bytes. */
export interface MidnightAddressCodec<T> {
  readonly type: string
  readonly fromBytes: (bytes: Uint8Array) => T
}

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
/** BIP-350's final constant; classic bech32 (BIP-173) uses 1. */
const BECH32M_CONST = 0x2bc830a3
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
/** The SDK's segment rule, verbatim: numbers, latin letters, and a hyphen. */
const SEGMENT = /^[A-Za-z1-9-]+$/
const KEY_LENGTH = 32

function polymod(values: readonly number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let bit = 0; bit < 5; bit += 1) {
      if ((top >>> bit) & 1) checksum ^= GENERATORS[bit]
    }
  }
  return checksum >>> 0
}

/**
 * `bech32m.decodeToBytes` as the SDK's pinned `@scure/base` 2.3.0 performs it:
 * no length ceiling, one case throughout, the LAST `1` as the separator, a
 * bech32m checksum, and 5-to-8-bit regrouping that refuses both excess and
 * non-zero padding.
 */
function decodeBech32m(text: string): { prefix: string; bytes: Uint8Array } {
  if (text.length < 8) throw new Error(`invalid string length ${text.length}`)
  const lowered = text.toLowerCase()
  if (text !== lowered && text !== text.toUpperCase()) {
    throw new Error('mixed-case string not allowed')
  }
  const separator = lowered.lastIndexOf('1')
  if (separator < 1) throw new Error('invalid separator "1"')
  const prefix = lowered.slice(0, separator)
  const data = lowered.slice(separator + 1)
  if (data.length < 6) throw new Error('invalid data length')

  const expanded: number[] = []
  for (let index = 0; index < prefix.length; index += 1) {
    const code = prefix.charCodeAt(index)
    if (code < 33 || code > 126) throw new Error(`Invalid prefix (${prefix})`)
    expanded.push(code >> 5)
  }
  expanded.push(0)
  for (let index = 0; index < prefix.length; index += 1) {
    expanded.push(prefix.charCodeAt(index) & 31)
  }
  const words: number[] = []
  for (const letter of data) {
    const word = CHARSET.indexOf(letter)
    if (word === -1) throw new Error(`invalid bech32 letter "${letter}"`)
    words.push(word)
  }
  if (polymod([...expanded, ...words]) !== BECH32M_CONST) {
    throw new Error(`Invalid checksum in ${text}`)
  }

  const bytes: number[] = []
  let carry = 0
  let bits = 0
  for (const word of words.slice(0, -6)) {
    carry = ((carry << 5) | word) & 0xfff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((carry >> bits) & 0xff)
    }
  }
  if (bits >= 5) throw new Error('Excess padding')
  if (carry & ((1 << bits) - 1)) throw new Error('Non-zero padding')
  return { prefix, bytes: Uint8Array.from(bytes) }
}

function validateSegment(name: string, segment: string): void {
  if (!SEGMENT.test(segment)) {
    throw new Error(
      `Segment ${name}: ${segment} contains disallowed characters. Allowed characters are only numbers, latin letters and a hyphen`,
    )
  }
}

function networkName(network: NetworkSegment): string {
  return network === mainnet ? 'mainnet' : network
}

/** A parsed `mn_<type>[_<network>]1…` address: its type, its network, and its payload. */
export class MidnightBech32m {
  static parse(text: string): MidnightBech32m {
    const { prefix, bytes } = decodeBech32m(text)
    const [head, type, network] = prefix.split('_')
    if (head !== 'mn') throw new Error('Expected prefix mn')
    /* An absent TYPE is let through, as the SDK lets it through (its check
       reads `undefined` as the word "undefined"); no codec then accepts it. An
       EMPTY one, from a prefix that ends in `_`, is refused like any bad one. */
    if (type !== undefined) validateSegment('type', type)
    if (network !== undefined) validateSegment('network', network)
    return new MidnightBech32m(type ?? '', network ?? mainnet, bytes)
  }

  readonly type: string
  readonly network: NetworkSegment
  readonly data: Uint8Array

  private constructor(type: string, network: NetworkSegment, data: Uint8Array) {
    this.type = type
    this.network = network
    this.data = data
  }

  /** The payload, read as `codec`'s type on `networkId` — or a throw saying which of the two it is not. */
  decode<T>(codec: MidnightAddressCodec<T>, networkId: string): T {
    if (this.type !== codec.type) {
      throw new Error(`Expected type ${codec.type}, got ${this.type}`)
    }
    const expected: NetworkSegment = networkId === 'mainnet' ? mainnet : networkId
    if (this.network !== expected) {
      throw new Error(`Expected ${networkName(expected)} address, got ${networkName(this.network)} one`)
    }
    return codec.fromBytes(this.data)
  }
}

/** `mn_addr…`: a 32-byte unshielded address. */
export const UnshieldedAddress: MidnightAddressCodec<Uint8Array> = {
  type: 'addr',
  fromBytes: (bytes) => {
    if (bytes.length !== KEY_LENGTH) throw new Error('Unshielded address needs to be 32 bytes long')
    return bytes
  },
}

/** `mn_shield-addr…`: a 32-byte coin public key, then the encryption public key. */
export const ShieldedAddress: MidnightAddressCodec<{
  coinPublicKey: Uint8Array
  encryptionPublicKey: Uint8Array
}> = {
  type: 'shield-addr',
  fromBytes: (bytes) => {
    if (bytes.length < KEY_LENGTH) throw new Error('Coin public key needs to be 32 bytes long')
    return {
      coinPublicKey: bytes.subarray(0, KEY_LENGTH),
      encryptionPublicKey: bytes.subarray(KEY_LENGTH),
    }
  },
}
